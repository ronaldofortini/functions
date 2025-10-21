import { onCall, HttpsError, } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { v4 as uuidv4 } from 'uuid';
import sgMail = require("@sendgrid/mail");
import { formatPhone, generateCode, _geocodeAddress, getPercentageFromLevel, getLevelFromPercentage, _interpretHealthDataInternal, sendEmail, formatFirstName } from "../core/utils";
import { getSecrets, twilioClient } from "../core/secrets";
import { cpf } from 'cpf-cnpj-validator';
import { getNewEmailConfirmationHTML, getOldEmailSecurityAlertHTML, getPasswordResetEmailHTML, getAccountDeletionConfirmationEmailHTML } from "../core/email-templates";
// import { Twilio } from "twilio";
import { onSchedule } from "firebase-functions/v2/scheduler"; // Importe onSchedule
import { Address } from "@models/models";




// ========================================================================
// ==                      FUNÇÕES DE INTELIGÊNCIA ARTIFICIAL                    ==
// ========================================================================

export const interpretHealthData = onCall({ cpu: 1 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Autenticação requerida.");
  }
  const { text, type, existingItems } = request.data;
  if (!text || !type || !Array.isArray(existingItems)) {
    throw new HttpsError("invalid-argument", "Os parâmetros 'text', 'type', e 'existingItems' são obrigatórios.");
  }

  try {
    // Apenas chama a função interna e repassa os parâmetros
    const result = await _interpretHealthDataInternal(text, type, existingItems);
    return { success: true, ...result };
  } catch (error: any) {
    // Converte erros internos em HttpsError para o cliente
    throw new HttpsError('internal', error.message || 'Ocorreu um erro ao processar sua solicitação.');
  }
});


// ========================================================================
// ==                      FUNÇÕES DE PERFIL DE USUÁRIO                       ==
// ========================================================================

// PADRONIZADO PARA v2
export const checkUserProfile = onCall({ cpu: 1 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "A função precisa ser chamada por um utilizador autenticado.");
  }

  const uid = request.auth.uid;
  logger.info(`A verificar perfil para o UID: ${uid}`);

  try {
    const userDocRef = admin.firestore().collection("users").doc(uid);
    const doc = await userDocRef.get();

    if (doc.exists) {
      logger.info(`Perfil encontrado para o UID: ${uid}`);
      return { profileExists: true };
    } else {
      logger.warn(`Nenhum perfil encontrado para o UID: ${uid}`);
      return { profileExists: false };
    }
  } catch (error) {
    logger.error(`Erro ao verificar o perfil para o UID: ${uid}`, error);
    throw new HttpsError("internal", "Não foi possível verificar o perfil do utilizador.");
  }
});





// export const updateUserProfile = onCall({ cpu: 1 }, async (request) => {
//   if (!request.auth) {
//     throw new HttpsError("unauthenticated", "Você precisa estar autenticado.");
//   }
//   const uid = request.auth.uid;
//   const data = request.data.profile;

//   if (!data || Object.keys(data).length === 0) {
//     throw new HttpsError("invalid-argument", "Nenhum dado para atualização foi fornecido.");
//   }

//   const userDocRef = admin.firestore().collection("users").doc(uid);

//   const userDoc = await userDocRef.get();
//   if (!userDoc.exists) {
//     throw new HttpsError("not-found", "Usuário não encontrado.");
//   }
//   const currentUserData = userDoc.data();

//   const allowedTopLevelKeys = ["healthProfile", "photoURL"];
//   const allowedHealthKeys = [
//     "weight", "activityLevel", "bodyFatLevel", "bodyFatPercentage",
//     "allergies", "dietaryRestrictions", "healthConditions", "currentMedications"
//   ];

//   const updates: { [key: string]: any } = {};

//   // Loop inicial para construir o objeto de updates (sem alterações)
//   for (const key of Object.keys(data)) {
//     if (allowedTopLevelKeys.includes(key)) {
//       if (key === "healthProfile") {
//         const healthData = data.healthProfile;
//         for (const hpKey of Object.keys(healthData)) {
//           if (allowedHealthKeys.includes(hpKey)) {
//             updates[`healthProfile.${hpKey}`] = healthData[hpKey];
//           }
//         }
//       } else {
//         updates[key] = data[key];
//       }
//     }
//   }

//   // --- LÓGICA DE SINCRONIZAÇÃO CORRIGIDA ---
//   const healthProfilePayload = data.healthProfile;
//   if (healthProfilePayload && (healthProfilePayload.bodyFatLevel !== undefined || healthProfilePayload.bodyFatPercentage !== undefined)) {

//     const sex = currentUserData?.healthProfile?.sex;
//     if (!sex) {
//       throw new HttpsError("failed-precondition", "O sexo do usuário não está definido, não é possível calcular a gordura corporal.");
//     }

//     // Verifica qual campo foi a origem da mudança
//     const levelWasChanged = healthProfilePayload.bodyFatLevel !== undefined;
//     const percentageWasChanged = healthProfilePayload.bodyFatPercentage !== undefined;

//     if (levelWasChanged) {
//       // Se o NÍVEL mudou, a porcentagem deve ser a PADRÃO para aquele nível.
//       const newLevel = healthProfilePayload.bodyFatLevel;
//       const newPercentage = getPercentageFromLevel(newLevel, sex);
//       updates['healthProfile.bodyFatLevel'] = newLevel;
//       updates['healthProfile.bodyFatPercentage'] = newPercentage;

//     } else if (percentageWasChanged) {
//       // Se a PORCENTAGEM mudou, o nível deve ser ATUALIZADO, 
//       // mas a porcentagem deve ser o valor EXATO enviado.
//       const newPercentage = healthProfilePayload.bodyFatPercentage;
//       const newLevel = getLevelFromPercentage(newPercentage, sex);
//       updates['healthProfile.bodyFatLevel'] = newLevel;
//       updates['healthProfile.bodyFatPercentage'] = newPercentage; // Mantém o valor exato
//     }
//   }

//   if (Object.keys(updates).length === 0) {
//     logger.warn(`Nenhuma atualização válida encontrada para o usuário ${uid}`, { payload: data });
//     return { success: true, message: "Nenhuma alteração válida foi enviada." };
//   }

