import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
// import sgMail = require("@sendgrid/mail");
// const sgClient = require("@sendgrid/client");
import Holidays from "date-holidays";
// import { onCall } from "firebase-functions/v2/https";
// import * as client from "@sendgrid/client";
import { Diet } from "@models/models";

import { _initiatePixRefundLogic, formatFirstName, formatOrderIdForDisplay, getDeliverySchedule, sendEmail, sendSms } from "../core/utils";
import {
    getSeparationProgressEmailHTML, getDelayedDeliveryEmailHTML,
    getAutoCancelledRefundEmailHTML, getDeliveredEmailHTML, getRefundProcessedEmailHTML,
    getAdminRefundAlertEmailHTML, getDeliveryProgressEmailHTML, getPaymentApprovedEmailHTML,
    getPendingPaymentEmailHTML, getNotifyingPickerEmailHTML, getCancelledEmailHTML, getSupportInitiatedContactEmailHTML,
    getSupportReplyNotificationEmailHTML, getNewSupportMessageEmailHTML, getPersonalDataChangedAlertEmailHTML,
    getNextDayAvailableEmailHTML, getQueueAvailableEmailHTML, getRegionAvailableEmailHTML, getPendingPaymentReminderEmailHTML
} from "../core/email-templates";

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/scheduler";

// const db = admin.firestore();

// =========================================================================
// FUNÇÕES AUXILIARES DE NOTIFICAÇÃO
// =========================================================================

/**
 * Envia um e-mail usando SendGrid, utilizando o @sendgrid/client que provou funcionar.
 */
// async function sendEmail(email: string, subject: string, html: string, secrets: any): Promise<void> {
//     if (!secrets.sendgridKey) {
//         logger.error("Chave da API do SendGrid não encontrada.");
//         return;
//     }

//     // 1. Configura a chave na instância do @sendgrid/client
//     sgClient.setApiKey(secrets.sendgridKey);

//     // 2. Monta a requisição para a API v3 de envio de e-mail
//     const request = {
//         method: 'POST' as const,
//         url: '/v3/mail/send',
//         body: {
//             personalizations: [{
//                 to: [{ email: email }]
//             }],
//             from: { name: "colormind", email: "noreply@colormind.com.br" },
//             subject: subject,
//             content: [{
//                 type: 'text/html',
//                 value: html
//             }]
//         }
//     };

//     try {
//         // 3. Envia a requisição usando o método .request() que sabemos que funciona
//         await sgClient.request(request);
//         logger.info(`E-mail com assunto "${subject}" enviado para ${email} via @sendgrid/client.`);
//     } catch (error: any) {
//         logger.error(`Falha ao enviar e-mail via @sendgrid/client para ${email}:`, error);
//         if (error.response) {
//             logger.error("Detalhes da resposta do erro do SendGrid:", error.response.body);
//         }
//         // Re-lança o erro para que a função que chamou saiba que falhou
//         throw error;
//     }
// }




// /**
//  * Helper para cancelar e estornar um pedido automaticamente.
//  */
// async function cancelAndRefundOrder(docRef: admin.firestore.DocumentReference, diet: Diet, reason: string): Promise<void> {
//     try {
//         const e2eId = diet.paymentDetails?.endToEndId;
//         if (!e2eId) {
//             throw new Error("endToEndId não encontrado para estorno.");
//         }
//         const refundDetails = await _initiatePixRefundLogic(e2eId, diet.totalPrice, reason);
//         const newStatus = {
//             status: 'in_refund_progress' as const,
//             timestamp: admin.firestore.Timestamp.now(),
//             reason: reason
//         };
//         await docRef.update({
//             currentStatus: newStatus,
//             statusHistory: admin.firestore.FieldValue.arrayUnion(newStatus),
//             refundDetails: refundDetails,
//             picker: admin.firestore.FieldValue.delete()
//         });
//     } catch (error) {
//         logger.error(`Falha CRÍTICA ao tentar cancelar e estornar automaticamente o pedido [${docRef.id}]:`, error);
//         await docRef.update({ "internalError": `Auto-cancel failed: ${(error as Error).message}` });
//     }
// }

