import * as admin from "firebase-admin";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { Diet } from "../../../models/models";
import { getEfiAuthToken, getEfiCertificates, httpsRequest, parsePix, _initiatePixRefundLogic } from "../core/utils";
import { getSecrets } from "../core/secrets";
import { v4 as uuidv4 } from 'uuid';

const db = admin.firestore();




/**
 * Processa uma única dieta pendente, verifica seu status na Efí e a cancela se estiver expirada.
 */
// async function processSinglePendingDiet(doc: admin.firestore.DocumentSnapshot): Promise<void> {
//     const diet = doc.data() as Diet;
//     if (!diet || !diet.paymentDetails?.txid || !diet.paymentDetails?.createdAt) {
//         logger.warn(`Dieta ${doc.id} está pendente mas sem TXID ou createdAt. Ignorando.`);
//         return;
//     }

//     const txid = diet.paymentDetails.txid;
//     const now = admin.firestore.Timestamp.now();
//     const createdAtTimestamp = diet.paymentDetails.createdAt as admin.firestore.Timestamp;

//     try {
//         const accessToken = await getEfiAuthToken();
//         const { keyBuffer, certBuffer } = await getEfiCertificates();
//         const isSandbox = process.env.EFI_SANDBOX === 'true';
//         const hostname = isSandbox ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';

//         const options = {
//             hostname: hostname,
//             path: `/v2/cob/${txid}`,
//             method: 'GET',
//             headers: { 'Authorization': `Bearer ${accessToken}` },
//             cert: certBuffer,
//             key: keyBuffer,
//         };

//         const pixStatusResponse = await httpsRequest(options);
//         const statusFromEfi = pixStatusResponse.status;
//         logger.info(`Status da cobrança [${txid}] na Efí: ${statusFromEfi}`);

//         switch (statusFromEfi) {
//             case 'CONCLUIDA':
//                 await doc.ref.update({
//                     'paymentDetails.status': 'approved',
//                     'paymentDetails.paymentConfirmedAt': admin.firestore.Timestamp.now(),
//                 });
//                 break;

//             case 'REMOVIDA_PELO_USUARIO_RECEBEDOR':
//             case 'REMOVIDA_PELO_PSP':
//                 const cancelledStatus = {
//                     status: "cancelled" as const,
//                     timestamp: now,
//                     reason: "PIX expirado ou cancelado na plataforma de pagamento."
//                 };
//                 await doc.ref.update({
//                     currentStatus: cancelledStatus,
//                     statusHistory: admin.firestore.FieldValue.arrayUnion(cancelledStatus),
//                     'paymentDetails.status': 'expired'
//                 });
//                 break;

//             case 'ATIVA':
//                 const expirationTimeInSeconds = createdAtTimestamp.seconds + 3600; // 1 hora
//                 if (now.seconds > expirationTimeInSeconds) {
//                     logger.warn(`Cobrança [${txid}] está ATIVA mas com mais de 1 hora. Forçando cancelamento...`);
//                     const cancelBody = JSON.stringify({ status: "REMOVIDA_PELO_USUARIO_RECEBEDOR" });
//                     const cancelOptions = { ...options, method: 'PATCH', headers: { ...options.headers, 'Content-Type': 'application/json' } };
//                     await httpsRequest(cancelOptions, cancelBody);

//                     const expiredStatus = {
//                         status: "cancelled" as const,
//                         timestamp: now,
//                         reason: "PIX expirado por falta de pagamento."
//                     };
//                     await doc.ref.update({
//                         currentStatus: expiredStatus,
//                         statusHistory: admin.firestore.FieldValue.arrayUnion(expiredStatus),
//                         'paymentDetails.status': 'expired'
//                     });
//                 }
//                 break;
//             default:
//                 logger.warn(`Status desconhecido ('${statusFromEfi}') recebido da Efí para o TXID ${txid}.`);
//                 break;
//         }
//     } catch (error) {
//         logger.error(`Erro ao processar a cobrança [${txid}] na API da Efí:`, error);
//     }
// }

// =========================================================================
// FUNÇÕES EXPORTADAS (TRIGGERS)
// =========================================================================





/**
 * Roda a cada 5 minutos para verificar o status de cobranças PIX pendentes.
 */
// export const checkPixStatus = onSchedule("every 5 minutes", async (event) => {
//     logger.info("Iniciando verificação de status de PIX na API da Efí...");
//     const dietsRef = db.collection('diets');
//     const snapshot = await dietsRef.where('currentStatus.status', '==', 'pending').get();
//     if (snapshot.empty) {
//         logger.info("Nenhuma dieta com pagamento pendente encontrada.");
//         return;
//     }
//     const checkPromises = snapshot.docs.map(doc =>
//         processSinglePendingDiet(doc).catch(err => {
//             logger.error(`Falha ao processar a dieta ${doc.id}:`, err);
//         })
//     );
//     await Promise.all(checkPromises);
//     logger.info(`Verificação de PIX concluída. ${checkPromises.length} dietas analisadas.`);
// });