//   try {
//     await userDocRef.update(updates);
//     logger.info(`Perfil do usuário ${uid} atualizado com sucesso.`, { updates });
//     return { success: true, message: "Perfil atualizado com sucesso!" };
//   } catch (error) {
//     logger.error(`Erro ao atualizar perfil do usuário ${uid}:`, error);
//     throw new HttpsError("internal", "Ocorreu um erro ao salvar suas alterações.");
//   }
// });






// ========================================================================
// ==                      FUNÇÕES DE TROCA DE E-MAIL                     ==
// ========================================================================
export const updateUserProfile = onCall({ cpu: 1 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Você precisa estar autenticado.");
  }
  const uid = request.auth.uid;
  const data = request.data.profile;

  if (!data || Object.keys(data).length === 0) {
    throw new HttpsError("invalid-argument", "Nenhum dado para atualização foi fornecido.");
  }

  const userDocRef = admin.firestore().collection("users").doc(uid);
  const userDoc = await userDocRef.get();
  if (!userDoc.exists) {
    throw new HttpsError("not-found", "Usuário não encontrado.");
  }
  const currentUserData = userDoc.data();
  if (!currentUserData) { // Adicionado para segurança de tipos
    throw new HttpsError("internal", "Não foi possível ler os dados do perfil atual.");
  }


  // --- INÍCIO DA NOVA LÓGICA DE VALIDAÇÃO DE PESO ---
  const healthProfilePayload = data.healthProfile;
  if (healthProfilePayload && healthProfilePayload.weight !== undefined) {
    const newWeight = Number(healthProfilePayload.weight);
    const userHeightCm = currentUserData.healthProfile?.height;

    if (!userHeightCm || userHeightCm <= 0) {
      throw new HttpsError("failed-precondition", "Sua altura precisa estar cadastrada no perfil para que o peso possa ser atualizado.");
    }

    // Converte a altura de cm para metros para o cálculo do IMC
    const heightInMeters = userHeightCm / 100;

    // Define a faixa de IMC aceitável (extremamente generosa)
    const MIN_BMI = 15;
    const MAX_BMI = 60;

    // Calcula o peso mínimo e máximo com base no IMC
    const minWeight = MIN_BMI * (heightInMeters * heightInMeters);
    const maxWeight = MAX_BMI * (heightInMeters * heightInMeters);

    if (newWeight < minWeight || newWeight > maxWeight) {
      logger.warn(`Tentativa de peso inválido para o usuário ${uid}. Peso: ${newWeight}kg, Altura: ${userHeightCm}cm.`);
      throw new HttpsError(
        "invalid-argument",
        `O peso informado (${newWeight.toFixed(1)} kg) não parece realista para a sua altura. O peso deve estar entre ${minWeight.toFixed(1)} kg e ${maxWeight.toFixed(1)} kg.`
      );
    }
  }
  // --- FIM DA NOVA LÓGICA DE VALIDAÇÃO DE PESO ---


  const allowedTopLevelKeys = ["healthProfile", "photoURL"];
  const allowedHealthKeys = [
    "weight", "activityLevel", "bodyFatLevel", "bodyFatPercentage",
    "allergies", "dietaryRestrictions", "healthConditions", "currentMedications"
  ];

  const updates: { [key: string]: any } = {};

  for (const key of Object.keys(data)) {
    if (allowedTopLevelKeys.includes(key)) {
      if (key === "healthProfile") {
        const healthData = data.healthProfile;
        for (const hpKey of Object.keys(healthData)) {
          if (allowedHealthKeys.includes(hpKey)) {
            updates[`healthProfile.${hpKey}`] = healthData[hpKey];
          }
        }
      } else {
        updates[key] = data[key];
      }
    }
  }

  // --- LÓGICA DE SINCRONIZAÇÃO DE GORDURA CORPORAL ---
  if (healthProfilePayload && (healthProfilePayload.bodyFatLevel !== undefined || healthProfilePayload.bodyFatPercentage !== undefined)) {
    const sex = currentUserData.healthProfile?.sex;
    if (!sex) {
      throw new HttpsError("failed-precondition", "O sexo do usuário não está definido, não é possível calcular a gordura corporal.");
    }
    const levelWasChanged = healthProfilePayload.bodyFatLevel !== undefined;
    const percentageWasChanged = healthProfilePayload.bodyFatPercentage !== undefined;
    if (levelWasChanged) {
      const newLevel = healthProfilePayload.bodyFatLevel;
      const newPercentage = getPercentageFromLevel(newLevel, sex);
      updates['healthProfile.bodyFatLevel'] = newLevel;
      updates['healthProfile.bodyFatPercentage'] = newPercentage;
    } else if (percentageWasChanged) {
      const newPercentage = healthProfilePayload.bodyFatPercentage;
      const newLevel = getLevelFromPercentage(newPercentage, sex);
      updates['healthProfile.bodyFatLevel'] = newLevel;
      updates['healthProfile.bodyFatPercentage'] = newPercentage;
    }
  }

  if (Object.keys(updates).length === 0) {
    logger.warn(`Nenhuma atualização válida encontrada para o usuário ${uid}`, { payload: data });
    return { success: true, message: "Nenhuma alteração válida foi enviada." };
  }

  try {
    await userDocRef.update(updates);
    logger.info(`Perfil do usuário ${uid} atualizado com sucesso.`, { updates });
    return { success: true, message: "Perfil atualizado com sucesso!" };
  } catch (error) {
    logger.error(`Erro ao atualizar perfil do usuário ${uid}:`, error);
    throw new HttpsError("internal", "Ocorreu um erro ao salvar suas alterações.");
  }
});