// =========================================================================
// FUNÇÕES PRINCIPAIS EXPORTADAS (TRIGGERS DE NOTIFICAÇÃO)
// =========================================================================

/**
 * Gatilho principal que dispara notificações com base na mudança de status da dieta.
 */
export const onDietStatusChange = onDocumentWritten("diets/{dietId}", async (event) => {
    if (!event.data) { return; }
    const { before, after } = event.data;
    if (!after.exists) { return; }
    const afterData = after.data() as Diet;
    if (!afterData) { return; }
    const beforeData = before.exists ? before.data() as Diet : null;

    const paymentWasJustApproved = beforeData?.paymentDetails?.status !== 'approved' && afterData.paymentDetails?.status === 'approved';
    if (paymentWasJustApproved) {
        logger.info(`Pagamento APROVADO para [${event.params.dietId}]. Atualizando status para 'confirmed'.`);
        const newStatus = { status: "confirmed" as const, timestamp: admin.firestore.Timestamp.now() };
        return after.ref.update({
            currentStatus: newStatus,
            statusHistory: admin.firestore.FieldValue.arrayUnion(newStatus)
        });
    }

    const statusHasChanged = !beforeData || (beforeData.currentStatus?.status !== afterData.currentStatus?.status);
    if (!statusHasChanged) {
        return;
    }

    logger.log(`Status da dieta ${event.params.dietId} mudou para '${afterData.currentStatus?.status}'. Preparando notificações.`);

    const { userEmail, userFullName, userPhone, id: orderId, totalPrice } = afterData;
    const firstName = formatFirstName(userFullName);

    if (!userEmail || !firstName || !userPhone) {
        logger.warn(`Dieta ${orderId} não tem userEmail, userFullName ou userPhone. Notificações não podem ser enviadas.`);
        return;
    }

    const notificationPromises: Promise<any>[] = [];
    try {

        const dietFormattedId = formatOrderIdForDisplay(orderId);
        const adminEmail = 'ronaldo.fortini.jr@gmail.com';

        switch (afterData.currentStatus.status) {
            case 'pending': {
                const subject = `Sua dieta está pronta para pagamento, ${firstName}!`;
                const html = getPendingPaymentEmailHTML({
                    firstName, orderId, totalPrice,
                    pixCopiaECola: afterData.paymentDetails?.copiaECola || '',
                    qrCodeImageUrl: afterData.paymentDetails?.qrCodeImageUrl || ''
                });
                notificationPromises.push(sendEmail(userEmail, subject, html));
                break;
            }
            case 'confirmed': {
                const subject1 = `Pagamento APROVADO, ${firstName}!`;
                const html1 = getPaymentApprovedEmailHTML({ firstName, orderId, totalPaid: totalPrice });
                // const sms1 = `Oba, ${firstName}! Recebemos o pagamento da sua dieta. Ja estamos preparando o proximo passo.`; //ATIVAR AO ENTRAR EM PROD
                await Promise.all([
                    sendEmail(userEmail, subject1, html1),
                    // sendSms(userPhone, sms1) //ATIVAR AO ENTRAR EM PROD
                ]);
                let orderTimestamp: admin.firestore.Timestamp;
                if (afterData.timestamp instanceof admin.firestore.Timestamp) {
                    // Se for, apenas atribua o valor.
                    orderTimestamp = afterData.timestamp;
                } else {
                    // Se não for (provavelmente é um Date), converta-o para um Timestamp.
                    orderTimestamp = admin.firestore.Timestamp.fromDate(afterData.timestamp as Date);
                }
                const schedule = getDeliverySchedule(orderTimestamp);

                
                if (schedule.scheduleType === 'immediate') {
                    await new Promise(resolve => setTimeout(resolve, 6000));
                    const subject2 = `🔎 Encontrando um Picker para separar sua dieta, ${firstName}!`;
                    const html2 = getNotifyingPickerEmailHTML({ firstName });
                    notificationPromises.push(sendEmail(userEmail, subject2, html2));
                } else {
                    const subject2 = `Seu pedido foi confirmado e agendado, ${firstName}!`;
                    const html2 = getDelayedDeliveryEmailHTML({ firstName, deliveryDay: schedule.deliveryDay });
                    notificationPromises.push(sendEmail(userEmail, subject2, html2));
                    await after.ref.update({ deliveryScheduledFor: schedule.scheduledTimestamp });
                }
                break;
            }
            case 'in_separation_progress': {
                const subject = `🧑‍🌾 Já estamos separando os alimentos da sua dieta, ${firstName}!`;
                const html = getSeparationProgressEmailHTML({ firstName });
                notificationPromises.push(sendEmail(userEmail, subject, html));
                break;
            }
            case 'in_delivery_progress': {
                const subject = `Sua dieta está a caminho, ${firstName}!`;
                const html = getDeliveryProgressEmailHTML({ firstName, address: afterData.address, driver: afterData.deliveryDetails?.driver });
                notificationPromises.push(sendEmail(userEmail, subject, html));
                break;
            }
            case 'delivered': {
                const subject = `Sua dieta foi entregue! 🤗`;
                const html = getDeliveredEmailHTML({ firstName });
                const sms = `Sua dieta foi entregue! Esperamos que goste!`;
                notificationPromises.push(sendEmail(userEmail, subject, html));
                notificationPromises.push(sendSms(userPhone, sms));
                break;
            }
            case 'cancelled': {
                const reason = afterData.currentStatus.reason || '';
                const refundAmount = afterData.refundDetails?.amount;
                if (refundAmount && refundAmount > 0) {
                    const emailTemplate = reason.includes("automaticamente") ? getAutoCancelledRefundEmailHTML : getRefundProcessedEmailHTML;
                    const subject = `Seu pedido ${dietFormattedId} foi cancelado e estornado`;
                    const customerEmailHtml = emailTemplate({ firstName, orderId, refundAmount });
                    notificationPromises.push(sendEmail(userEmail, subject, customerEmailHtml));
                    const adminEmailHtml = getAdminRefundAlertEmailHTML({ orderIdFormatted: dietFormattedId, customerName: userFullName, reason, refundAmount, adminPanelLink: `https://admin-b5d5a.web.app/${orderId}` });
                    notificationPromises.push(sendEmail(adminEmail, `[INFO] Pedido Estornado: ${dietFormattedId}`, adminEmailHtml));
                } else {
                    const subject = `Seu pedido ${dietFormattedId} foi cancelado`;
                    const html = getCancelledEmailHTML({ firstName, orderId, reason: reason || 'Pagamento não identificado no prazo.' });
                    notificationPromises.push(sendEmail(userEmail, subject, html));
                }
                break;
            }
        }
    } catch (error) {
        logger.error(`Falha ao preparar ou enviar notificações para a dieta ${event.params.dietId}:`, error);
        return;
    }
    return Promise.all(notificationPromises);
});


