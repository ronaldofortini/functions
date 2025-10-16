import * as functions from "firebase-functions";
import * as admin from "firebase-admin"; // 1. IMPORTAR FIREBASE-ADMIN
// import sgMail from "@sendgrid/mail";
// import { getSecrets } from "../core/secrets";
// import { HttpsError } from "firebase-functions/v2/https";
// import { Diet, ChatMessage } from "../core/models";
// import { logger } from "firebase-functions";
// import { Transaction } from "firebase-admin/firestore";

// import { onTaskDispatched } from "firebase-functions/v2/tasks";
// import { CloudTasksClient } from "@google-cloud/tasks";
// import * as sgMail from "@sendgrid/mail";
import { sendEmail } from "../core/utils";
import { onDocumentCreated } from "firebase-functions/v2/firestore"; // Importação v2
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";

const db = admin.firestore();
/**
 * Recebe os dados do formulário de contato do site, valida e envia por e-mail via SendGrid,
 * com uma barreira de segurança para evitar envios repetidos.
 */
export const sendContactEmail = functions.https.onCall({ cpu: 0.25 }, async (request, context) => { // 2. ADICIONAR 'context'
    // --- INÍCIO DA BARREIRA DE SEGURANÇA (RATE LIMITING) ---

    const db = admin.firestore();
    // Define o período de espera em minutos.
    const COOLDOWN_MINUTES = 5;

    // Identifica o remetente pelo UID (se logado) ou pelo IP (se anônimo).
    const identifier = request.auth?.uid || request.rawRequest.ip;
    if (!identifier) {
        throw new functions.https.HttpsError("unauthenticated", "Não foi possível identificar o remetente.");
    }

    const submissionRef = db.collection("contactSubmissions").doc(identifier);
    const doc = await submissionRef.get();

    if (doc.exists) {
        const lastSubmission = doc.data()?.timestamp.toDate();
        const now = new Date();
        // Calcula a diferença em milissegundos
        const difference = now.getTime() - lastSubmission.getTime();
        const minutesPassed = Math.floor(difference / 60000);

        if (minutesPassed < COOLDOWN_MINUTES) {
            functions.logger.warn(`Envio bloqueado para '${identifier}'. Tentativa antes do cooldown de ${COOLDOWN_MINUTES} min.`);
            // Este código de erro ('resource-exhausted') é apropriado para rate limiting.
            throw new functions.https.HttpsError(
                "resource-exhausted",
                `Você já enviou uma mensagem recentemente. Por favor, aguarde ${COOLDOWN_MINUTES} minutos.`
            );
        }
    }


    const { name, email, subject, message } = request.data;

    if (!name || !email || !subject || !message) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "Todos os campos do formulário são obrigatórios."
        );
    }

    // --- NOVA LÓGICA PARA STATUS DO USUÁRIO ---
    // Verifica se o usuário estava logado no momento do envio.
    const isLoggedIn = !!request.auth?.uid;
    const userStatus = isLoggedIn
        ? `Usuário Logado (UID: ${request.auth?.uid})`
        : "Usuário Anônimo";
    // --- FIM DA NOVA LÓGICA ---

    // const fromEmail = "noreply@colormind.com.br";
    const toEmail = "ronaldo.fortini.jr@gmail.com"; // Altere para o seu e-mail de destino

    const emailHtml = ` <div style="font-family: Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #333;">
        <h2>Nova mensagem recebida pelo formulário de contato</h2>
        <p>Você recebeu uma nova mensagem de <strong>${name}</strong> (${email}).</p>
        
        <p style="background-color: #eee; padding: 10px; border-radius: 5px; font-size: 14px;">
          <strong>Status do Remetente:</strong> ${userStatus}
        </p>
        
        <hr style="border: 0; border-top: 1px solid #eee;">
        <h3>Detalhes da Mensagem:</h3>
        <ul style="list-style-type: none; padding: 0;">
          <li><strong>Nome:</strong> ${name}</li>
          <li><strong>Email:</strong> ${email}</li>
          <li><strong>Assunto:</strong> ${subject}</li>
        </ul>
        <div style="background-color: #f9f9f9; border: 1px solid #ddd; padding: 15px; border-radius: 5px; margin-top: 10px;">
          <p style="margin-top: 0;"><strong>Mensagem:</strong></p>
          <p style="margin-bottom: 0;">${message}</p>
        </div>
      </div>`;

    try {
        // << MUDANÇA AQUI >>
        // Usando a nossa nova função sendEmail.
        // O `fromName` é opcional, mas podemos customizar.
        await sendEmail(toEmail, `Novo Contato: ${subject}`, emailHtml, "Contato via Site");

        await submissionRef.set({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            userEmail: email,
        });

        logger.info(`E-mail de contato de ${email} enviado com sucesso.`);
        return { success: true, message: "Mensagem enviada com sucesso!" };
    } catch (error) {
        logger.error("Erro ao enviar e-mail de contato:", error);
        throw new functions.https.HttpsError(
            "internal",
            "Ocorreu um erro ao enviar a sua mensagem. Tente novamente mais tarde."
        );
    }
});