export const requestEmailChange = onCall({ cpu: 1 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Autenticação requerida.");

  const { newEmail } = request.data;
  const uid = request.auth.uid;

  if (typeof newEmail !== "string" || !newEmail.includes("@")) {
    throw new HttpsError("invalid-argument", "O e-mail fornecido é inválido.");
  }

  // 1. Buscamos o registro do usuário, que contém o e-mail antigo
  const userRecord = await admin.auth().getUser(uid);
  const oldEmail = userRecord.email;

  if (!oldEmail) {
    // Caso raro, mas importante de tratar
    throw new HttpsError("not-found", "Não foi possível encontrar o seu e-mail atual.");
  }

  if (oldEmail === newEmail) {
    throw new HttpsError("already-exists", "Este já é o seu e-mail atual.");
  }

  try {
    await admin.auth().getUserByEmail(newEmail);
    throw new HttpsError("already-exists", "Este e-mail já está em uso por outra conta.");
  } catch (error: any) {
    if (error.code !== 'auth/user-not-found') throw error;
  }

  const secrets = await getSecrets();
  if (!secrets.sendgridKey) throw new HttpsError("internal", "O serviço de e-mail não está configurado.");

  const token = uuidv4();
  const expiration = admin.firestore.Timestamp.fromMillis(Date.now() + 60 * 60 * 1000);
  await admin.firestore().collection("users").doc(uid).update({
    pendingEmail: newEmail,
    emailChangeToken: token,
    emailChangeTokenExpires: expiration,
  });

  const verificationLink = `https://colormind.com.br/profile?token=${token}`;
  const fromEmail = "noreply@colormind.com.br";








  const msgForNewEmail = {
    to: newEmail,
    from: { name: "colormind", email: fromEmail },
    subject: "Confirme sua mudança de endereço de e-mail",
    html: getNewEmailConfirmationHTML({ verificationLink: verificationLink }),
  };

  // E-mail para o ANTIGO endereço
  const msgForOldEmail = {
    to: oldEmail,
    from: { name: "Alerta de Segurança - colormind", email: fromEmail },
    subject: "Alerta de Segurança: Solicitação de Alteração de E-mail",
    html: getOldEmailSecurityAlertHTML({ newEmail: newEmail }),
  };







  try {
    await Promise.all([
      sgMail.send(msgForNewEmail),
      sgMail.send(msgForOldEmail)
    ]);

    logger.info(`E-mail de verificação enviado para ${newEmail} e alerta enviado para ${oldEmail}.`);
    return { success: true, message: "Um e-mail de confirmação foi enviado para o seu novo endereço." };
  } catch (error) {
    logger.error("Erro ao enviar um ou ambos os e-mails de alteração:", error);
    throw new HttpsError("internal", "Não foi possível enviar o e-mail de confirmação.");
  }
});





// ========================================================================
// ==                      FUNÇÕES DE TROCA DE E-MAIL (continuação)       ==
// ========================================================================

export const confirmEmailChange = onCall({ cpu: 1 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Ação não permitida. Você precisa estar logado.");
  }

  const { token } = request.data;
  if (!token) {
    throw new HttpsError("invalid-argument", "Token de confirmação não fornecido.");
  }

  const uid = request.auth.uid;
  const usersRef = admin.firestore().collection("users");

  // Busca o usuário pelo token único de verificação
  const snapshot = await usersRef.where("emailChangeToken", "==", token).limit(1).get();

  if (snapshot.empty) {
    throw new HttpsError("not-found", "Token inválido ou já utilizado.");
  }

  const userDoc = snapshot.docs[0];
  const userData = userDoc.data();

  // Garante que o token está sendo usado pelo mesmo usuário que o solicitou
  if (userDoc.id !== uid) {
    throw new HttpsError("permission-denied", "Este token de confirmação pertence a outro usuário.");
  }

  // Verifica se o token expirou
  if (admin.firestore.Timestamp.now() > userData.emailChangeTokenExpires) {
    await userDoc.ref.update({
      pendingEmail: admin.firestore.FieldValue.delete(),
      emailChangeToken: admin.firestore.FieldValue.delete(),
      emailChangeTokenExpires: admin.firestore.FieldValue.delete(),
    });
    throw new HttpsError("deadline-exceeded", "Token expirado. Por favor, solicite a alteração novamente.");
  }

  const newEmail = userData.pendingEmail;

  try {
    // ATUALIZA O E-MAIL NO FIREBASE AUTH
    await admin.auth().updateUser(uid, {
      email: newEmail,
      emailVerified: true,
    });

    // ATUALIZA O E-MAIL E LIMPA OS CAMPOS TEMPORÁRIOS NO FIRESTORE
    await userDoc.ref.update({
      email: newEmail,
      pendingEmail: admin.firestore.FieldValue.delete(),
      emailChangeToken: admin.firestore.FieldValue.delete(),
      emailChangeTokenExpires: admin.firestore.FieldValue.delete(),
    });

    // Força o logout de todas as sessões para segurança
    await admin.auth().revokeRefreshTokens(uid);

    logger.info(`E-mail para o UID ${uid} alterado com sucesso para ${newEmail}.`);
    return { success: true, message: "Seu e-mail foi atualizado! Faça login novamente com o novo endereço." };

  } catch (error) {
    logger.error(`Erro ao finalizar a troca de e-mail para o UID ${uid}:`, error);
    throw new HttpsError("internal", "Não foi possível completar a alteração de e-mail.");
  }
});





/**
 * Gera um link de recuperação de senha e o envia usando um template de e-mail personalizado.
 */
export const sendCustomPasswordResetEmail = onCall({ cpu: 1 }, async (request) => {
  const { email } = request.data;
  if (!email || typeof email !== 'string') {
    // 2. USE 'HttpsError' DIRETAMENTE
    throw new HttpsError("invalid-argument", "O e-mail é obrigatório.");
  }

  try {
    const user = await admin.auth().getUserByEmail(email);
    const firstName = user.displayName?.split(' ')[0] || '';
    const link = await admin.auth().generatePasswordResetLink(email);

    const templateProps = {
      resetLink: link,
      firstName: firstName
    };
    const emailHtml = getPasswordResetEmailHTML(templateProps);

    await getSecrets();
    await sendEmail(email,`Redefinição de senha da sua conta colormind`,emailHtml
    );
    // await sgMail.send(msg);

    logger.info(`E-mail de recuperação personalizado enviado para: ${email}`);
    return { success: true, message: `Se este e-mail estiver registado, um link de recuperação foi enviado.` };

  } catch (error: any) {
    logger.error("Erro ao enviar e-mail de recuperação personalizado:", error);
    if (error.code === 'auth/user-not-found') {
      return { success: true, message: `Se este e-mail estiver registado, um link de recuperação foi enviado.` };
    }
    // 2. USE 'HttpsError' DIRETAMENTE AQUI TAMBÉM
    throw new HttpsError("internal", "Não foi possível enviar o e-mail de recuperação.");
  }
});







/**
 * Função unificada para atualizar o número de telefone com verificação via SMS.
 * Suporta dois modos: 'request' para solicitar o código e 'confirm' para validar o código.
 * Inclui um limite de 3 solicitações a cada 10 minutos.
 */