export const handleSupportChatUpdates = onDocumentUpdated({
    document: "diets/{dietId}",
    region: "southamerica-east1",
}, async (event) => {
    const { dietId } = event.params;
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    if (!afterData?.support) { return; }
    const beforeSupport = beforeData?.support ?? {};

    const remindersRef = admin.firestore().collection("scheduledChatReminders");

    const lastSender = afterData.support.lastChatMessage?.senderType;
    const isFirstMessageEver = !beforeSupport.lastChatMessage;

    if ((beforeSupport.userUnreadCount ?? 0) > 0 && afterData.support.userUnreadCount === 0) {
        await remindersRef.doc(`notify_user_${dietId}`).delete().catch(() => { });
    }
    if ((beforeSupport.supportUnreadCount ?? 0) > 0 && afterData.support.supportUnreadCount === 0) {
        await remindersRef.doc(`notify_support_${dietId}`).delete().catch(() => { });
    }

    if (lastSender === 'support' && afterData.support.userUnreadCount > (beforeSupport.userUnreadCount ?? 0)) {
        if (afterData.support.lastChatMessage?.senderId === 'SYSTEM') {
            return;
        }
        if (!afterData.userEmail || !afterData.userFullName) { return; }

        if (isFirstMessageEver) {
            logger.info(`[${dietId}] Suporte iniciou o contato. Enviando e-mail imediato para o usuário.`);
            try {
                const emailHTML = getSupportInitiatedContactEmailHTML({
                    firstName: formatFirstName(afterData.userFullName),
                    orderId: dietId
                });
                const subject = `Temos uma mensagem para você sobre seu pedido!`;

                await sendEmail(afterData.userEmail, subject, emailHTML);

            } catch (error) {
                console.error(`[${dietId}] Falha ao enviar e-mail de notificação (contato iniciado pelo suporte):`, error);
            }
        }
        else {
            const reminderDoc = {
                type: 'notifyUser',
                dietId: dietId,
                userEmail: afterData.userEmail,
                userName: formatFirstName(afterData.userFullName),
                notifyAt: admin.firestore.Timestamp.fromMillis(Date.now() + 300000)
            };
            await remindersRef.doc(`notify_user_${dietId}`).set(reminderDoc);
            logger.info(`[${dietId}] Lembrete para notificar o usuário (resposta do suporte) foi agendado.`);
        }
    }
    else if (lastSender === 'user' && afterData.support.supportUnreadCount > (beforeSupport.supportUnreadCount ?? 0)) {
        if (!afterData.userFullName) { return; }

        if (isFirstMessageEver) {
            logger.info(`[${dietId}] Primeira mensagem do usuário. Enviando auto-resposta em duas partes com delay.`);

            const firstName = formatFirstName(afterData.userFullName);
            const dietRef = admin.firestore().collection("diets").doc(dietId);
            const messagesCollectionRef = dietRef.collection("chatMessages");

            (async () => {
                try {
                    // ETAPA 1: Envia a primeira mensagem ("Olá!") imediatamente
                    const autoReplyText1 = `Olá, ${firstName}!`;
                    const message1 = {
                        senderId: "SYSTEM",
                        senderType: "support" as const,
                        text: autoReplyText1,
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        isRead: false
                    };
                    const dietUpdate1 = {
                        'support.lastChatMessage': {
                            text: message1.text,
                            senderType: message1.senderType,
                            senderId: message1.senderId,
                            timestamp: message1.timestamp
                        },
                        'support.userUnreadCount': admin.firestore.FieldValue.increment(1)
                    };

                    const batch1 = admin.firestore().batch();
                    batch1.set(messagesCollectionRef.doc(), message1);
                    batch1.update(dietRef, dietUpdate1);
                    await batch1.commit();

                    // Envia o e-mail de notificação para o suporte imediatamente
                    const emailHTML = getNewSupportMessageEmailHTML({ userFullName: afterData.userFullName, dietId, adminPanelLink: 'https://admin-b5d5a.web.app/' });
                    const toEmail = 'ronaldo.fortini.jr@gmail.com';
                    const subject = `Novo Chamado: ${afterData.userFullName}`;
                    await sendEmail(toEmail, subject, emailHTML);

                    // ETAPA 2: Aguarda 1.5 segundos para parecer mais natural
                    const delayInMs = 100;
                    await new Promise(resolve => setTimeout(resolve, delayInMs));

                    // ETAPA 3: Envia a segunda mensagem
                    const autoReplyText2 = `Responderemos assim que possível, aguarde um instante.`;
                    const message2 = {
                        senderId: "SYSTEM",
                        senderType: "support" as const,
                        text: autoReplyText2,
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        isRead: false
                    };
                    const dietUpdate2 = {
                        'support.lastChatMessage': {
                            text: message2.text,
                            senderType: message2.senderType,
                            senderId: message2.senderId,
                            timestamp: message2.timestamp
                        },
                        'support.userUnreadCount': admin.firestore.FieldValue.increment(1)
                    };

                    const batch2 = admin.firestore().batch();
                    batch2.set(messagesCollectionRef.doc(), message2);
                    batch2.update(dietRef, dietUpdate2);
                    await batch2.commit();

                } catch (error) {
                    logger.error(`[${dietId}] Erro ao processar a primeira mensagem em duas etapas:`, error);
                }
            })();
        }

        const reminderDoc = {
            type: 'notifySupport',
            dietId: dietId,
            userFullName: afterData.userFullName,
            notifyAt: admin.firestore.Timestamp.fromMillis(Date.now() + 300000),
            reminderCount: 1
        };
        await remindersRef.doc(`notify_support_${dietId}`).set(reminderDoc);
        logger.info(`[${dietId}] Lembrete Nível 1 para o SUPORTE foi agendado.`);
    }
});