export const checkPixStatus = onSchedule("every 5 minutes", async (event) => {
    logger.info("Iniciando verificação unificada de status (Charges e Payouts)...");

    const now = admin.firestore.Timestamp.now();
    const dietsRef = db.collection('diets');

    const counterRef = db.collection('counters').doc('diets');

    // 1. Busca os 3 tipos de pagamentos pendentes
    const pendingChargesSnapshot = await dietsRef.where('currentStatus.status', '==', 'pending').get();
    const processingPurchasePayoutsSnapshot = await dietsRef.where('purchaseDetails.status', '==', 'processing').get();
    const processingRidePayoutsSnapshot = await dietsRef.where('deliveryDetails.ridePayment.status', '==', 'processing').get();


    // 2. Combina todos os documentos encontrados em uma única lista
    const allDocs = [
        ...pendingChargesSnapshot.docs,
        ...processingPurchasePayoutsSnapshot.docs,
        ...processingRidePayoutsSnapshot.docs
    ];

    if (allDocs.length === 0) {
        logger.info("Nenhuma dieta aguardando pagamento ou com payout em processamento.");
        return;
    }

    // Usaremos um array para armazenar as operações de batch, garantindo atomicidade nas atualizações
    const batch = db.batch();
    let batchUpdatesCount = 0;

    for (const doc of allDocs) {
        const dietData = doc.data();

        // Lógica para Payout de Supermercado (sem alterações)
        if (dietData.purchaseDetails?.status === 'processing') {
            const initiatedAt = dietData.purchaseDetails?.paymentInitiatedAt as admin.firestore.Timestamp | undefined;
            const txid = dietData.purchaseDetails?.txid;
            if (!initiatedAt || !txid) continue;

            const ageInSeconds = now.seconds - initiatedAt.seconds;
            if (ageInSeconds > 60) {
                logger.warn(`Timeout de Payout de COMPRA da dieta ${doc.id}. Verificando status...`);
                try {
                    const { keyBuffer, certBuffer } = await getEfiCertificates();
                    const accessToken = await getEfiAuthToken();
                    const isSandbox = process.env.EFI_SANDBOX === 'true';
                    const hostname = isSandbox ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';

                    const statusOptions = { hostname, path: `/v2/gn/pix/${txid}`, method: 'GET', headers: { 'Authorization': `Bearer ${accessToken}` }, cert: certBuffer, key: keyBuffer };
                    const finalStatusResponse = await httpsRequest(statusOptions);

                    if (finalStatusResponse.status === 'CONCLUIDO') {
                        await doc.ref.update({
                            'purchaseDetails.status': 'completed',
                            'purchaseDetails.isPaid': true,
                            'purchaseDetails.paymentConfirmedAt': now,
                        });
                    } else {
                        await doc.ref.update({ purchaseDetails: admin.firestore.FieldValue.delete() });
                    }
                } catch (error) {
                    logger.error(`Erro ao resolver status do Payout de COMPRA da dieta ${doc.id}. Resetando...`, error);
                    await doc.ref.update({ purchaseDetails: admin.firestore.FieldValue.delete() });
                }
            }
        }
        // Lógica para Payout de Corrida (NOVA)
        else if (dietData.deliveryDetails?.ridePayment?.status === 'processing') {
            const ridePayment = dietData.deliveryDetails.ridePayment;
            const initiatedAt = ridePayment.paymentInitiatedAt as admin.firestore.Timestamp | undefined;
            const txid = ridePayment.txid;
            if (!initiatedAt || !txid) continue;

            const ageInSeconds = now.seconds - initiatedAt.seconds;
            if (ageInSeconds > 60) {
                logger.warn(`Timeout de Payout de CORRIDA da dieta ${doc.id}. Verificando status...`);
                try {
                    const { keyBuffer, certBuffer } = await getEfiCertificates();
                    const accessToken = await getEfiAuthToken();
                    const isSandbox = process.env.EFI_SANDBOX === 'true';
                    const hostname = isSandbox ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';

                    const statusOptions = { hostname, path: `/v2/gn/pix/${txid}`, method: 'GET', headers: { 'Authorization': `Bearer ${accessToken}` }, cert: certBuffer, key: keyBuffer };
                    const finalStatusResponse = await httpsRequest(statusOptions);

                    if (finalStatusResponse.status === 'CONCLUIDO') {
                        await doc.ref.update({
                            'deliveryDetails.ridePayment.status': 'completed',
                            'deliveryDetails.ridePayment.isPaid': true,
                            'deliveryDetails.ridePayment.paymentConfirmedAt': now,
                        });
                    } else {
                        await doc.ref.update({ 'deliveryDetails.ridePayment': admin.firestore.FieldValue.delete() });
                    }
                } catch (error) {
                    logger.error(`Erro ao resolver status do Payout da CORRIDA da dieta ${doc.id}. Resetando...`, error);
                    await doc.ref.update({ 'deliveryDetails.ridePayment': admin.firestore.FieldValue.delete() });
                }
            }
        }
        // Lógica para Pagamento de Cliente (sem alterações)
        else if (dietData.currentStatus?.status === 'pending') {
            const txid = dietData.paymentDetails?.txid;
            const createdAt = dietData.paymentDetails?.createdAt as admin.firestore.Timestamp;
            if (!txid || !createdAt) continue;

            try {
                const { keyBuffer, certBuffer } = await getEfiCertificates();
                const accessToken = await getEfiAuthToken();
                const isSandbox = process.env.EFI_SANDBOX === 'true';
                const hostname = isSandbox ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';

                const options = { hostname, path: `/v2/cob/${txid}`, method: 'GET', headers: { 'Authorization': `Bearer ${accessToken}` }, cert: certBuffer, key: keyBuffer };
                const pixStatusResponse = await httpsRequest(options);
                const statusFromEfi = pixStatusResponse.status;

                switch (statusFromEfi) {
                    case 'CONCLUIDA':
                        const newStatus = { status: "confirmed" as const, timestamp: now, reason: "Pagamento confirmado pelo cliente (verificação agendada)." };
                        await doc.ref.update({
                            'paymentDetails.status': 'approved',
                            'paymentDetails.paymentConfirmedAt': now,
                            'currentStatus': newStatus,
                            'statusHistory': admin.firestore.FieldValue.arrayUnion(newStatus)
                        });

                        // 2. ATUALIZA O CONTADOR COM N DE DIETAS PARA SEREM MONTADAS (Adicionando ao batch, pois o contador deve ser mais eficiente)
                        batch.update(counterRef, { confirmedCount: admin.firestore.FieldValue.increment(1) });
                        batchUpdatesCount++;
                        break;
                    case 'REMOVIDA_PELO_USUARIO_RECEBEDOR':
                    case 'REMOVIDA_PELO_PSP':
                    case 'ATIVA': // Trata ATIVA e expirada da mesma forma
                        const expirationTimeInSeconds = createdAt.seconds + 3600;
                        if (now.seconds > expirationTimeInSeconds || statusFromEfi !== 'ATIVA') {
                            const reason = statusFromEfi === 'ATIVA' ? "PIX expirado por falta de pagamento." : "PIX cancelado na plataforma de pagamento.";
                            const expiredStatus = { status: "cancelled" as const, timestamp: now, reason: reason };

                            await doc.ref.update({
                                currentStatus: expiredStatus,
                                statusHistory: admin.firestore.FieldValue.arrayUnion(expiredStatus),
                                'paymentDetails.status': 'expired'
                            });

                            // 3. Atualiza o contador (Decrementa se o status anterior for 'confirmed', o que não deve ser o caso aqui, mas é uma boa prática)
                            // Não precisa decrementar aqui pois o status atual é 'pending'.
                        }
                        break;
                }
            } catch (error) {
                logger.error(`Erro ao processar a cobrança da dieta ${doc.id}:`, error);
            }
        }
    }
    if (batchUpdatesCount > 0) {
        await batch.commit();
        logger.info(`Batch concluído: ${batchUpdatesCount} dietas tiveram o contador incrementado.`);
    }
    logger.info(`Verificação unificada de status concluída.`);
});