export const updatePhoneNumber = onCall({ cpu: 1 }, async (request) => {
  // Verificação de Autenticação e Entrada Básica
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Autenticação requerida.");
  }
  const uid = request.auth.uid;
  const { mode, payload } = request.data;

  if (!mode || !payload) {
    throw new HttpsError("invalid-argument", "A requisição precisa de um 'mode' e um 'payload'.");
  }

  const usersRef = admin.firestore().collection("users");
  const userDocRef = usersRef.doc(uid);

  // --- MODO 1: SOLICITAR A MUDANÇA E ENVIAR O CÓDIGO ---
  if (mode === 'request') {
    // LÓGICA DE LIMITE DE SOLICITAÇÕES (RATE LIMITING)
    const userDocForRateLimit = await userDocRef.get();
    const userData = userDocForRateLimit.data();

    const LIMIT_COUNT = 3; // 3 tentativas
    const TIME_WINDOW_MINUTES = 10; // a cada 10 minutos

    const requestTimestamps = (userData?.phoneRequestTimestamps || []).map((t: admin.firestore.Timestamp) => t.toDate());
    const tenMinutesAgo = new Date(Date.now() - TIME_WINDOW_MINUTES * 60 * 1000);
    const recentRequests = requestTimestamps.filter((timestamp: Date) => timestamp > tenMinutesAgo);

    if (recentRequests.length >= LIMIT_COUNT) {
      logger.warn(`Limite de solicitações de SMS atingido para o usuário ${uid}.`);
      throw new HttpsError("resource-exhausted", `Você fez muitas solicitações. Por favor, tente novamente em ${TIME_WINDOW_MINUTES} minutos.`);
    }

    // FIM DA LÓGICA DE LIMITE

    const { newPhone } = payload;
    if (!newPhone) {
      throw new HttpsError("invalid-argument", "O novo número de telefone é obrigatório.");
    }

    const formattedPhone = formatPhone(newPhone);
    const querySnapshot = await usersRef.where("phone", "==", formattedPhone).limit(1).get();
    if (!querySnapshot.empty && querySnapshot.docs[0].id !== uid) {
      throw new HttpsError("already-exists", "Este número de telefone já está em uso por outra conta.");
    }

    const phoneCode = generateCode();
    const expiration = new Date(Date.now() + 10 * 60 * 1000);

    const nowTimestamp = admin.firestore.Timestamp.now();
    const updatedTimestamps = [...recentRequests.map((d: Date) => admin.firestore.Timestamp.fromDate(d)), nowTimestamp];

    await userDocRef.update({
      phoneRequestTimestamps: updatedTimestamps,
      phoneUpdateRequest: {
        newPhone: formattedPhone,
        code: phoneCode,
        expiresAt: admin.firestore.Timestamp.fromDate(expiration)
      }
    });

    const secrets = await getSecrets();
    if (twilioClient && secrets.twilioPhoneNumber) {
      const cleanPhoneNumber = `+55${formattedPhone.replace(/\D/g, "")}`;
      await twilioClient.messages.create({
        body: `Seu código de verificação colormind é: ${phoneCode}`,
        from: secrets.twilioPhoneNumber,
        to: cleanPhoneNumber,
      });
    } else {
      logger.error("Twilio não configurado.");
      throw new HttpsError("internal", "Serviço de verificação indisponível.");
    }

    logger.info(`Código de verificação de telefone enviado para o usuário ${uid}`);
    return { success: true, message: `Enviamos um código de verificação para ${formattedPhone}.` };
  }

  // --- MODO 2: CONFIRMAR A MUDANÇA COM O CÓDIGO ---
  else if (mode === 'confirm') {
    const { code } = payload;
    if (!code) {
      throw new HttpsError("invalid-argument", "O código de verificação é obrigatório.");
    }

    const userDoc = await userDocRef.get();
    const updateRequest = userDoc.data()?.phoneUpdateRequest;

    if (!updateRequest) {
      throw new HttpsError("not-found", "Nenhuma solicitação de alteração de telefone encontrada.");
    }

    const now = admin.firestore.Timestamp.now();
    if (now > updateRequest.expiresAt) {
      await userDocRef.update({ phoneUpdateRequest: admin.firestore.FieldValue.delete() });
      throw new HttpsError("deadline-exceeded", "O código de verificação expirou. Por favor, solicite um novo.");
    }

    if (updateRequest.code !== code) {
      throw new HttpsError("invalid-argument", "Código de verificação inválido.");
    }

    // Sucesso: Atualiza o telefone e limpa a solicitação
    await userDocRef.update({
      phone: updateRequest.newPhone,
      phoneUpdateRequest: admin.firestore.FieldValue.delete()
    });

    logger.info(`Telefone do usuário ${uid} confirmado e atualizado com sucesso.`);
    return { success: true, message: "Número de telefone atualizado com sucesso!" };
  }

  // Se o 'mode' não for nem 'request' nem 'confirm'
  else {
    throw new HttpsError("invalid-argument", "O 'mode' fornecido é inválido.");
  }
});










export const cancelPhoneUpdate = onCall({ cpu: 1 }, async (request) => {
  // 1. Verificação de Autenticação
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Autenticação requerida.");
  }
  const uid = request.auth.uid;

  try {
    const userDocRef = admin.firestore().collection("users").doc(uid);

    // 2. Remove o campo de solicitação de atualização do documento do usuário
    await userDocRef.update({
      phoneUpdateRequest: admin.firestore.FieldValue.delete()
    });

    logger.info(`Solicitação de atualização de telefone cancelada para o usuário ${uid}.`);
    return { success: true, message: "Operação cancelada." };

  } catch (error: any) {
    logger.error(`Erro ao cancelar a atualização de telefone para ${uid}:`, error);
    // Mesmo que o campo não exista, não tratamos como um erro crítico.
    if (error.code === 5) { // 'NOT_FOUND' - O documento ou campo não existia
      return { success: true, message: "Nenhuma operação pendente para cancelar." };
    }
    throw new HttpsError("internal", "Não foi possível cancelar a operação.");
  }
});