/**
 * VERIFICADOR: Roda a cada minuto para procurar e processar lembretes agendados.
 */
export const processPendingChatNotifications = onSchedule("every 1 minutes", async (event) => {
    logger.info("A executar verificação de lembretes de chat agendados...");
    const now = admin.firestore.Timestamp.now();
    const db = admin.firestore();
    const remindersRef = db.collection("scheduledChatReminders");

    const snapshot = await remindersRef.where('notifyAt', '<=', now).get();
    if (snapshot.empty) {
        logger.info("Nenhum lembrete de chat pendente encontrado.");
        return;
    }

    logger.info(`Encontrados ${snapshot.docs.length} lembretes para processar.`);

    const processingPromises: Promise<any>[] = [];

    for (const doc of snapshot.docs) {
        const reminderData = doc.data();
        const { dietId, type } = reminderData;

        const promise = (async () => {
            const dietDocRef = db.collection("diets").doc(dietId);
            const dietDoc = await dietDocRef.get();
            if (!dietDoc.exists) {
                await doc.ref.delete();
                return;
            }
            const dietData = dietDoc.data();

            try {
                switch (type) {
                    case 'notifyUser':
                        if ((dietData?.support?.userUnreadCount ?? 0) > 0) {
                            const { userEmail, userName } = reminderData;
                            const subject = `Temos uma nova resposta no chat de suporte!`;
                            const emailHTML = getSupportReplyNotificationEmailHTML({ firstName: userName });
                            await sendEmail(userEmail, subject, emailHTML);
                        }
                        break;

                    case 'notifySupport':
                        if ((dietData?.support?.supportUnreadCount ?? 0) > 0) {
                            const { userFullName, reminderCount = 1 } = reminderData;
                            const toEmail = 'ronaldo.fortini.jr@gmail.com';
                            let subject = '';
                            let nextDelayMinutes = 0;

                            switch (reminderCount) {
                                case 1:
                                    subject = `Pendente: Nova mensagem de ${userFullName}`;
                                    nextDelayMinutes = 10;
                                    break;
                                case 2:
                                    subject = `URGENTE: Mensagem de ${userFullName} aguardando há 15 minutos`;
                                    nextDelayMinutes = 15;
                                    break;
                                case 3:
                                    subject = `ALERTA FINAL: Resposta para ${userFullName} está atrasada há 30 minutos`;
                                    break;
                            }

                            const emailHTML = getNewSupportMessageEmailHTML({ userFullName, dietId, adminPanelLink: 'https://admin-b5d5a.web.app' });
                            await sendEmail(toEmail, subject, emailHTML);
                            logger.info(`[${dietId}] SUCESSO: E-mail de lembrete Nível ${reminderCount} enviado para o SUPORTE.`);

                            if (nextDelayMinutes > 0) {
                                await doc.ref.update({
                                    notifyAt: admin.firestore.Timestamp.fromMillis(Date.now() + nextDelayMinutes * 60000),
                                    reminderCount: reminderCount + 1
                                });
                                return;
                            }
                        }
                        break;

                    case 'sendApologyMessage':
                        const lastMessage = dietData?.support?.lastChatMessage;
                        if (lastMessage?.senderType === 'user' || lastMessage?.senderId === 'SYSTEM') {
                            const messagesCollectionRef = dietDocRef.collection("chatMessages");

                            const apologyText1 = "Pedimos desculpa pela demora.";
                            const apologyText2 = "Se o seu caso for urgente, entre em contato através do e-mail suporte@colormind.com.br.";

                            const message1 = { senderId: "SYSTEM", senderType: "support" as const, text: apologyText1, timestamp: admin.firestore.FieldValue.serverTimestamp(), isRead: false };
                            const message2 = { senderId: "SYSTEM", senderType: "support" as const, text: apologyText2, timestamp: admin.firestore.FieldValue.serverTimestamp(), isRead: false };

                            const dietUpdate = {
                                'support.lastChatMessage': { text: message2.text, senderType: message2.senderType, senderId: message2.senderId, timestamp: message2.timestamp },
                                'support.userUnreadCount': admin.firestore.FieldValue.increment(2)
                            };

                            const batch = db.batch();
                            batch.set(messagesCollectionRef.doc(), message1);
                            batch.set(messagesCollectionRef.doc(), message2);
                            batch.update(dietDocRef, dietUpdate);
                            await batch.commit();
                            logger.info(`[${dietId}] Mensagens de desculpas por atraso enviadas com sucesso.`);
                        }
                        break;
                }
            } catch (error) {
                logger.error(`Falha ao processar lembrete para dietId ${dietId}:`, error);
            }

            await doc.ref.delete();
        })();
        processingPromises.push(promise);
    }
    await Promise.all(processingPromises);
});