/**
 * Webhook que recebe notificações da Efí, tratando pagamentos, cancelamentos e estornos.
 */
export const efiwebhook = onRequest(async (request, response) => {
    if (request.method !== 'POST') {
        response.status(405).send("Method Not Allowed");
        return;
    }
    try {
        const notification = request.body;
        logger.info("Webhook da Efí recebido:", JSON.stringify(notification));

        if (!notification.pix || !Array.isArray(notification.pix)) {
            response.status(200).send("Notification acknowledged (ignored).");
            return;
        }

        const batch = db.batch();
        let updatesMade = 0;
        const now = admin.firestore.Timestamp.now();

        for (const pix of notification.pix) {
            if (pix.devolucoes && pix.devolucoes.length > 0) {
                for (const devolucao of pix.devolucoes) {
                    if (devolucao.status === 'DEVOLVIDO') {
                        const q = db.collection('diets').where('refundDetails.refundId', '==', devolucao.id).limit(1);
                        const snapshot = await q.get();
                        if (!snapshot.empty) {
                            const dietDoc = snapshot.docs[0];
                            const newStatus = {
                                status: "cancelled" as const,
                                timestamp: now,
                                reason: dietDoc.data().currentStatus.reason || "Estorno confirmado pelo banco."
                            };
                            batch.update(dietDoc.ref, {
                                currentStatus: newStatus,
                                statusHistory: admin.firestore.FieldValue.arrayUnion(newStatus),
                                'refundDetails.status': 'DEVOLVIDO'
                            });
                            updatesMade++;
                        }
                    }
                }
                continue;
            }

            const txid_charge = pix.txid;
            const txid_payout = pix.gnExtras?.idEnvio;
            const e2eId = pix.endToEndId;
            let dietDoc: admin.firestore.DocumentSnapshot | undefined;

            if (txid_charge) {
                const snapshot = await db.collection('diets').where('paymentDetails.txid', '==', txid_charge).limit(1).get();
                if (!snapshot.empty) dietDoc = snapshot.docs[0];
            }
            if (!dietDoc && txid_payout) {
                const snapshot = await db.collection('diets').where('purchaseDetails.txid', '==', txid_payout).limit(1).get();
                if (!snapshot.empty) dietDoc = snapshot.docs[0];
            }
            if (!dietDoc && txid_payout) {
                const snapshot = await db.collection('diets').where('deliveryDetails.ridePayment.txid', '==', txid_payout).limit(1).get();
                if (!snapshot.empty) dietDoc = snapshot.docs[0];
            }
            if (!dietDoc && e2eId) {
                const snapshot = await db.collection('diets').where('deliveryDetails.ridePayment.endToEndId', '==', e2eId).limit(1).get();
                if (!snapshot.empty) dietDoc = snapshot.docs[0];
            }

            if (dietDoc && dietDoc.exists) {
                const dietData = dietDoc.data() as Diet;

                if (dietData.paymentDetails?.txid === txid_charge && dietData.currentStatus.status === 'pending' && !pix.status) {
                    batch.update(dietDoc.ref, {
                        'paymentDetails.status': 'approved',
                        'paymentDetails.paymentConfirmedAt': now,
                        'paymentDetails.endToEndId': e2eId ?? null
                    });
                    updatesMade++;
                }
                else if (dietData.purchaseDetails?.txid === txid_payout && dietData.purchaseDetails?.status === 'processing') {
                    batch.update(dietDoc.ref, {
                        'purchaseDetails.status': 'completed',
                        'purchaseDetails.isPaid': true,
                        'purchaseDetails.paymentConfirmedAt': now,
                    });
                    updatesMade++;
                }
                else if (
                    (dietData.deliveryDetails?.ridePayment?.txid === txid_payout || dietData.deliveryDetails?.ridePayment?.endToEndId === e2eId)
                    && !dietData.deliveryDetails?.ridePayment?.isPaid
                ) {
                    batch.update(dietDoc.ref, {
                        'deliveryDetails.ridePayment.isPaid': true,
                        'deliveryDetails.ridePayment.status': 'completed',
                        'deliveryDetails.ridePayment.paymentConfirmedAt': now
                    });
                    updatesMade++;
                }
            }
        }

        if (updatesMade > 0) {
            await batch.commit();
        }
        response.status(200).send({ status: "received" });
    } catch (error) {
        logger.error("Erro ao processar o webhook da Efí:", error);
        response.status(500).send("Internal Server Error");
    }
});
// export const efiwebhook = onRequest(async (request, response) => {
//     if (request.method !== 'POST') {
//         response.status(405).send("Method Not Allowed");
//         return;
//     }
//     try {
//         const notification = request.body;
//         logger.info("Webhook da Efí recebido:", JSON.stringify(notification));