export const updatePersonalData = onCall({ cpu: 1 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Você precisa estar autenticado.");
  }

  const uid = request.auth.uid;
  const data = request.data.personalData;

  if (!data) {
    throw new HttpsError("invalid-argument", "Os dados pessoais não foram fornecidos.");
  }

  const userDocRef = admin.firestore().collection("users").doc(uid);
  const userDoc = await userDocRef.get();
  if (!userDoc.exists) {
    throw new HttpsError("not-found", "Usuário não encontrado.");
  }

  const validationErrors: string[] = [];

  if (data.fullName) {
    const name = data.fullName.trim();
    if (name.length < 5 || !name.includes(" ")) {
      validationErrors.push("Por favor, insira um nome completo válido.");
    }
  }

  if (data.nationalId) {
    if (!cpf.isValid(data.nationalId)) {
      validationErrors.push("O CPF informado não é válido.");
    }
  }

  if (data.height) {
    const heightCm = Number(data.height);
    if (isNaN(heightCm) || heightCm < 100 || heightCm > 250) {
      validationErrors.push("A altura deve ser realista (entre 100 e 250 cm).");
    }
  }

  // VALIDAÇÃO ADICIONADA: Garante que o valor para 'sexo' seja um dos esperados.
  if (data.sex) {
    if (!['male', 'female'].includes(data.sex)) {
      validationErrors.push("O valor para 'sexo' é inválido.");
    }
  }

  let formattedDateOfBirth = data.dateOfBirth;
  if (data.dateOfBirth) {
    const onlyDigits = data.dateOfBirth.replace(/\D/g, '');
    if (onlyDigits.length === 8) {
      formattedDateOfBirth = `${onlyDigits.substring(0, 2)}/${onlyDigits.substring(2, 4)}/${onlyDigits.substring(4, 8)}`;
    }

    const dateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const match = formattedDateOfBirth.match(dateRegex);
    if (!match) {
      validationErrors.push("A data de nascimento deve estar no formato DD/MM/AAAA.");
    } else {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const year = parseInt(match[3], 10);
      const birthDate = new Date(year, month - 1, day);

      if (birthDate.getFullYear() !== year || birthDate.getMonth() !== month - 1 || birthDate.getDate() !== day) {
        validationErrors.push("A data de nascimento informada é inválida.");
      } else {
        const today = new Date();

        // Validação de idade mínima (18 anos)
        const eighteenYearsAgo = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
        if (birthDate > eighteenYearsAgo) {
          validationErrors.push("Você precisa ter pelo menos 18 anos.");
        }

        // =======================================================
        //         NOVA VALIDAÇÃO DE IDADE MÁXIMA
        // =======================================================
        const oneHundredTenYearsAgo = new Date(today.getFullYear() - 110, today.getMonth(), today.getDate());
        if (birthDate < oneHundredTenYearsAgo) {
          validationErrors.push("A data de nascimento informada não parece ser válida.");
        }
      }
    }
  }

  if (validationErrors.length > 0) {
    const errorMessage = validationErrors.join(" ");
    throw new HttpsError("invalid-argument", errorMessage);
  }

  const allowedUpdates: { [key: string]: any } = {};
  const authUpdates: { [key: string]: any } = {};

  if (data.fullName) {
    allowedUpdates.fullName = data.fullName.trim();
    authUpdates.displayName = data.fullName.trim();
  }
  if (data.nationalId) {
    allowedUpdates.nationalId = data.nationalId.replace(/\D/g, "");
  }
  if (data.phone) { allowedUpdates.phone = data.phone; }
  if (data.dateOfBirth) { allowedUpdates['healthProfile.dateOfBirth'] = formattedDateOfBirth; }
  if (data.sex) { allowedUpdates['healthProfile.sex'] = data.sex; }
  if (data.height) { allowedUpdates['healthProfile.height'] = Number(data.height); }

  if (Object.keys(allowedUpdates).length === 0) {
    return { success: true, message: "Nenhum dado para atualizar." };
  }

  try {
    allowedUpdates.personalDataEditedAt = admin.firestore.FieldValue.serverTimestamp();
    await userDocRef.update(allowedUpdates);

    if (Object.keys(authUpdates).length > 0) {
      await admin.auth().updateUser(uid, authUpdates);
    }

    logger.info(`Dados pessoais do usuário ${uid} atualizados.`);
    return { success: true, message: "Dados pessoais atualizados com sucesso." };

  } catch (error) {
    logger.error(`Erro ao atualizar dados pessoais do usuário ${uid}:`, error);
    throw new HttpsError("internal", "Ocorreu um erro ao salvar seus dados pessoais.");
  }
});



/**
 * Atualiza apenas a preferência de tema do usuário.
 * É uma função leve, sem validações complexas.
 */
export const updateThemePreference = onCall({ cpu: 1 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Você precisa estar autenticado.");
  }
  const uid = request.auth.uid;
  const { theme } = request.data;

  // Validação simples para garantir que o tema é um valor válido
  if (!theme || !['light', 'dark', 'system'].includes(theme)) {
    throw new HttpsError("invalid-argument", "O tema fornecido é inválido.");
  }

  try {
    const userDocRef = admin.firestore().collection("users").doc(uid);
    await userDocRef.update({ themePreference: theme });

    logger.info(`Preferência de tema do usuário ${uid} atualizada para '${theme}'.`);
    return { success: true };

  } catch (error) {
    logger.error(`Erro ao atualizar a preferência de tema do usuário ${uid}:`, error);
    throw new HttpsError("internal", "Não foi possível salvar sua preferência de tema.");
  }
});







// ========================================================================
// ==                      FUNÇÕES DE ENDEREÇO                          ==
// ========================================================================

export const addAddress = onCall({ cpu: 1 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Autenticação requerida.");

  const uid = request.auth.uid;
  const newAddress: Address = request.data.address;

  if (!newAddress || !newAddress.street || !newAddress.zipCode) {
    throw new HttpsError("invalid-argument", "Dados do endereço incompletos.");
  }

  const userDocRef = admin.firestore().collection("users").doc(uid);
  const userDoc = await userDocRef.get();
  const userData = userDoc.data();

  const addresses = userData?.addresses || [];

  newAddress.id = uuidv4();
  newAddress.isDefault = addresses.length === 0;

  // ✅ 1. CHAMA A FUNÇÃO DE GEOCODIFICAÇÃO CENTRALIZADA
  const coordinates = await _geocodeAddress(newAddress);

  // ✅ 2. ATRIBUI AS COORDENADAS AO ENDEREÇO, CONVERTENDO NULL PARA UNDEFINED
  newAddress.coordinates = coordinates || undefined;

  addresses.push(newAddress);
  await userDocRef.update({ addresses });

  return {
    success: true,
    message: "Endereço adicionado com sucesso.",
    newAddress: newAddress,
    isFirstAddress: newAddress.isDefault
  };
});