/**
 * GATILHO: Disparado quando um documento de usuário é atualizado.
 * AÇÃO: Se os dados pessoais foram alterados, envia um e-mail de alerta de segurança.
 */
export const onPersonalDataChange = onDocumentUpdated("users/{userId}", async (event) => {
    if (!event.data) { return; }
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    // Compara o timestamp da última edição. Esta é a forma mais segura e eficiente
    // de detectar que a função 'updatePersonalData' foi executada.
    const personalDataWasJustUpdated =
        beforeData?.personalDataEditedAt?.toMillis() !== afterData?.personalDataEditedAt?.toMillis();

    if (personalDataWasJustUpdated) {
        logger.info(`Dados pessoais alterados para o usuário [${event.params.userId}]. Enviando e-mail de alerta.`);

        const { email: userEmail, fullName: userFullName } = afterData;
        if (!userEmail || !userFullName) {
            logger.warn(`E-mail ou nome do usuário [${event.params.userId}] não encontrado. E-mail de alerta não enviado.`);
            return;
        }

        try {
            const firstName = formatFirstName(userFullName);
            const subject = "Alerta de Segurança: Seus dados pessoais foram alterados";
            const html = getPersonalDataChangedAlertEmailHTML({ firstName });

            await sendEmail(userEmail, subject, html);

        } catch (error) {
            logger.error(`Falha ao enviar e-mail de alerta de segurança para [${userEmail}]:`, error);
        }
    }
});