//         // 1. Validação
//         if (!notification.pix || !Array.isArray(notification.pix)) {
//             response.status(200).send("Notification acknowledged (ignored).");
//             return;
//         }

//         const batch = db.batch();
//         let updatesMade = 0;
//         const now = admin.firestore.Timestamp.now();
//         const counterRef = db.collection('counters').doc('diets'); // Referência para o contador

//         for (const pix of notification.pix) {
//             // --- LÓGICA DE ESTORNO/DEVOLUÇÃO (MANTIDA IGUAL) ---
//             if (pix.devolucoes && pix.devolucoes.length > 0) {
//                 for (const devolucao of pix.devolucoes) {
//                     if (devolucao.status === 'DEVOLVIDO') {
//                         const q = db.collection('diets').where('refundDetails.refundId', '==', devolucao.id).limit(1);
//                         const snapshot = await q.get();
//                         if (!snapshot.empty) {
//                             const dietDoc = snapshot.docs[0];
//                             const dietData = dietDoc.data() as Diet;
//                             const newStatus = {
//                                 status: "cancelled" as const,
//                                 timestamp: now,
//                                 reason: dietData.currentStatus.reason || "Estorno confirmado pelo banco."
//                             };
//                             batch.update(dietDoc.ref, {
//                                 currentStatus: newStatus,
//                                 statusHistory: admin.firestore.FieldValue.arrayUnion(newStatus),
//                                 'refundDetails.status': 'DEVOLVIDO'
//                             });
//                             updatesMade++;
//                             // Atualiza o contador se o status anterior era 'confirmed'
//                             if (dietData.currentStatus.status === 'confirmed') {
//                                 batch.update(counterRef, { confirmedCount: admin.firestore.FieldValue.increment(-1) });
//                             }
//                         }
//                     }
//                 }
//                 continue;
//             }
//             // --- FIM DA LÓGICA DE ESTORNO ---