export const updateAddress = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Autenticação requerida.");

  const uid = request.auth.uid;
  const updatedAddress: Address = request.data.address;

  if (!updatedAddress || !updatedAddress.id) {
    throw new HttpsError("invalid-argument", "ID do endereço não fornecido.");
  }

  const userDocRef = admin.firestore().collection("users").doc(uid);
  const userDoc = await userDocRef.get();
  const addresses = userDoc.data()?.addresses || [];

  const addressIndex = addresses.findIndex((addr: any) => addr.id === updatedAddress.id);
  if (addressIndex === -1) {
    throw new HttpsError("not-found", "Endereço não encontrado.");
  }

  // ✅ 1. CHAMA A FUNÇÃO DE GEOCODIFICAÇÃO CENTRALIZADA PARA O ENDEREÇO ATUALIZADO
  const coordinates = await _geocodeAddress(updatedAddress);

  // ✅ 2. ATRIBUI AS COORDENADAS, CONVERTENDO NULL PARA UNDEFINED
  updatedAddress.coordinates = coordinates || undefined;

  // Preserva o status 'isDefault' do objeto original e atualiza o endereço no array
  updatedAddress.isDefault = addresses[addressIndex].isDefault;
  addresses[addressIndex] = updatedAddress;

  await userDocRef.update({ addresses });
  return { success: true, message: "Endereço atualizado com sucesso." };
});


export const deleteAddress = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Autenticação requerida.");

  const uid = request.auth.uid;
  const { addressId } = request.data;

  if (!addressId) throw new HttpsError("invalid-argument", "ID do endereço não fornecido.");

  const userDocRef = admin.firestore().collection("users").doc(uid);
  const userDoc = await userDocRef.get();
  const addresses = userDoc.data()?.addresses || [];

  // Adicionamos a regra para barrar a exclusão do último endereço
  if (addresses.length <= 1) {
    throw new HttpsError(
      "failed-precondition",
      "Você não pode excluir seu único endereço. Adicione um novo antes de remover o atual."
    );
  }

  const addressToDelete = addresses.find((addr: any) => addr.id === addressId);
  if (!addressToDelete) {
    throw new HttpsError("not-found", "Endereço não encontrado.");
  }

  let updatedAddresses = addresses.filter((addr: any) => addr.id !== addressId);

  // Se o endereço removido era o padrão, define o primeiro da lista como novo padrão
  if (addressToDelete.isDefault && updatedAddresses.length > 0) {
    updatedAddresses[0].isDefault = true;
  }

  await userDocRef.update({ addresses: updatedAddresses });
  return { success: true, message: "Endereço removido com sucesso." };
});


export const setDefaultAddress = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Autenticação requerida.");

  const uid = request.auth.uid;
  const { addressId } = request.data;

  if (!addressId) throw new HttpsError("invalid-argument", "ID do endereço não fornecido.");

  const userDocRef = admin.firestore().collection("users").doc(uid);
  const userDoc = await userDocRef.get();
  const addresses = userDoc.data()?.addresses || [];

  if (!addresses.some((addr: any) => addr.id === addressId)) {
    throw new HttpsError("not-found", "Endereço não encontrado.");
  }

  const updatedAddresses = addresses.map((addr: any) => ({
    ...addr,
    isDefault: addr.id === addressId
  }));

  await userDocRef.update({ addresses: updatedAddresses });
  return { success: true, message: "Endereço padrão atualizado." };
});














/**
 * Roda diariamente para limpar todas as solicitações expiradas de usuários (telefone e e-mail).
 * Centraliza a lógica de "coleta de lixo" de dados temporários.
 */
export const cleanupExpiredRequests = onSchedule({
  schedule: 'every 3 hours',
  timeZone: "America/Sao_Paulo",
  cpu: 1,
  region: "southamerica-east1" // Boa prática especificar a região
}, async (event) => {
  logger.info("Iniciando limpeza diária de solicitações de usuário expiradas...");

  const now = admin.firestore.Timestamp.now();
  const usersRef = admin.firestore().collection("users");
  const batch = admin.firestore().batch();
  let expiredCount = 0;
  let timestampsCleanedCount = 0;

  // Calcula o timestamp de 1 hora atrás (em milissegundos)
  const oneHourAgoMillis = now.toMillis() - (60 * 60 * 1000); 
  // const oneHourAgo = admin.firestore.Timestamp.fromMillis(oneHourAgoMillis);

  // --- 1. Limpeza de Solicitações de Telefone (Tokens) ---
  try {
    const phoneQuerySnapshot = await usersRef.where("phoneUpdateRequest.expiresAt", "<=", now).get();
    if (!phoneQuerySnapshot.empty) {
      phoneQuerySnapshot.forEach(doc => {
        logger.log(`Limpando solicitação de telefone (token) expirada do usuário: ${doc.id}`);
        batch.update(doc.ref, { phoneUpdateRequest: admin.firestore.FieldValue.delete() });
        expiredCount++;
      });
    }
  } catch (error) {
    logger.error("Erro ao buscar solicitações de telefone (tokens) expiradas:", error);
  }

  // --- 2. Limpeza de Solicitações de E-mail ---
  try {
    const emailQuerySnapshot = await usersRef.where("emailChangeTokenExpires", "<=", now).get();
    if (!emailQuerySnapshot.empty) {
      emailQuerySnapshot.forEach(doc => {
        logger.log(`Limpando solicitação de e-mail expirada do usuário: ${doc.id}`);
        batch.update(doc.ref, {
          pendingEmail: admin.firestore.FieldValue.delete(),
          emailChangeToken: admin.firestore.FieldValue.delete(),
          emailChangeTokenExpires: admin.firestore.FieldValue.delete()
        });
        expiredCount++;
      });
    }
  } catch (error) {
    logger.error("Erro ao buscar solicitações de e-mail expiradas:", error);
  }
  
  // --- 3. Limpeza de Timestamps de Requisição de Telefone (Rate Limiting) ---
  try {
    // Busca todos os usuários que têm o campo phoneRequestTimestamps
    const allUsersWithTimestamps = await usersRef.where("phoneRequestTimestamps", "!=", null).get();

    allUsersWithTimestamps.forEach(doc => {
        const data = doc.data();
        const timestamps = data.phoneRequestTimestamps as admin.firestore.Timestamp[] | undefined;

        if (timestamps && timestamps.length > 0) {
            // Filtra o array, mantendo apenas os timestamps mais recentes que 1 hora
            const newTimestamps = timestamps.filter(timestamp => {
                // Compara o timestamp com o ponto de 1 hora atrás
                return timestamp.toMillis() > oneHourAgoMillis; 
            });

            if (newTimestamps.length !== timestamps.length) {
                // Houve timestamps para remover
                timestampsCleanedCount += (timestamps.length - newTimestamps.length);
                
                if (newTimestamps.length === 0) {
                    // Se o array ficou vazio, deleta o campo
                    logger.log(`Deletando campo phoneRequestTimestamps do usuário: ${doc.id} (Array vazio)`);
                    batch.update(doc.ref, { phoneRequestTimestamps: admin.firestore.FieldValue.delete() });
                } else {
                    // Atualiza o array no banco de dados com os timestamps restantes
                    logger.log(`Limpando timestamps de requisição de telefone do usuário: ${doc.id}`);
                    batch.update(doc.ref, { phoneRequestTimestamps: newTimestamps });
                }
            }
        }
    });
  } catch (error) {
    logger.error("Erro ao limpar Timestamps de Requisição de Telefone:", error);
  }

  // --- 4. Executa a Limpeza ---
  if (expiredCount > 0 || timestampsCleanedCount > 0) {
    await batch.commit();
    logger.info(`Limpeza concluída. ${expiredCount} solicitações expiradas e ${timestampsCleanedCount} timestamps de requisição foram removidos.`);
  } else {
    logger.info("Nenhuma solicitação ou timestamp expirado encontrado para limpar.");
  }
});