/**
 * GATILHO AGENDADO: Roda a cada 10 minutos para encontrar pedidos com pagamento 
 * pendente há mais de 20 minutos e enviar um e-mail de lembrete com a opção de otimização.
 */
export const sendPendingPaymentReminders = onSchedule({
    schedule: "every 10 minutes",
    region: "southamerica-east1",
}, async (event) => {
    logger.info("Iniciando verificação de pagamentos pendentes para envio de lembrete...");

    const db = admin.firestore();
    const dietsRef = db.collection("diets");
    const now = admin.firestore.Timestamp.now();

    // Calcula o tempo limite (20 minutos atrás)
    const tenMinutesAgo = admin.firestore.Timestamp.fromMillis(now.toMillis() - (10 * 60 * 1000));

    // A consulta busca por dietas que:
    // 1. Estão com status 'pending'.
    // 3. Não receberam o lembrete ainda (o campo `pendingReminderSent` não existe ou é falso).
    const query = dietsRef
        .where("currentStatus.status", "==", "pending")
        .where("timestamp", "<=", tenMinutesAgo)
        .where("pendingReminderSent", "==", false);

    const snapshot = await query.get();

    if (snapshot.empty) {
        logger.info("Nenhum pedido pendente elegível para lembrete encontrado.");
        return;
    }

    logger.info(`Encontrados ${snapshot.docs.length} pedidos para enviar lembrete de pagamento.`);

    const emailPromises: Promise<any>[] = [];

    for (const doc of snapshot.docs) {
        const diet = doc.data() as Diet;
        const dietId = doc.id;

        // Validação extra para garantir que temos os dados necessários
        if (!diet.userEmail || !diet.userFullName || !diet.totalPrice) {
            logger.warn(`Dados incompletos para a dieta [${dietId}]. Pulando.`);
            continue;
        }

        const firstName = formatFirstName(diet.userFullName);

        // Gera os links que o template de e-mail precisa
        const paymentLink = `https://colormind.com.br/orders?highlightDiet=${dietId}`;

        // Este link aponta para a sua Cloud Function 'recalculateDietForCost'. 
        // O ideal é criar um endpoint de redirecionamento para não expor a URL da função.
        // Por agora, vamos usar um link direto para a página de pedidos com um parâmetro de ação.
        // O frontend pode ler este parâmetro e chamar a função de recálculo.
        const optimizationLink = `https://colormind.com.br/orders?recalculateDietId=${dietId}`;

        const emailHtml = getPendingPaymentReminderEmailHTML({
            firstName,
            orderId: dietId,
            totalPrice: diet.totalPrice,
            paymentLink,
            optimizationLink,
        });

        const subject = `🤔 Esqueceu algo, ${firstName}? Sua dieta está esperando!`;

        // Adiciona o envio do e-mail à lista de promessas
        const sendPromise = sendEmail(diet.userEmail, subject, emailHtml)
            .then(() => {
                // Se o e-mail for enviado com sucesso, marca a dieta para não enviar de novo
                return doc.ref.update({ pendingReminderSent: true });
            })
            .catch((error) => {
                logger.error(`Falha ao enviar e-mail de lembrete para a dieta [${dietId}]:`, error);
            });

        emailPromises.push(sendPromise);
    }

    // Executa todos os envios de e-mail em paralelo
    await Promise.all(emailPromises);
    logger.info("Processo de envio de lembretes concluído.");
});