//             const txid_charge = pix.txid;
//             const txid_payout = pix.gnExtras?.idEnvio;
//             const e2eId = pix.endToEndId;
//             let dietDoc: admin.firestore.DocumentSnapshot | undefined;

//             // --- LÓGICA DE BUSCA DO DOCUMENTO (MANTIDA IGUAL) ---
//             if (txid_charge) {
//                 const snapshot = await db.collection('diets').where('paymentDetails.txid', '==', txid_charge).limit(1).get();
//                 if (!snapshot.empty) dietDoc = snapshot.docs[0];
//             }
//             if (!dietDoc && txid_payout) {
//                 const snapshot = await db.collection('diets').where('purchaseDetails.txid', '==', txid_payout).limit(1).get();
//                 if (!snapshot.empty) dietDoc = snapshot.docs[0];
//             }
//             if (!dietDoc && txid_payout) {
//                 const snapshot = await db.collection('diets').where('deliveryDetails.ridePayment.txid', '==', txid_payout).limit(1).get();
//                 if (!snapshot.empty) dietDoc = snapshot.docs[0];
//             }
//             if (!dietDoc && e2eId) {
//                 const snapshot = await db.collection('diets').where('deliveryDetails.ridePayment.endToEndId', '==', e2eId).limit(1).get();
//                 if (!snapshot.empty) dietDoc = snapshot.docs[0];
//             }
//             // --- FIM DA LÓGICA DE BUSCA ---

//             if (dietDoc && dietDoc.exists) {
//                 const dietData = dietDoc.data() as Diet;

//                 // 1. PAGAMENTO PRINCIPAL DA DIETA (O que estava falhando)
//                 if (dietData.paymentDetails?.txid === txid_charge && dietData.currentStatus.status === 'pending' && !pix.status) {

//                     const confirmedStatus = { // <--- OBJETO DE STATUS PRINCIPAL ADICIONADO
//                         status: "confirmed" as const,
//                         timestamp: now,
//                         reason: "Pagamento Pix aprovado via Efí Webhook."
//                     };

//                     batch.update(dietDoc.ref, {
//                         // Atualiza os detalhes do pagamento
//                         'paymentDetails.status': 'approved',
//                         'paymentDetails.paymentConfirmedAt': now,
//                         'paymentDetails.endToEndId': e2eId ?? null,

//                         // Atualiza o status principal da dieta (A CORREÇÃO ESSENCIAL)
//                         currentStatus: confirmedStatus,
//                         statusHistory: admin.firestore.FieldValue.arrayUnion(confirmedStatus)
//                     });

//                     // Atualiza o contador de dietas confirmadas
//                     batch.update(counterRef, { confirmedCount: admin.firestore.FieldValue.increment(1) });
//                     updatesMade++;

//                 } 
//                 // 2. PAGAMENTO DE COMPRA/SUPRIMENTOS (MANTIDO)
//                 else if (dietData.purchaseDetails?.txid === txid_payout && dietData.purchaseDetails?.status === 'processing') {
//                     batch.update(dietDoc.ref, {
//                         'purchaseDetails.status': 'completed',
//                         'purchaseDetails.isPaid': true,
//                         'purchaseDetails.paymentConfirmedAt': now,
//                     });
//                     updatesMade++;
//                 }
//                 // 3. PAGAMENTO DE ENTREGA/FRETE (MANTIDO)
//                 else if (
//                     (dietData.deliveryDetails?.ridePayment?.txid === txid_payout || dietData.deliveryDetails?.ridePayment?.endToEndId === e2eId)
//                     && !dietData.deliveryDetails?.ridePayment?.isPaid
//                 ) {
//                     batch.update(dietDoc.ref, {
//                         'deliveryDetails.ridePayment.isPaid': true,
//                         'deliveryDetails.ridePayment.status': 'completed',
//                         'deliveryDetails.ridePayment.paymentConfirmedAt': now
//                     });
//                     updatesMade++;
//                 }
//             }
//         }

//         if (updatesMade > 0) {
//             await batch.commit();
//         }
//         response.status(200).send({ status: "received" });
//     } catch (error) {
//         logger.error("Erro ao processar o webhook da Efí:", error);
//         response.status(500).send("Internal Server Error");
//     }
// });

/**
 * Permite que um usuário verifique manualmente o status de um pagamento PIX pendente.
 */