// export const cleanupExpiredRequests = onSchedule({
//   schedule: 'every 3 hours',
//   timeZone: "America/Sao_Paulo",
//   cpu: 1,
//   region: "southamerica-east1" // Boa prática especificar a região
// }, async (event) => {
//   logger.info("Iniciando limpeza diária de solicitações de usuário expiradas...");

//   const now = admin.firestore.Timestamp.now();
//   const usersRef = admin.firestore().collection("users");
//   const batch = admin.firestore().batch();
//   let expiredCount = 0;

//   // --- 1. Limpeza de Solicitações de Telefone ---
//   try {
//     const phoneQuerySnapshot = await usersRef.where("phoneUpdateRequest.expiresAt", "<=", now).get();
//     if (!phoneQuerySnapshot.empty) {
//       phoneQuerySnapshot.forEach(doc => {
//         logger.log(`Limpando solicitação de telefone expirada do usuário: ${doc.id}`);
//         batch.update(doc.ref, { phoneUpdateRequest: admin.firestore.FieldValue.delete() });
//         expiredCount++;
//       });
//     }
//   } catch (error) {
//     logger.error("Erro ao buscar solicitações de telefone expiradas:", error);
//   }

//   // --- 2. Limpeza de Solicitações de E-mail ---
//   try {
//     const emailQuerySnapshot = await usersRef.where("emailChangeTokenExpires", "<=", now).get();
//     if (!emailQuerySnapshot.empty) {
//       emailQuerySnapshot.forEach(doc => {
//         logger.log(`Limpando solicitação de e-mail expirada do usuário: ${doc.id}`);
//         batch.update(doc.ref, {
//           pendingEmail: admin.firestore.FieldValue.delete(),
//           emailChangeToken: admin.firestore.FieldValue.delete(),
//           emailChangeTokenExpires: admin.firestore.FieldValue.delete()
//         });
//         expiredCount++;
//       });
//     }
//   } catch (error) {
//     logger.error("Erro ao buscar solicitações de e-mail expiradas:", error);
//   }

//   // --- INÍCIO DO NOVO CÓDIGO ---
//   // --- Limpeza de Timestamps de Solicitação de Telefone (mais de 1 hora) ---
//   try {
//     const oneHourAgo = admin.firestore.Timestamp.fromMillis(now.toMillis() - 3600 * 1000);
    
//     // Esta query busca documentos que tenham pelo menos um timestamp mais antigo que 1 hora.
//     const timestampsQuerySnapshot = await usersRef.where("phoneRequestTimestamps", "<", oneHourAgo).get();

//     if (!timestampsQuerySnapshot.empty) {
//       timestampsQuerySnapshot.forEach(doc => {
//         const originalTimestamps = doc.data().phoneRequestTimestamps;

//         if (originalTimestamps && Array.isArray(originalTimestamps)) {
//           // Filtra o array, mantendo apenas os timestamps da última hora.
//           const updatedTimestamps = originalTimestamps.filter(timestamp =>
//             timestamp.toMillis() >= oneHourAgo.toMillis()
//           );

//           if (updatedTimestamps.length === 0) {
//             // Se o array ficou vazio, remove o campo inteiro.
//             logger.log(`Removendo campo phoneRequestTimestamps vazio do usuário: ${doc.id}`);
//             batch.update(doc.ref, { phoneRequestTimestamps: admin.firestore.FieldValue.delete() });
//           } else if (updatedTimestamps.length < originalTimestamps.length) {
//             // Se o array diminuiu de tamanho, atualiza com os valores restantes.
//             logger.log(`Limpando timestamps de telefone expirados do usuário: ${doc.id}`);
//             batch.update(doc.ref, { phoneRequestTimestamps: updatedTimestamps });
//           }
//         }
//       });
//     }
//   } catch (error) {
//     logger.error("Erro ao buscar timestamps de solicitação de telefone expirados:", error);
//   }
//   // --- FIM DO NOVO CÓDIGO ---

//   // --- 3. Executa a Limpeza ---
//   if (expiredCount > 0) {
//     // Note que o batch.commit() já estava aqui e será usado para as novas operações também.
//     await batch.commit();
//     logger.info(`Limpeza concluída. ${expiredCount} solicitações expiradas foram removidas. Timestamps de telefone também foram verificados.`);
//   } else {
//     logger.info("Nenhuma solicitação expirada encontrada para limpar. Timestamps de telefone foram verificados.");
//   }
// });



