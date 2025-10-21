import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { Diet, Food } from "../models/models";
import { _initiatePixRefundLogic, formatFirstName, sendEmail, calculateBusinessHoursElapsed } from "../core/utils";
import { getSeparationDelayedWarningEmailHTML, getSeparationFinalWarningEmailHTML, getScheduledDeliveryReminderEmailHTML, getNotifyingPickerEmailHTML } from "../core/email-templates";
import { callAI } from "../core/utils";
import { cancelAndRefundOrder } from "../payments/payments";

const db = admin.firestore();





const BATCH_SIZE = 10; // Mantém o tamanho do lote para chamadas de IA

/**
 * Função auxiliar para atualizar o documento de índice em system_config/food_index.
 * Esta lógica foi movida da antiga 'scheduledFoodIndexUpdate'.
 */
async function updateFoodIndex(): Promise<number> {
    logger.info("Iniciando a atualização do índice de alimentos...");
    const foodsCollectionRef = db.collection('foods');
    const indexDocRef = db.collection('system_config').doc('food_index');

    const snapshot = await foodsCollectionRef.get();
    if (snapshot.empty) {
        logger.warn("A coleção 'foods' está vazia. Atualizando índice para vazio.");
        await indexDocRef.set({ allFoods: [], allNames: [] });
        return 0;
    }

    const allFoods = snapshot.docs.map(doc => ({ ...doc.data() as Food, id: doc.id }));
    const allNames = allFoods.map(food => food.standard_name);

    await indexDocRef.set({
        allFoods: allFoods,
        allNames: allNames,
        lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const count = allFoods.length;
    logger.info(`Índice de alimentos atualizado com sucesso. ${count} alimentos indexados.`);
    return count;
}


export const updateFoodPricesDaily = onSchedule({
    schedule: "every day 07:30",
    timeZone: "America/Sao_Paulo",
    region: "southamerica-east1",
    timeoutSeconds: 540, // Aumentado para 9 minutos para dar conta de tudo
    memory: "1GiB"
}, async (event) => {
    logger.info("Iniciando a atualização de preços dos alimentos...");

    // ✅ 1. MUDANÇA: Lendo diretamente da coleção 'foods'
    const foodsSnapshot = await db.collection('foods').get();

    if (foodsSnapshot.empty) {
        logger.warn("A coleção 'foods' está vazia. Nenhum preço para atualizar.");
        return;
    }

    const allFoods: Food[] = foodsSnapshot.docs.map(doc => ({ ...doc.data() as Food, id: doc.id }));
    const firestoreBatch = db.batch();
    let updatedCount = 0;
    const priceChanges: { name: string, oldPrice: number, newPrice: number, quantity: number, unit: string }[] = [];
    const foodMap = new Map(allFoods.map(food => [food.standard_name, food]));

    for (let i = 0; i < allFoods.length; i += BATCH_SIZE) {
        const batchItems = allFoods.slice(i, i + BATCH_SIZE);
        const foodListText = batchItems.map(food => `- ${food.quantity}${food.default_unit} de ${food.standard_name}`).join('\n');

        const prompt = `
            Você é um assistente de cotação de preços de supermercado.
            Sua tarefa é fornecer o preço médio em Reais (BRL) para uma lista de alimentos em supermercados de Betim, MG.
            Responda APENAS com um array JSON válido. Cada objeto deve ter "name" (string) e "price" (number).
            Lista de Alimentos:
            ${foodListText}
        `;

        try {
            const aiResponseString = await callAI(prompt, 'GEMINI', true);
            const priceResults = JSON.parse(aiResponseString) as { name: string; price: number | string }[];

            if (!Array.isArray(priceResults)) {
                logger.warn("A resposta da IA não foi um array para o lote no índice:", i);
                continue;
            }

            for (const result of priceResults) {
                const food = foodMap.get(result.name);
                if (food) {
                    const rawPrice = result.price;
                    if (rawPrice === undefined || rawPrice === null) continue;

                    const sanitizedPriceString = String(rawPrice).replace(',', '.');
                    const newPrice = parseFloat(sanitizedPriceString);

                    if (newPrice !== undefined && !isNaN(newPrice) && newPrice > 0 && food.estimatedPrice !== newPrice) {
                        priceChanges.push({ name: food.standard_name, oldPrice: food.estimatedPrice, newPrice, quantity: food.quantity, unit: food.default_unit });
                        const foodDocRef = db.collection('foods').doc(food.id);
                        firestoreBatch.update(foodDocRef, { estimatedPrice: newPrice });
                        updatedCount++;
                    }
                }
            }
        } catch (error) {
            logger.error(`Falha ao processar o lote de alimentos no índice ${i}:`, error);
        }
    }

    const adminEmail = 'ronaldo.fortini.jr@gmail.com';
    const today = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    if (updatedCount > 0) {
        await firestoreBatch.commit();
        logger.info(`Atualização de preços concluída: ${updatedCount} alimentos atualizados.`);

        // ✅ 2. MUDANÇA: Atualiza o índice após a atualização dos preços
        try {
            await updateFoodIndex();
        } catch (error) {
            logger.error("Falha ao atualizar o food_index após a atualização de preços.", error);
        }

        const subject = `Relatório de Atualização de Preços - ${today}`;
        const tableRows = priceChanges.map(change => {
            const variation = change.oldPrice > 0 ? ((change.newPrice - change.oldPrice) / change.oldPrice) * 100 : 100;
            const variationColor = variation > 0 ? '#c0392b' : '#27ae60';
            return `
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">${change.name}</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${change.quantity}${change.unit}</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">R$ ${change.oldPrice.toFixed(2).replace('.', ',')}</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">R$ ${change.newPrice.toFixed(2).replace('.', ',')}</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right; font-weight: bold; color: ${variationColor};">${variation.toFixed(1).replace('.', ',')}%</td>
              </tr>`;
        }).join('');

        const emailHtml = `
          <div style="font-family: Arial, sans-serif; color: #333;">
            <h2>Relatório Diário de Atualização de Preços</h2>
            <p>Foram atualizados <strong>${updatedCount}</strong> itens em <strong>${today}</strong>.</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
              <thead><tr style="background-color: #f2f2f2;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Alimento</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">Quantidade</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Preço Antigo</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Preço Novo</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Variação</th>
              </tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>`;

        try {
            await sendEmail(adminEmail, subject, emailHtml);
            logger.info(`E-mail de relatório de preços enviado com sucesso para ${adminEmail}.`);
        } catch (error) {
            logger.error(`Falha ao enviar e-mail de relatório de preços para ${adminEmail}.`, error);
        }
    } else {
        logger.info("Nenhum preço precisou ser atualizado.");

        // ✅ 3. MUDANÇA: Envia um e-mail informando que não houve atualizações
        const subject = `Status da Atualização de Preços - ${today}`;
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <h2>Status da Atualização de Preços</h2>
                <p>A rotina de atualização de preços foi executada em <strong>${today}</strong>, mas nenhum preço precisou ser alterado.</p>
                <p style="margin-top: 20px; font-size: 12px; color: #888;">Este é um e-mail automático de confirmação.</p>
            </div>
        `;
        try {
            await sendEmail(adminEmail, subject, emailHtml);
            logger.info(`E-mail de status (sem atualizações) enviado com sucesso para ${adminEmail}.`);
        } catch (error) {
            logger.error(`Falha ao enviar e-mail de status para ${adminEmail}.`, error);
        }
    }
});






/**
 * Roda a cada 15 minutos em dias úteis para cancelar e estornar pedidos 
 * que excederam o tempo limite em seus respectivos status.
 */
export const monitorAndCancelStaleOrders = onSchedule({
    schedule: "*/15 10-17 * * 1-5",
    timeZone: "America/Sao_Paulo",
    region: "southamerica-east1",
}, async (event) => {
    logger.info("Iniciando monitoramento de pedidos parados...");

    const TIMEOUTS = {
        CONFIRMED_HOURS: 0.33,
        IN_SEPARATION_HOURS: 3,
        IN_DELIVERY_HOURS: 0.33,
    };



    const now = new Date();
    const statusesToMonitor = ['confirmed', 'in_separation_progress', 'in_delivery_progress'];

    const query = db.collection("diets")
        .where('currentStatus.status', 'in', statusesToMonitor);

    const snapshot = await query.get();

    if (snapshot.empty) {
        logger.info("Nenhum pedido parado encontrado para cancelamento.");
        return;
    }

    logger.info(`Encontrados ${snapshot.docs.length} pedidos em status de monitoramento.`);
    const promises: Promise<void>[] = [];

    snapshot.forEach(doc => {
        const diet = doc.data() as Diet;
        if (diet.refundDetails) return; // Pula se já tiver estorno

        let statusTimestamp: admin.firestore.Timestamp;

        // 2. Verifique o tipo de 'diet.currentStatus.timestamp' de forma segura.
        if (diet.currentStatus.timestamp instanceof admin.firestore.Timestamp) {
            // Se já for um Timestamp, apenas atribua.
            statusTimestamp = diet.currentStatus.timestamp;
        } else {
            // Se for um Date (ou outro tipo), converta-o para um Timestamp.
            statusTimestamp = admin.firestore.Timestamp.fromDate(diet.currentStatus.timestamp as Date);
        }

        // ======================= LÓGICA CORRIGIDA AQUI =======================
        // 1. Calcula as horas úteis decorridas desde a mudança de status
        const businessHoursElapsed = calculateBusinessHoursElapsed(statusTimestamp.toDate(), now);

        let timeoutThreshold = 0;
        let reason = "";

        // 2. Define o limite de timeout com base no status atual
        switch (diet.currentStatus.status) {
            case 'confirmed':
                timeoutThreshold = TIMEOUTS.CONFIRMED_HOURS;
                reason = `Cancelado automaticamente por exceder o tempo de ${timeoutThreshold}h úteis para iniciar a separação.`;
                break;
            case 'in_separation_progress':
                timeoutThreshold = TIMEOUTS.IN_SEPARATION_HOURS;
                reason = `Cancelado automaticamente por exceder o tempo de ${timeoutThreshold}h úteis na separação.`;
                break;
            case 'in_delivery_progress':
                timeoutThreshold = TIMEOUTS.IN_DELIVERY_HOURS;
                reason = `Cancelado automaticamente por exceder o tempo de ${timeoutThreshold}h úteis na entrega.`;
                break;
        }

        // 3. Compara o tempo decorrido com o limite
        if (timeoutThreshold > 0 && businessHoursElapsed > timeoutThreshold) {
            logger.warn(`Pedido [${doc.id}] com status "${diet.currentStatus.status}" excedeu o tempo limite. Horas úteis decorridas: ${businessHoursElapsed.toFixed(2)}h. Limite: ${timeoutThreshold}h.`);
            promises.push(cancelAndRefundOrder(doc.ref, diet, reason));
        }
        // ======================================================================
    });

    await Promise.all(promises);
    logger.info("Monitoramento de pedidos parados concluído.");
});






/**
 * Roda a cada 10 minutos para monitorar separações atrasadas e enviar alertas ao picker.
 */
export const checkStalledSeparations = onSchedule({
    schedule: "every 10 minutes",
    region: "southamerica-east1",
    timeZone: "America/Sao_Paulo"
}, async (event) => {
    logger.info("Iniciando verificação de separações atrasadas...");
    const now = new Date();
    const fortyMinutesAgo = new Date(now.getTime() - 40 * 60 * 1000);
    const sixtyMinutesAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const query = db.collection("diets")
        .where('currentStatus.status', '==', 'in_separation_progress')
        .where('currentStatus.timestamp', '<=', admin.firestore.Timestamp.fromDate(fortyMinutesAgo));

    const snapshot = await query.get();
    if (snapshot.empty) {
        logger.info("Nenhuma separação atrasada encontrada.");
        return;
    }

    const alertsRef = db.collection('sentAlerts');

    for (const doc of snapshot.docs) {
        const diet = doc.data() as Diet;
        const orderIdShort = `#${doc.id.slice(0, 8).toUpperCase()}`;

        // Declara a variável que irá armazenar a data do status.
        let statusTimestamp: Date;
        const timestampFromDb = diet.currentStatus.timestamp;

        // Faz a conversão segura de Timestamp do Firestore para um Date do JavaScript.
        if (timestampFromDb instanceof admin.firestore.Timestamp) {
            statusTimestamp = timestampFromDb.toDate();
        } else {
            // Se já for um Date, apenas o atribui.
            statusTimestamp = timestampFromDb as Date;
        }

        if (statusTimestamp < sixtyMinutesAgo) {
            const alertId = `${doc.id}_separation_60m`;
            const alertDoc = await alertsRef.doc(alertId).get();
            if (!alertDoc.exists && diet.picker?.email) { // Verificação de e-mail adicionada
                const emailHtml = getSeparationFinalWarningEmailHTML({
                    pickerFirstName: diet.picker?.fullName.split(' ')[0] || 'Picker',
                    orderIdShort,
                    customerName: diet.userFullName
                });

                await sendEmail(
                    diet.picker.email,
                    `AVISO FINAL: O pedido ${orderIdShort} será cancelado`,
                    emailHtml,
                    "Alerta de Sistema"
                );

                await alertsRef.doc(alertId).set({ sentAt: admin.firestore.Timestamp.now() });
            }
        } else if (statusTimestamp < fortyMinutesAgo) {
            const alertId = `${doc.id}_separation_40m`;
            const alertDoc = await alertsRef.doc(alertId).get();
            if (!alertDoc.exists && diet.picker?.email) { // Verificação de e-mail adicionada
                const emailHtml = getSeparationDelayedWarningEmailHTML({
                    pickerFirstName: diet.picker?.fullName.split(' ')[0] || 'Picker',
                    orderIdShort,
                    customerName: diet.userFullName
                });

                await sendEmail(
                    diet.picker.email,
                    `Atenção: Atraso na separação do pedido ${orderIdShort}`,
                    emailHtml,
                    "Alerta de Sistema"
                );

                await alertsRef.doc(alertId).set({ sentAt: admin.firestore.Timestamp.now() });
            }
        }
    }
});


/**
* Função agendada para cancelar e estornar automaticamente pedidos confirmados
* que não foram processados dentro do prazo de 3 horas.
*/
// export const scheduledRefundAndCancel = onSchedule(
//     {
//         schedule: "*/15 10-16 * * *",
//         timeZone: "America/Sao_Paulo",
//         region: "southamerica-east1",
//     },
//     async (event) => {
//         logger.info("Iniciando verificação de pedidos confirmados para cancelamento automático...");

//         const db = admin.firestore();
//         const dietsRef = db.collection("diets");
//         const now = new Date();

//         const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
//         const threeHoursAgoTimestamp = admin.firestore.Timestamp.fromDate(threeHoursAgo);

//         const query = dietsRef
//             .where('currentStatus.status', '==', 'confirmed')
//             .where('currentStatus.timestamp', '<=', threeHoursAgoTimestamp)
//             .where('refundDetails', '==', null);

//         const snapshot = await query.get();

//         if (snapshot.empty) {
//             logger.info("Nenhum pedido confirmado expirado encontrado.");
//             return;
//         }

//         logger.info(`Encontrados ${snapshot.docs.length} pedidos para cancelamento e estorno automático.`);

//         const cancellationPromises = snapshot.docs.map(async (doc) => {
//             const dietId = doc.id;
//             const dietData = doc.data() as Diet;
//             const reason = "Cancelado automaticamente por exceder o tempo limite de preparação.";

//             logger.info(`Processando estorno automático para a dieta [${dietId}]...`);

//             try {
//                 const e2eId = dietData.paymentDetails?.endToEndId;
//                 if (!e2eId) {
//                     throw new Error(`ID da transação (endToEndId) não encontrado para a dieta ${dietId}.`);
//                 }
//                 // A função cancelAndRefundOrder já está neste arquivo, então podemos chamá-la
//                 await cancelAndRefundOrder(doc.ref, dietData, reason);

//             } catch (error: any) {
//                 logger.error(`Falha CRÍTICA ao processar estorno automático para a dieta [${dietId}]:`, error);
//             }
//         });

//         await Promise.all(cancellationPromises);
//         logger.info("Verificação de cancelamento automático concluída.");
//     }
// );


/**
* Roda toda manhã de dia útil para enviar um lembrete aos clientes e iniciar a busca por um picker.
*/
export const sendScheduledOrdersNotifications = onSchedule({ schedule: "every weekday 10:00", timeZone: "America/Sao_Paulo", region: "southamerica-east1" }, async (event) => {
    logger.info("Iniciando verificação de notificações de dietas agendadas...");
    const now = admin.firestore.Timestamp.now();
    const query = db.collection("diets").where('currentStatus.status', '==', 'confirmed').where('deliveryScheduledFor', '<=', now);
    const snapshot = await query.get();
    if (snapshot.empty) {
        logger.info("Nenhuma notificação agendada para hoje.");
        return;
    }
    logger.info(`Encontradas ${snapshot.docs.length} notificações agendadas para enviar.`);
    const promises: Promise<any>[] = [];
    snapshot.forEach(doc => {
        const diet = doc.data() as Diet;
        const firstName = formatFirstName(diet.userFullName);
        const subject = `Lembrete: A preparação da sua dieta começa hoje, ${firstName}!`;
        const html = getScheduledDeliveryReminderEmailHTML({ firstName });
        const emailPromise = sendEmail(diet.userEmail, subject, html)
            .then(async () => {
                const pickerSubject = `🔎 Encontrando um Picker para separar sua dieta, ${firstName}!`;
                const pickerHtml = getNotifyingPickerEmailHTML({ firstName });
                await sendEmail(diet.userEmail, pickerSubject, pickerHtml);
            })
            .then(() => doc.ref.update({ deliveryScheduledFor: admin.firestore.FieldValue.delete() }))
            .catch(err => logger.error(`Falha ao enviar e-mails agendados para a dieta [${doc.id}]`, err));
        promises.push(emailPromise);
    });
    await Promise.all(promises);
    logger.info("Envio de notificações agendadas concluído.");
});