/**
 * Orquestrador mestre que roda a cada 10 minutos para executar tarefas agendadas.
 * Substitui as múltiplas funções onSchedule para economizar recursos de CPU.
 */
export const masterScheduler = onSchedule({
    schedule: 'every 10 minutes',
    timeZone: "America/Sao_Paulo",
    region: "southamerica-east1",
    serviceAccount: "1019597328391-compute@developer.gserviceaccount.com",
    cpu: 0.5
}, async (event) => {
    logger.info("Master Scheduler iniciado.");

    // Obtém a data/hora atual na nossa timezone para as verificações
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const minutes = now.getMinutes();
    const hour = now.getHours();
    const dayOfWeek = now.getDay(); // 0 = Domingo, 6 = Sábado

    // Lista de promessas para executar tarefas em paralelo
    const tasks: Promise<any>[] = [];

    // --- Tarefa 1: Verificar a fila de pedidos ---
    // Roda a cada 10 minutos (sempre que o scheduler é acionado)
    tasks.push(runQueueWaitlistLogic().catch(err => logger.error("Erro em runQueueWaitlistLogic:", err)));

    // --- Tarefa 2: Verificar a lista de espera por região ---
    // Roda a cada hora (quando os minutos estão entre 0-9)
    if (minutes < 10) {
        tasks.push(runRegionWaitlistLogic().catch(err => logger.error("Erro em runRegionWaitlistLogic:", err)));
    }

    // --- Tarefa 3: Notificar usuários de "fora de hora" ---
    // Roda de Terça a Sábado, às 08h (quando a hora é 8 e os minutos são 0-9)
    const isWeekdayForNotification = dayOfWeek >= 2 && dayOfWeek <= 6; // Terça a Sábado
    if (isWeekdayForNotification && hour === 8 && minutes < 10) {
        tasks.push(runOffHoursWaitlistLogic().catch(err => logger.error("Erro em runOffHoursWaitlistLogic:", err)));
    }

    // Aguarda a conclusão de todas as tarefas iniciadas
    await Promise.all(tasks);

    logger.info("Master Scheduler finalizado.");
});



/**
 * LÓGICA 1: Verifica se a fila de pedidos liberou e notifica o próximo da lista.
 */