/**
 * Gatilho do Firestore (v2) que atualiza o resumo do chat na dieta principal
 * sempre que uma nova mensagem é criada na subcoleção de chat.
 */
export const onChatMessageCreate = onDocumentCreated("diets/{dietId}/chatMessages/{messageId}", async (event) => {
    // A sintaxe v2 usa um único objeto 'event'
    if (!event.data) {
        logger.warn("Nenhum dado encontrado no evento de criação de mensagem.");
        return;
    }

    const { dietId } = event.params;
    const message = event.data.data(); // Os dados do documento estão em event.data.data()

    const dietRef = db.doc(`diets/${dietId}`);
    const lastChatMessage = {
        text: message.text || "",
        senderType: message.senderType || "user",
        senderId: message.senderId || "",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };

    let updateData: { [key: string]: any; };

    if (message.senderType === 'user') {
        updateData = {
            "support.lastChatMessage": lastChatMessage,
            "support.chatStatus": "open",
            "support.supportUnreadCount": admin.firestore.FieldValue.increment(1),
        };
    } else if (message.senderType === 'support') {
        updateData = {
            "support.lastChatMessage": lastChatMessage,
            "support.chatStatus": "awaiting_user_response",
            "support.userUnreadCount": admin.firestore.FieldValue.increment(1),
        };
    } else {
        logger.warn(`SenderType desconhecido: '${message.senderType}' na dieta ${dietId}`);
        return;
    }

    try {
        await dietRef.update(updateData);
        logger.info(`Diet ${dietId} atualizado com a nova mensagem de ${message.senderType}.`);
    } catch (err) {
        logger.error(`Erro ao atualizar o resumo do chat para a dieta ${dietId}:`, err);
    }
});

/**
 * Permite que um usuário (cliente ou suporte) marque as mensagens de um chat como lidas.
 */
export const markMessagesAsRead = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Você precisa estar logado para executar esta ação.");
    }

    const { dietId } = request.data;
    if (!dietId || typeof dietId !== "string") {
        throw new HttpsError("invalid-argument", "O 'dietId' é obrigatório e deve ser uma string.");
    }

    const uid = request.auth.uid;
    const isSupportUser = request.auth.token.isSupport === true;
    const dietRef = db.collection("diets").doc(dietId);

    try {
        const updateData: { [key: string]: any } = {};

        if (isSupportUser) {
            updateData["support.supportUnreadCount"] = 0;
        } else {
            const diet = (await dietRef.get()).data();
            if (diet?.userId !== uid) {
                throw new HttpsError("permission-denied", "Você não tem permissão para modificar esta dieta.");
            }
            updateData["support.userUnreadCount"] = 0;
        }

        await dietRef.update(updateData);
        logger.info(`Chat da dieta ${dietId} marcado como lido.`, { updatedBy: uid });

        return { success: true, message: `Mensagens da dieta ${dietId} marcadas como lidas.` };
    } catch (error) {
        logger.error(`Erro ao marcar mensagens como lidas para a dieta ${dietId}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Ocorreu um erro inesperado ao processar sua solicitação.");
    }
});
