export const manualpixstatuscheck = onCall({ region: "southamerica-east1" }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Você precisa estar logado para executar esta ação.");
    }
    const uid = request.auth.uid;
    const { dietId } = request.data;
    if (!dietId) {
        throw new HttpsError("invalid-argument", "O ID da dieta é obrigatório.");
    }

    const dietDocRef = db.collection('diets').doc(dietId);
    const dietDoc = await dietDocRef.get();
    if (!dietDoc.exists) {
        throw new HttpsError("not-found", "Dieta não encontrada.");
    }
    const dietData = dietDoc.data() as Diet;
    if (dietData?.userId !== uid) {
        throw new HttpsError("permission-denied", "Você não tem permissão para verificar esta dieta.");
    }
    if (dietData?.currentStatus.status !== 'pending') {
        return { success: true, status: dietData?.currentStatus.status, message: "O status desta dieta já foi atualizado." };
    }

    const lastCheck = dietData.paymentDetails?.lastManualCheckAt as admin.firestore.Timestamp | undefined;
    const now = admin.firestore.Timestamp.now();
    if (lastCheck && (now.seconds - lastCheck.seconds < 60)) {
        throw new HttpsError("resource-exhausted", "Por favor, aguarde um minuto antes de verificar novamente.");
    }

    await dietDocRef.update({ 'paymentDetails.lastManualCheckAt': now });
    const txid = dietData.paymentDetails?.txid;
    if (!txid) {
        throw new HttpsError("not-found", "Detalhes da transação não encontrados para esta dieta.");
    }

    try {
        const accessToken = await getEfiAuthToken();
        const { keyBuffer, certBuffer } = await getEfiCertificates();
        const isSandbox = process.env.EFI_SANDBOX === 'true';
        const hostname = isSandbox ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';
        const options = {
            hostname,
            path: `/v2/cob/${txid}`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            cert: certBuffer,
            key: keyBuffer,
        };
        const pixStatus = await httpsRequest(options);

        if (pixStatus.status === 'CONCLUIDA') {
            await dietDocRef.update({
                'paymentDetails.status': 'approved',
                'paymentDetails.paymentConfirmedAt': admin.firestore.Timestamp.now(),
            });
            return { success: true, status: 'approved', message: "Pagamento confirmado!" };
        } else {
            return { success: true, status: 'still_pending', message: "Seu pagamento ainda não foi confirmado." };
        }
    } catch (error) {
        logger.error(`Falha ao consultar API da Efí para a dieta [${dietId}]:`, error);
        throw new HttpsError("internal", "Não foi possível verificar o status do pagamento com o banco.");
    }
});

/**
 * Função de uso único para configurar o webhook na API da Efí.
 */
export const setupwebhook = onCall({ region: "southamerica-east1" }, async (request) => {
    logger.info("Iniciando configuração do Webhook PIX v2 na Efí...");
    try {
        const secrets = await getSecrets();
        const webhookUrl = "https://efiwebhook-dttf5xbmyq-uc.a.run.app"; // URL da sua função de webhook
        const pixKey = 'bbd6d1fe-318f-42b3-8998-746fc8cef08e'; // Sua chave PIX
        if (!webhookUrl || !pixKey) {
            throw new HttpsError("invalid-argument", "URL do webhook ou Chave Pix não definidas.");
        }

        const accessToken = await getEfiAuthToken();
        const { keyBuffer, certBuffer } = await getEfiCertificates();
        const isSandbox = secrets.efiSandbox === 'true';
        const hostname = isSandbox ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';
        const webhookBody = JSON.stringify({ webhookUrl });
        const options = {
            hostname,
            path: `/v2/webhook/${pixKey}`,
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            cert: certBuffer,
            key: keyBuffer,
        };
        const response = await httpsRequest(options, webhookBody);
        return { success: true, message: "Webhook configurado com sucesso!", response };
    } catch (error) {
        logger.error("Falha ao configurar o webhook PIX na Efí:", error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Não foi possível configurar o webhook.");
    }
});



export const payForDiet = onCall({ cpu: 1 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Você precisa estar logado.");
    }
    const pickerUid = request.auth.uid;
    const { dietId, pixCode } = request.data;
    if (!dietId || !pixCode) {
        throw new HttpsError("invalid-argument", "O ID da dieta e o código PIX são obrigatórios.");
    }

    try {
        const finalResult = await db.runTransaction(async (transaction) => {
            const userDocRef = db.collection('users').doc(pickerUid);
            const userDoc = await transaction.get(userDocRef);
            if (!userDoc.exists || userDoc.data()?.picker?.role !== 'picker') {
                throw new HttpsError("permission-denied", "Você não tem permissão de picker.");
            }

            const dietDocRef = db.collection('diets').doc(dietId);
            const dietDoc = await transaction.get(dietDocRef);
            if (!dietDoc.exists) {
                throw new HttpsError("not-found", "A dieta não foi encontrada.");
            }

            const dietData = dietDoc.data();
            if (dietData?.currentStatus.status !== 'in_separation_progress') {
                throw new HttpsError("failed-precondition", `Esta dieta não está em separação (status: ${dietData?.currentStatus.status}).`);
            }

            // <<< CORREÇÃO AQUI: A verificação agora é mais específica >>>
            // Só bloqueia se o pagamento JÁ FOI PAGO com sucesso.
            if (dietData?.purchaseDetails?.isPaid === true) {
                throw new HttpsError("failed-precondition", "O pagamento para esta dieta já foi concluído.");
            }

            const parsedPix = parsePix(pixCode);
            const pixPrice = parseFloat(parsedPix['54'] || '0.00');
            if (pixPrice === 0) {
                throw new HttpsError("invalid-argument", "O valor do PIX não pode ser zero.");
            }

            const paymentApiResponse = await _initiatePixPaymentLogic(pixCode);
            const storeName = parsedPix['59'] || 'Estabelecimento não identificado';

            switch (paymentApiResponse.status) {
                case 'CONCLUIDO':
                    const successDetails = {
                        pixCode,
                        txid: paymentApiResponse.idEnvio,
                        endToEndId: paymentApiResponse.e2eId ?? null,
                        isPaid: true,
                        paymentConfirmedAt: admin.firestore.Timestamp.now(),
                        totalAmount: pixPrice,
                        currency: "BRL",
                        storeName: storeName,
                        status: 'completed'
                    };
                    transaction.update(dietDocRef, { purchaseDetails: successDetails });
                    return { status: 'CONCLUIDO', paymentResult: paymentApiResponse };

                case 'EM_PROCESSAMENTO':
                    const pendingDetails = {
                        pixCode,
                        txid: paymentApiResponse.idEnvio,
                        endToEndId: paymentApiResponse.e2eId ?? null,
                        isPaid: false,
                        paymentInitiatedAt: admin.firestore.Timestamp.now(),
                        totalAmount: pixPrice,
                        currency: "BRL",
                        storeName: storeName,
                        status: 'processing'
                    };
                    transaction.update(dietDocRef, {
                        purchaseDetails: pendingDetails,
                    });
                    return { status: 'EM_PROCESSAMENTO', paymentResult: paymentApiResponse };

                default:
                    throw new HttpsError("aborted", `O pagamento foi recusado pela plataforma financeira. Status: ${paymentApiResponse.status}`);
            }
        });

        if (finalResult.status === 'CONCLUIDO') {
            return { success: true, status: 'CONCLUIDO', message: "Pagamento realizado com sucesso!", paymentResult: finalResult.paymentResult };
        } else {
            return { success: true, status: 'EM_PROCESSAMENTO', message: "Pagamento em processamento. Aguardando confirmação.", paymentResult: finalResult.paymentResult };
        }

    } catch (error: any) {
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError("internal", error.message || "Ocorreu um erro desconhecido ao processar o pagamento.");
    }
});