async function runQueueWaitlistLogic() {
    logger.info("Executando lógica: verificação da lista de espera da fila de pedidos...");
    const db = admin.firestore();
    const dietsRef = db.collection('diets');

    const confirmedQuery = dietsRef.where("currentStatus.status", "==", "confirmed");
    const confirmedSnapshot = await confirmedQuery.get();

    if (confirmedSnapshot.size < 3) {
        const waitlistRef = db.collection('waitlist');
        const nextInQueueQuery = waitlistRef
            .where('type', '==', 'queue_full')
            .where('notified', '==', false)
            .orderBy('timestamp', 'asc')
            .limit(1);

        const nextUserSnapshot = await nextInQueueQuery.get();
        if (!nextUserSnapshot.empty) {
            const userToNotify = nextUserSnapshot.docs[0];
            const userData = userToNotify.data();

            const emailHtml = getQueueAvailableEmailHTML({ firstName: userData.firstName });

            await sendEmail(
                userData.email,
                "Sua vaga na fila está disponível!",
                emailHtml
            );

            await userToNotify.ref.update({ notified: true });
            logger.info(`Usuário ${userData.uid} notificado sobre vaga na fila.`);
        }
    } else {
        logger.info(`Fila de pedidos ainda está cheia (${confirmedSnapshot.size}/3). Nenhuma notificação enviada.`);
    }
}

/**
 * LÓGICA 2: Notifica usuários que tentaram pedir fora do horário no dia anterior.
 */
async function runOffHoursWaitlistLogic() {
    logger.info("Executando lógica: verificação da lista de espera por pedidos fora de hora...");
    const db = admin.firestore();
    const hd = new Holidays("BR", "MG");
    const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));

    if (hd.isHoliday(hoje)) {
        logger.info("Hoje é feriado, a notificação de 'fora de hora' não será enviada.");
        return;
    }

    const waitlistRef = db.collection('waitlist');
    const offHoursQuery = waitlistRef
        .where('type', '==', 'off_hours')
        .where('notified', '==', false)
        .orderBy('timestamp', 'asc')
        .limit(3);

    const usersToNotifySnapshot = await offHoursQuery.get();

    if (!usersToNotifySnapshot.empty) {
        const batch = db.batch();

        for (const doc of usersToNotifySnapshot.docs) {
            const userData = doc.data();
            const emailHtml = getNextDayAvailableEmailHTML({ firstName: userData.firstName });

            await sendEmail(
                userData.email,
                "Já estamos prontos para montar sua dieta!",
                emailHtml
            );
            batch.update(doc.ref, { notified: true });
        }
        await batch.commit();
        logger.info(`${usersToNotifySnapshot.size} usuários de 'fora de hora' notificados.`);
    } else {
        logger.info("Nenhum usuário em espera por 'fora de hora' para notificar.");
    }
}

/**
 * LÓGICA 3: Verifica se novas cidades se tornaram ativas e notifica os usuários.
 */
async function runRegionWaitlistLogic() {
    logger.info("Executando lógica: verificação da lista de espera por região...");
    const db = admin.firestore();

    const serviceAreasRef = db.collection('serviceAreas');
    const activeAreasSnapshot = await serviceAreasRef.where('isActive', '==', true).get();
    const activeCities = activeAreasSnapshot.docs.map(doc => doc.id);

    if (activeCities.length === 0) {
        logger.info("Nenhuma área de serviço ativa encontrada.");
        return;
    }

    const waitlistRef = db.collection('waitlist');
    const usersToPotentiallyNotifyQuery = waitlistRef
        .where('type', '==', 'region_unavailable')
        .where('notified', '==', false);

    const snapshot = await usersToPotentiallyNotifyQuery.get();
    if (snapshot.empty) {
        logger.info("Nenhum usuário na lista de espera por região.");
        return;
    }

    const batch = db.batch();
    let notificationCount = 0;

    for (const doc of snapshot.docs) {
        const userData = doc.data();
        const userCityNormalized = userData.address.city.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        if (activeCities.includes(userCityNormalized)) {
            const emailHtml = getRegionAvailableEmailHTML({
                firstName: userData.firstName,
                cityName: userData.address.city
            });

            await sendEmail(
                userData.email,
                `Boas notícias! Já estamos entregando em ${userData.address.city}!`,
                emailHtml
            );

            batch.update(doc.ref, { notified: true });
            notificationCount++;
        }
    }

    if (notificationCount > 0) {
        await batch.commit();
        logger.info(`${notificationCount} usuários notificados com sucesso para novas regiões.`);
    } else {
        logger.info("Nenhum usuário elegível para notificação de nova região nesta execução.");
    }
}