export const deleteUserAccount = onCall({ region: "southamerica-east1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Autenticação requerida.");
  }

  const uid = request.auth.uid;
  const db = admin.firestore();
  const auth = admin.auth();

  const userDocRef = db.collection("users").doc(uid);
  const userDoc = await userDocRef.get();

  if (!userDoc.exists) {
    throw new HttpsError("not-found", "Usuário não encontrado.");
  }

  const userData = userDoc.data();
  if (!userData) {
    throw new HttpsError("internal", "Não foi possível ler os dados do usuário.");
  }

  // 1. Mover dados para a coleção 'ghostUsers'
  const ghostUserRef = db.collection("ghostUsers").doc(uid);
  const deletionTimestamp = admin.firestore.FieldValue.serverTimestamp();

  await ghostUserRef.set({
    ...userData,
    status: "pending_deletion",
    deletedAt: deletionTimestamp,
    reactivationDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  });

  // 2. Excluir o documento original da coleção 'users'
  await userDocRef.delete();

  // 3. Desativar a conta no Firebase Authentication
  await auth.updateUser(uid, { disabled: true });

  // 4. Enviar e-mail usando o seu padrão
  try {
    // Primeiro, gere o HTML do e-mail usando seu template
    const emailHtml = getAccountDeletionConfirmationEmailHTML({
      firstName: formatFirstName(userData.fullName)
    });

    // Em seguida, chame a nova função sendEmail
    await sendEmail(
      userData.email, "Sua conta colormind foi desativada", emailHtml);
  } catch (error) {
    logger.error("A conta do usuário foi desativada, mas o e-mail de confirmação falhou.", error);
    // Não lançamos um erro para o usuário aqui, pois a ação principal (exclusão) foi concluída.
  }

  return { success: true, message: "Conta marcada para exclusão." };
});


export const reactivateUserAccount = onCall({ region: "southamerica-east1" }, async (request) => {
  if (!request.data.email) {
    throw new HttpsError("invalid-argument", "O e-mail é necessário para a reativação.");
  }
  const email = request.data.email;
  const db = admin.firestore();
  const auth = admin.auth();

  try {
    // Encontra o UID do usuário pelo e-mail
    const userRecord = await auth.getUserByEmail(email);
    const uid = userRecord.uid;

    const ghostUserRef = db.collection("ghostUsers").doc(uid);
    const ghostUserDoc = await ghostUserRef.get();

    if (!ghostUserDoc.exists) {
      throw new HttpsError("not-found", "Conta não encontrada para reativação ou o prazo de 30 dias expirou.");
    }

    const ghostUserData = ghostUserDoc.data();
    if (!ghostUserData) {
      throw new HttpsError("internal", "Não foi possível ler os dados da conta a ser reativada.");
    }

    // 1. Reativa o usuário no Firebase Authentication
    await auth.updateUser(uid, { disabled: false });

    // 2. Move os dados de volta para a coleção 'users'
    const userRef = db.collection("users").doc(uid);
    // Remove campos de controle antes de restaurar
    delete ghostUserData.status;
    delete ghostUserData.deletedAt;
    delete ghostUserData.reactivationDeadline;
    await userRef.set(ghostUserData);

    // 3. Remove o registro da coleção 'ghostUsers'
    await ghostUserRef.delete();

    // 4. (Opcional) Enviar e-mail de "Bem-vindo(a) de volta"
    // await sendEmail({ ... });

    logger.info(`Conta do usuário ${uid} reativada com sucesso.`);
    return { success: true, message: "Sua conta foi reativada! Por favor, digite sua senha." };

  } catch (error: any) {
    logger.error(`Falha ao tentar reativar conta para o e-mail ${email}:`, error);
    if (error.code === 'auth/user-not-found') {
      throw new HttpsError("internal", "Ocorreu um erro inesperado ao reativar sua conta.");
    }
    throw error; // Re-lança outros erros
  }
});


/**
 * Roda diariamente para anonimizar e excluir permanentemente as contas
 * que passaram do período de reativação de 30 dias.
 */
export const permanentlyDeleteGhostUsers = onSchedule({
  schedule: 'every day 04:00',
  timeZone: "America/Sao_Paulo",
  region: "southamerica-east1",
}, async (event) => {
  logger.info("Iniciando a rotina de exclusão permanente de contas fantasmas...");

  const now = new Date();
  const db = admin.firestore();
  const auth = admin.auth();
  const ghostUsersRef = db.collection("ghostUsers");

  const expiredUsersQuery = ghostUsersRef.where("reactivationDeadline", "<=", now);
  const snapshot = await expiredUsersQuery.get();

  if (snapshot.empty) {
    logger.info("Nenhuma conta expirada para anonimizar.");
    return; // CORRIGIDO: de 'return null;' para 'return;'
  }

  const batch = db.batch();
  const uidsToDeleteFromAuth: string[] = [];

  snapshot.forEach(doc => {
    const uid = doc.id;
    const userData = doc.data();
    logger.log(`Processando anonimização para o usuário fantasma: ${uid}`);

    const anonymizedUserData = { ...userData };

    anonymizedUserData.email = `anonymized+${uid}@colormind.com.br`;
    anonymizedUserData.userEmail = `anonymized+${uid}@colormind.com.br`;
    anonymizedUserData.fullName = "Usuário Anonimizado";
    anonymizedUserData.userFullName = "Usuário Anonimizado";
    anonymizedUserData.photoURL = "https://firebasestorage.googleapis.com/v0/b/your-project-id.appspot.com/o/default-avatar.png";
    anonymizedUserData.userAvatarUrl = "https://firebasestorage.googleapis.com/v0/b/your-project-id.appspot.com/o/default-avatar.png";
    anonymizedUserData.nationalId = "000.000.000-00";
    anonymizedUserData.phone = "(00) 00000-0000";
    anonymizedUserData.userPhone = "(00) 00000-0000";
    anonymizedUserData.addresses = [];

    if (anonymizedUserData.healthProfile) {
      anonymizedUserData.healthProfile.dateOfBirth = "01/01/1900";
    }

    delete anonymizedUserData.emailChangeToken;
    delete anonymizedUserData.emailChangeTokenExpires;
    delete anonymizedUserData.pendingEmail;

    anonymizedUserData.status = "anonymized";
    anonymizedUserData.anonymizedAt = admin.firestore.FieldValue.serverTimestamp();

    batch.set(doc.ref, anonymizedUserData);
    uidsToDeleteFromAuth.push(uid);
  });

  await batch.commit();
  logger.info(`${uidsToDeleteFromAuth.length} registros de usuários foram anonimizados no Firestore.`);

  for (const uid of uidsToDeleteFromAuth) {
    try {
      await auth.deleteUser(uid);
      logger.log(`Usuário ${uid} excluído permanentemente do Firebase Auth.`);
    } catch (error) {
      logger.error(`Falha ao excluir o usuário ${uid} do Firebase Auth:`, error);
    }
  }

  logger.info("Rotina de exclusão permanente concluída.");
  // CORRIGIDO: 'return null;' foi removido. O retorno agora é implícito (void).
});