/**
 * Processa o pagamento da corrida de entrega feito pelo picker via código PIX.
 */
export const payForRide = onCall({ cpu: 1 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Você precisa estar logado.");
    }
    const pickerUid = request.auth.uid;
    const { dietId, pixCode } = request.data;
    if (!dietId || !pixCode) {
        throw new HttpsError("invalid-argument", "O ID da dieta e o código PIX são obrigatórios.");
    }

    try {
        const finalResult = await db.runTransaction(async (transaction) => {
            const userDocRef = db.collection('users').doc(pickerUid);
            const userDoc = await transaction.get(userDocRef);
            if (!userDoc.exists || userDoc.data()?.picker?.role !== 'picker') {
                throw new HttpsError("permission-denied", "Você não tem permissão de picker.");
            }

            const dietDocRef = db.collection('diets').doc(dietId);
            const dietDoc = await transaction.get(dietDocRef);
            if (!dietDoc.exists) {
                throw new HttpsError("not-found", "A dieta não foi encontrada.");
            }
            if (dietDoc.data()?.deliveryDetails?.ridePayment?.isPaid) {
                throw new HttpsError("failed-precondition", "O pagamento para esta corrida já foi concluído.");
            }

            let paymentApiResponse;
            let parsedPix;
            try {
                parsedPix = parsePix(pixCode);
                paymentApiResponse = await _initiatePixPaymentLogic(pixCode);
            } catch (paymentError: any) {
                throw new HttpsError("invalid-argument", paymentError.message);
            }

            const storeName = parsedPix['59'] || 'Motorista';
            const pixPrice = parseFloat(parsedPix['54'] || '0.00');

            switch (paymentApiResponse.status) {
                case 'CONCLUIDO':
                    const successDetails = {
                        pixCode,
                        txid: paymentApiResponse.idEnvio,
                        endToEndId: paymentApiResponse.endToEndId ?? null, // Garante que não será undefined
                        isPaid: true,
                        paymentConfirmedAt: admin.firestore.Timestamp.now(),
                        totalAmount: pixPrice,
                        recipientName: storeName,
                        status: 'completed'
                    };
                    transaction.update(dietDocRef, { "deliveryDetails.ridePayment": successDetails });
                    return { status: 'CONCLUIDO', paymentResult: paymentApiResponse };

                case 'EM_PROCESSAMENTO':
                    const pendingDetails = {
                        pixCode,
                        txid: paymentApiResponse.idEnvio,
                        endToEndId: paymentApiResponse.endToEndId ?? null, // Garante que não será undefined
                        isPaid: false,
                        paymentInitiatedAt: admin.firestore.Timestamp.now(),
                        totalAmount: pixPrice,
                        recipientName: storeName,
                        status: 'processing'
                    };
                    transaction.update(dietDocRef, { "deliveryDetails.ridePayment": pendingDetails });
                    return { status: 'EM_PROCESSAMENTO', paymentResult: paymentApiResponse };

                default:
                    throw new HttpsError("aborted", `O pagamento foi recusado pela plataforma financeira. Status: ${paymentApiResponse.status}`);
            }
        });

        if (finalResult.status === 'CONCLUIDO') {
            return { success: true, status: 'CONCLUIDO', message: "Pagamento realizado com sucesso!", paymentResult: finalResult.paymentResult };
        } else {
            return { success: true, status: 'EM_PROCESSAMENTO', message: "Pagamento em processamento. Aguardando confirmação.", paymentResult: finalResult.paymentResult };
        }

    } catch (error: any) {
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError("internal", error.message || "Ocorreu um erro desconhecido ao processar o pagamento da corrida.");
    }
});



async function _initiatePixPaymentLogic(pixCode: string) {
    logger.info("Iniciando lógica de pagamento real de PIX (payout)...");

    try {
        // 1. Decodifica o PIX
        const parsedPix = parsePix(pixCode);
        const recipientName = parsedPix['59'];
        const pixKeyFromCode = parsedPix['26']?.['01'];
        const pixPrice = parseFloat(parsedPix['54'] || '0.00');

        if (!recipientName || !pixKeyFromCode || pixPrice === 0) {
            throw new HttpsError("invalid-argument", "O código PIX fornecido é inválido ou não contém os dados necessários (chave, valor, nome).");
        }

        // 2. Autentica-se na Efí
        const accessToken = await getEfiAuthToken();
        const { keyBuffer, certBuffer } = await getEfiCertificates();
        const isSandbox = process.env.EFI_SANDBOX === 'true';
        const hostname = isSandbox ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';

        // 3. Obtém a chave PIX da SUA conta (pagadora)
        const payerPixKey = 'bbd6d1fe-318f-42b3-8998-746fc8cef08e'; // Substitua pela sua chave de produção quando aplicável
        if (!payerPixKey) {
            throw new Error("A chave PIX da sua conta (pagadora) não está configurada.");
        }

        // 4. Cria um ID de transação único
        const paymentId = `PAY${uuidv4().replace(/-/g, '')}`.slice(0, 32);

        // 5. Monta o corpo da requisição de pagamento
        const paymentBody = JSON.stringify({
            valor: pixPrice.toFixed(2),
            pagador: {
                chave: payerPixKey
            },
            favorecido: {
                chave: pixKeyFromCode
            }
        });

        // 6. Monta as opções da requisição
        const paymentOptions = {
            hostname,
            path: `/v2/gn/pix/${paymentId}`,
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            cert: certBuffer,
            key: keyBuffer,
        };

        // 7. Executa a requisição
        const paymentResponse = await httpsRequest(paymentOptions, paymentBody);

        // Log crucial para diagnóstico
        logger.info(`Resposta COMPLETA da API de Payout da Efí para o ID [${paymentId}]:`, JSON.stringify(paymentResponse));

        // 8. Retorna a resposta completa para a função principal fazer a verificação
        return paymentResponse;

    } catch (error: any) {
        // Log crucial de erro
        logger.error("Falha CRÍTICA ao processar pagamento PIX na Efí. Objeto de erro:", JSON.stringify(error));

        // Propaga o erro de forma clara
        throw new HttpsError("internal", error.message || "Não foi possível processar o pagamento PIX junto à plataforma financeira.");
    }
}



/**
 * Helper para cancelar e estornar um pedido automaticamente.
 */
export async function cancelAndRefundOrder(docRef: admin.firestore.DocumentReference, diet: Diet, reason: string): Promise<void> {
    try {
        // CORREÇÃO: Usando 'txid' em vez de 'e2eId'
        const txid = diet.paymentDetails?.txid;
        if (!txid) {
            throw new Error("txid não encontrado para estorno. ");
        }

        const refundDetails = await _initiatePixRefundLogic(txid, diet.totalPrice, reason);

        const newStatus = {
            status: 'in_refund_progress' as const,
            timestamp: admin.firestore.Timestamp.now(),
            reason: reason
        };
        await docRef.update({
            currentStatus: newStatus,
            statusHistory: admin.firestore.FieldValue.arrayUnion(newStatus),
            refundDetails: refundDetails
        });
    } catch (error) {
        logger.error(`Falha CRÍTICA ao tentar cancelar e estornar automaticamente o pedido [${docRef.id}]:`, error);
        await docRef.update({ "internalError": `Auto-cancel failed: ${(error as Error).message}` });
    }
}