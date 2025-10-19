import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { cpf as cpfValidator } from "cpf-cnpj-validator";
import axios from "axios";
import { v4 as uuidv4 } from 'uuid';
// import { getSecrets, twilioClient } from "../core/secrets";
import { getSecrets } from "../core/secrets";
import { formatFullName, formatPhone, generateCode, _geocodeAddress, calculateAge, getPercentageFromLevel, _interpretHealthDataInternal, formatFirstName } from "../core/utils";
import { getWelcomeEmailHTML, getNewUserAdminAlertEmailHTML, getRegistrationStartAdminAlertEmailHTML } from "../core/email-templates";
import * as logger from "firebase-functions/logger";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import sgMail = require("@sendgrid/mail");
import { Address } from "../../../models/models";
// const { onUserCreated } = require("firebase-functions/v2/auth");
// import * as functions from "firebase-functions/v1"; // Usando V1 para o gatilho de auth

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const allowedOrigins = [
  /localhost:\d+$/, // Para desenvolvimento local
  "https://colormind.com.br",
  "https://www.colormind.com.br",
  "https://betacolormind.web.app",
  "https://www.betacolormind.web.app"
];




function _verificarNegativeKeywords(value: string): boolean {
  const keywords = [
    'nao', 'não', 'n', 'nn', 'negativo', 'nop', 'nao tem', 'não tem', 'nao tenho',
    'não tenho', 'nao possuo', 'não possuo', 'nenhum', 'nenhuma', 'nada', 'zero',
    'sem', 'branco', '.', '-', 'nem', 'nao tem nenhuma', 'nao tem nenhum', 'não tem nenhum', 'não tem nenhuma'
  ];
  const normalizedValue = value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (keywords.includes(normalizedValue)) return true;
  for (const keyword of keywords) {
    if (normalizedValue.includes(keyword)) return true;
  }
  return false;
}

export const handleAuthStep = onCall({ cors: allowedOrigins }, async (request) => {
  const { step, value, userProfile, mode } = request.data;
  const response = {
    isValid: false,
    errorMessage: "",
    nextStep: "",
    nextQuestion: "",
    data: {},
    isLoading: false,
  };

  await getSecrets();
  const address = userProfile.address || {};

  if (request.auth && request.auth.uid) {
    // --- FLUXO 2: USUÁRIO LOGADO (GOOGLE) - COMPLETAR PERFIL ---
    const uid = request.auth.uid;
    switch (step) {
      case 'start': {
        const userDoc = await admin.firestore().collection('users').doc(uid).get();
        if (userDoc.exists) {
          response.isValid = true;
          response.nextStep = "finished";
          response.nextQuestion = "Seu perfil já está completo!||Redirecionando...";
          return response;
        }
        const firstName = formatFirstName(userProfile.fullName || request.auth.token.name || 'Olá');
        response.isValid = true;
        response.nextStep = "dateOfBirth";
        response.nextQuestion = `Prazer, ${firstName}!||Agora vamos completar seu perfil de saúde.||Qual a sua data de nascimento? (DD/MM/AAAA)`;
        break;
      }
      // --- PERGUNTAS DE SAÚDE ---
      case "dateOfBirth": {
        const dateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
        if (!value.match(dateRegex) || calculateAge(value) < 18) {
          response.errorMessage = "Você precisa ter pelo menos 18 anos e usar o formato DD/MM/AAAA.";
          return response;
        }
        response.isValid = true;
        response.nextStep = "sex";
        response.nextQuestion = "Qual é o seu sexo? (Masculino / Feminino)";
        response.data = { healthProfile: { dateOfBirth: value } };
        break;
      }
      case "sex": {
        const sexCleaned = value.toLowerCase().trim();
        if (sexCleaned !== 'masculino' && sexCleaned !== 'feminino') {
          response.errorMessage = "Por favor, responda com 'Masculino' ou 'Feminino'.";
          return response;
        }
        response.isValid = true;
        response.nextStep = "height";
        response.nextQuestion = "Qual a sua altura em centímetros?";
        response.data = { healthProfile: { sex: sexCleaned === 'masculino' ? 'male' : 'female' } };
        break;
      }
      case "height": {
        const heightValue = parseInt(value.replace(/\D/g, ''), 10);
        if (isNaN(heightValue) || heightValue < 100 || heightValue > 250) {
          response.errorMessage = "Por favor, insira uma altura realista, entre 100 e 250 centímetros.";
          return response;
        }
        response.isValid = true;
        response.nextStep = "bodyFatLevel";
        response.nextQuestion = "Ótimo.||Como você descreveria sua composição corporal?\n1. Magro(a)\n2. Atlético(a)\n3. Em Forma\n4. Acima do Peso";
        response.data = { healthProfile: { height: heightValue } };
        break;
      }
      case "bodyFatLevel": {
        const bodyFatOption = parseInt(value, 10);
        if (isNaN(bodyFatOption) || bodyFatOption < 1 || bodyFatOption > 4) {
          response.errorMessage = "Por favor, escolha uma opção válida de 1 a 4.";
          return response;
        }
        const bodyFatPercentage = getPercentageFromLevel(value, userProfile?.healthProfile?.sex);
        response.isValid = true;
        response.nextStep = "weight";
        response.nextQuestion = "Entendido.||E qual o seu peso em kg?";
        response.data = { healthProfile: { bodyFatLevel: value, bodyFatPercentage } };
        break;
      }
      case "weight": {
        const weightValue = parseFloat(value.replace(/,/g, '.').replace(/[^\d.-]/g, '') ?? '0');
        if (isNaN(weightValue) || weightValue < 30 || weightValue > 300) {
          response.errorMessage = "Por favor, insira um peso realista, entre 30 e 300 quilos.";
          return response;
        }
        response.isValid = true;
        response.nextStep = "activityLevel";
        response.nextQuestion = "Qual o seu nível de atividade física?\n1. Sedentário\n2. Levemente ativo\n3. Moderadamente ativo\n4. Ativo\n5. Muito Ativo";
        response.data = { healthProfile: { weight: weightValue } };
        break;
      }
      case "activityLevel": {
        const level = parseInt(value, 10);
        if (isNaN(level) || level < 1 || level > 5) {
          response.errorMessage = "Por favor, escolha um número de 1 a 5.";
          return response;
        }
        response.isValid = true;
        response.nextStep = "allergies";
        response.nextQuestion = "Você tem alguma alergia alimentar?||Se não, diga 'não'.";
        response.data = { healthProfile: { activityLevel: value } };
        break;
      }
      case "allergies":
        response.isValid = true;
        response.nextStep = "dietaryRestrictions";
        response.nextQuestion = "Possui alguma restrição alimentar (vegetariano, etc.)?";
        response.data = { healthProfile: { allergies: value } };
        break;
      case "dietaryRestrictions":
        response.isValid = true;
        response.nextStep = "healthConditions";
        response.nextQuestion = "Alguma condição de saúde pertinente (diabetes, etc.)?";
        response.data = { healthProfile: { dietaryRestrictions: value } };
        break;
      case "healthConditions":
        response.isValid = true;
        response.nextStep = "currentMedications";
        response.nextQuestion = "Você faz uso de alguma suplementação ou medicação?";
        response.data = { healthProfile: { healthConditions: value } };
        break;
      case "currentMedications":
        response.isValid = true;
        response.nextStep = "cpf";
        response.nextQuestion = "Ok, perfil de saúde concluído!||Agora, para os dados da sua conta, qual seu CPF?";
        response.data = { healthProfile: { currentMedications: value } };
        break;
      // --- PERGUNTAS DE IDENTIFICAÇÃO E CONTATO ---
      case "cpf": {
        if (!cpfValidator.isValid(value)) {
          response.errorMessage = "Este CPF não é válido.";
          return response;
        }
        const cleanedCpf = value.replace(/\D/g, "");
        const snapshot = await admin.firestore().collection("users").where("nationalId", "==", cleanedCpf).limit(1).get();
        if (!snapshot.empty) {
          response.errorMessage = "Este CPF já está cadastrado em outra conta.";
          return response;
        }
        response.isValid = true;
        response.nextStep = "phone";
        response.nextQuestion = "CPF validado!||Agora, qual o seu número de celular com DDD?";
        response.data = { nationalId: cleanedCpf };
        break;
      }
      case "phone": {
        const phoneRegex = /^\(?\d{2}\)?\s?\d{4,5}-?\d{4}$/;
        if (!value || !phoneRegex.test(value)) {
          response.errorMessage = "Número de celular inválido. Inclua o DDD.";
          return response;
        }
        const normalizedPhone = formatPhone(value);
        const snapshot = await admin.firestore().collection("users").where("phone", "==", normalizedPhone).limit(1).get();
        if (!snapshot.empty) {
          response.errorMessage = "Este número de celular já está em uso em outra conta.";
          return response;
        }
        response.isValid = true;
        response.nextStep = "zipCode";
        response.nextQuestion = "Obrigado!||Para finalizar, vamos configurar seu endereço de entrega. Qual o seu CEP?";
        response.data = { phone: normalizedPhone };
        break;
      }
      // --- PERGUNTAS DE ENDEREÇO ---
      case "zipCode": {
        try {
          const cepResponse = await axios.get(`https://viacep.com.br/ws/${value.replace(/\D/g, "")}/json/`);
          if (cepResponse.data.erro) {
            response.errorMessage = "Não encontrei este CEP.";
            return response;
          }
          const addressData = {
            zipCode: cepResponse.data.cep, street: cepResponse.data.logradouro,
            neighborhood: cepResponse.data.bairro, city: cepResponse.data.localidade, state: cepResponse.data.uf,
          };
          response.isValid = true;
          response.nextStep = cepResponse.data.logradouro ? "streetNumber" : "streetName";
          response.nextQuestion = cepResponse.data.logradouro ? `Encontrei: ${cepResponse.data.logradouro}.||Qual é o número?` : "Qual o nome da sua rua?";
          response.data = { address: addressData };
        } catch (error) {
          response.errorMessage = "Não consegui consultar o CEP.";
          return response;
        }
        break;
      }
      case "streetName": {
        const updatedAddress = { ...address, street: value.trim() };
        response.isValid = true;
        response.nextStep = "neighborhood";
        response.nextQuestion = "E qual é o bairro?";
        response.data = { address: updatedAddress };
        break;
      }
      case "neighborhood": {
        const updatedAddress = { ...address, neighborhood: value.trim() };
        response.isValid = true;
        response.nextStep = "streetNumber";
        response.nextQuestion = "Obrigado! E qual o número do endereço?";
        response.data = { address: updatedAddress };
        break;
      }
      case "streetNumber": {
        const updatedAddress = { ...address, number: value.trim() };
        response.isValid = true;
        response.nextStep = "complement";
        response.nextQuestion = "Tem algum complemento? (Ex: Apto 101)";
        response.data = { address: updatedAddress };
        break;
      }
      case "complement": {
        const updatedAddress = { ...address, complement: _verificarNegativeKeywords(value) ? "" : value.trim() };
        response.isValid = true;
        response.nextStep = "avatar";
        response.nextQuestion = "Gostaria de adicionar uma foto de perfil? [link:uploadAvatar|Adicionar foto]";
        response.data = { address: updatedAddress };
        break;
      }
      case "avatar":
        response.isValid = true;
        response.nextStep = "finished";
        response.nextQuestion = "Perfeito!||Vamos revisar seus dados...";
        response.isLoading = true;
        break;
      default:
        response.errorMessage = `Passo desconhecido para usuário logado: ${step}`;
        break;
    }
  } else {
    // --- FLUXO 1: USUÁRIO DESLOGADO - CADASTRO COM E-MAIL/SENHA OU LOGIN ---
    const address = userProfile.address || {};
    switch (step) {
      case 'start':
        response.isValid = true;
        response.nextStep = "email";
        // ✅ ALTERAÇÃO AQUI: Adicionamos a mensagem com o link para o Google.
        response.nextQuestion = mode === 'login'
          ? "Qual é o seu e-mail?||ou [link:signInWithGoogle|Continuar com o Google]"
          : "Olá!||Para começar, qual é o seu e-mail?||ou [link:signInWithGoogle|continue com o Google]";
        break;
      case 'email': {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!value || !emailRegex.test(value)) {
          response.errorMessage = "Este e-mail não parece válido.";
          return response;
        }
        try {
          await admin.auth().getUserByEmail(value);
          if (mode === 'register') {
            response.errorMessage = "Este e-mail já possui uma conta. [link:login|Clique aqui para entrar]";
          } else {
            response.isValid = true;
            response.nextStep = "loginPassword";
            response.data = { email: value };
            response.nextQuestion = `Bem-vindo(a) de volta!||Por favor, insira a sua senha.`;
          }
        } catch (error: any) {
          if (error.code === "auth/user-not-found") {
            if (mode === 'login') {
              response.errorMessage = "Nenhuma conta encontrada com este e-mail. [link:register|Clique aqui para se cadastrar]";
            } else {
              const emailCode = generateCode();
              await admin.firestore().collection('authSessions').doc(value).set({ emailCode, createdAt: new Date() });
              await sgMail.send({
                to: value, from: { name: "colormind", email: "noreply@colormind.com.br" },
                subject: `Seu código de verificação é ${emailCode}`,
                text: `Olá! Use o código ${emailCode} para continuar o seu cadastro na colormind.`,
              });
              response.isValid = true;
              response.nextStep = "verifyEmail";
              response.nextQuestion = "Enviamos um código para o seu e-mail.||Digite o código que você recebeu. [link:resendEmail|Reenviar código]";
              response.data = { email: value };
            }
          } else {
            throw new HttpsError("internal", "Não foi possível verificar o e-mail.");
          }
        }
        break;
      }
      case 'verifyEmail': {
        const session = await admin.firestore().collection('authSessions').doc(userProfile.email).get();
        if (!session.exists || session.data()?.emailCode !== value) {
          response.errorMessage = "Código inválido. Tente novamente.";
          return response;
        }
        response.isValid = true;
        response.nextStep = "password";
        response.nextQuestion = "E-mail verificado!||Agora, crie uma senha segura.";
        break;
      }
      case 'changeEmail':
        response.isValid = true;
        response.nextStep = "email";
        response.nextQuestion = "Sem problemas.||Por favor, insira o seu e-mail correto.";
        break;
      case 'resendEmail': {
        const emailCode = generateCode();
        await admin.firestore().collection('authSessions').doc(userProfile.email).update({ emailCode });
        await sgMail.send({
          to: userProfile.email, from: { name: "colormind", email: "noreply@colormind.com.br" },
          subject: `Seu novo código de verificação é ${emailCode}`,
          text: `Olá! Use o código ${emailCode} para continuar.`,
        });
        response.isValid = true;
        response.nextStep = "verifyEmail";
        response.nextQuestion = "Enviamos um novo código para o seu e-mail.";
        break;
      }
      case "password": {
        const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
        if (!value || !passwordRegex.test(value)) {
          response.errorMessage = "Senha fraca. Mínimo 8 caracteres com letras e números.";
          return response;
        }
        response.isValid = true;
        response.nextStep = "fullName";
        response.nextQuestion = "Senha criada!||Qual é o seu nome completo?";
        response.data = { password: value };
        break;
      }
      case "fullName": {
        if (!value || value.trim().split(" ").length < 2) {
          response.errorMessage = "Por favor, insira seu nome e sobrenome.";
          return response;
        }
        response.isValid = true;
        response.nextStep = "dateOfBirth";
        response.nextQuestion = `Prazer, ${formatFirstName(value)}!||Agora vamos completar seu perfil de saúde.||Qual a sua data de nascimento? (DD/MM/AAAA)`;
        response.data = { fullName: value };
        break;
      }
      // --- PERGUNTAS DE SAÚDE ---
      case "dateOfBirth": {
        const dateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
        if (!value.match(dateRegex) || calculateAge(value) < 18) {
          response.errorMessage = "Você precisa ter pelo menos 18 anos e usar o formato DD/MM/AAAA.";
          return response;
        }
        response.isValid = true;
        response.nextStep = "sex";
        response.nextQuestion = "Qual é o seu sexo? (Masculino / Feminino)";
        response.data = { healthProfile: { dateOfBirth: value } };
        break;
      }
      case "sex": {
        const sexCleaned = value.toLowerCase().trim();
        if (sexCleaned !== 'masculino' && sexCleaned !== 'feminino') {
          response.errorMessage = "Por favor, responda com 'Masculino' ou 'Feminino'.";
          return response;
        }
        response.isValid = true;
        response.nextStep = "height";
        response.nextQuestion = "Qual a sua altura em centímetros?";
        response.data = { healthProfile: { sex: sexCleaned === 'masculino' ? 'male' : 'female' } };
        break;
      }
      case "height": {
        const heightValue = parseInt(value.replace(/\D/g, ''), 10);
        if (isNaN(heightValue) || heightValue < 100 || heightValue > 250) {
          response.errorMessage = "Por favor, insira uma altura realista, entre 100 e 250 centímetros.";
          return response;
        }
        response.isValid = true;
        response.nextStep = "bodyFatLevel";
        response.nextQuestion = "Ótimo.||Como você descreveria sua composição corporal?\n1. Magro(a)\n2. Atlético(a)\n3. Em Forma\n4. Acima do Peso";
        response.data = { healthProfile: { height: heightValue } };
        break;
      }
      case "bodyFatLevel": {
        const bodyFatOption = parseInt(value, 10);
        if (isNaN(bodyFatOption) || bodyFatOption < 1 || bodyFatOption > 4) {
          response.errorMessage = "Por favor, escolha uma opção válida de 1 a 4.";
          return response;
        }
        const bodyFatPercentage = getPercentageFromLevel(value, userProfile?.healthProfile?.sex);
        response.isValid = true;
        response.nextStep = "weight";
        response.nextQuestion = "Entendido.||E qual o seu peso em kg?";
        response.data = { healthProfile: { bodyFatLevel: value, bodyFatPercentage } };
        break;
      }
      case "weight": {
        const weightValue = parseFloat(value.replace(/,/g, '.').replace(/[^\d.-]/g, '') ?? '0');
        if (isNaN(weightValue) || weightValue < 30 || weightValue > 300) {
          response.errorMessage = "Por favor, insira um peso realista, entre 30 e 300 quilos.";
          return response;
        }
        response.isValid = true;
        response.nextStep = "activityLevel";
        response.nextQuestion = "Qual o seu nível de atividade física?\n1. Sedentário\n2. Levemente ativo\n3. Moderadamente ativo\n4. Ativo\n5. Muito Ativo";
        response.data = { healthProfile: { weight: weightValue } };
        break;
      }
      case "activityLevel": {
        const level = parseInt(value, 10);
        if (isNaN(level) || level < 1 || level > 5) {
          response.errorMessage = "Por favor, escolha um número de 1 a 5.";
          return response;
        }
        response.isValid = true;
        response.nextStep = "allergies";
        response.nextQuestion = "Você tem alguma alergia alimentar?||Se não, diga 'não'.";
        response.data = { healthProfile: { activityLevel: value } };
        break;
      }
      case "allergies":
        response.isValid = true;
        response.nextStep = "dietaryRestrictions";
        response.nextQuestion = "Possui alguma restrição alimentar (vegetariano, etc.)?";
        response.data = { healthProfile: { allergies: value } };
        break;
      case "dietaryRestrictions":
        response.isValid = true;
        response.nextStep = "healthConditions";
        response.nextQuestion = "Alguma condição de saúde pertinente (diabetes, etc.)?";
        response.data = { healthProfile: { dietaryRestrictions: value } };
        break;
      case "healthConditions":
        response.isValid = true;
        response.nextStep = "currentMedications";
        response.nextQuestion = "Você faz uso de alguma suplementação ou medicação?";
        response.data = { healthProfile: { healthConditions: value } };
        break;
      case "currentMedications":
        response.isValid = true;
        response.nextStep = "cpf";
        response.nextQuestion = "Ok, perfil de saúde concluído!||Agora, para os dados da sua conta, qual seu CPF?";
        response.data = { healthProfile: { currentMedications: value } };
        break;
      // --- PERGUNTAS DE IDENTIFICAÇÃO E CONTATO ---
      case "cpf": {
        if (!cpfValidator.isValid(value)) {
          response.errorMessage = "Este CPF não é válido.";
          return response;
        }
        const cleanedCpf = value.replace(/\D/g, "");
        const snapshot = await admin.firestore().collection("users").where("nationalId", "==", cleanedCpf).limit(1).get();
        if (!snapshot.empty) {
          response.errorMessage = "Este CPF já está cadastrado em outra conta.";
          return response;
        }
        response.isValid = true;
        response.nextStep = "phone";
        response.nextQuestion = "CPF validado!||Qual o seu número de celular com DDD?";
        response.data = { nationalId: cleanedCpf };
        break;
      }
      case "phone": {
        const phoneRegex = /^\(?\d{2}\)?\s?\d{4,5}-?\d{4}$/;
        if (!value || !phoneRegex.test(value)) {
          response.errorMessage = "Número de celular inválido. Inclua o DDD.";
          return response;
        }
        const normalizedPhone = formatPhone(value);
        // const secrets = await getSecrets();

        // if (twilioClient && secrets.twilioPhoneNumber) {
        //   try {
        //     const phoneCode = generateCode();
        //     const authSessionDocRef = admin.firestore().collection('authSessions').doc(userProfile.email);
        //     await authSessionDocRef.set({ phoneCode }, { merge: true });

        //     await twilioClient.messages.create({
        //       body: `Seu código de verificação colormind é: ${phoneCode}`,
        //       from: secrets.twilioPhoneNumber,
        //       to: `+55${value.replace(/\D/g, "")}`,
        //     });

        //     response.isValid = true;
        //     response.nextStep = "verifyPhone";
        //     response.nextQuestion = "Enviamos um código para o seu celular.||Digite o código que você recebeu. [link:resendPhone|Reenviar código]";
        //     response.data = { phone: normalizedPhone };
        //   } catch (error: any) {
        //     logger.error("Erro ao enviar SMS via Twilio:", error);
        //     response.errorMessage = "Não foi possível enviar o código de verificação.";
        //     return response;
        //   }
        // } else {
        logger.warn("Twilio não configurado. Pulando a verificação por SMS.");
        response.isValid = true;
        response.nextStep = "zipCode";
        response.nextQuestion = "Ótimo.||Para o endereço de entrega, qual o seu CEP?";
        response.data = { phone: normalizedPhone };
        // }
        break;
      }
      case 'verifyPhone': {
        const session = await admin.firestore().collection('authSessions').doc(userProfile.email).get();
        if (!session.exists || session.data()?.phoneCode !== value) {
          response.errorMessage = "Código de verificação incorreto.";
          return response;
        }
        await admin.firestore().collection('authSessions').doc(userProfile.email).update({ phoneCode: admin.firestore.FieldValue.delete() });
        response.isValid = true;
        response.nextStep = "zipCode";
        response.nextQuestion = "Celular verificado!||Agora, para o endereço de entrega, qual o seu CEP?";
        break;
      }
      case 'resendPhone': {
        response.errorMessage = "Não foi possível reenviar o código. Tente novamente mais tarde.";
        break;
      }
      // --- PERGUNTAS DE ENDEREÇO ---
      case "zipCode": {
        try {
          const cepResponse = await axios.get(`https://viacep.com.br/ws/${value.replace(/\D/g, "")}/json/`);
          if (cepResponse.data.erro) {
            response.errorMessage = "Não encontrei este CEP.";
            return response;
          }
          const addressData = {
            zipCode: cepResponse.data.cep, street: cepResponse.data.logradouro,
            neighborhood: cepResponse.data.bairro, city: cepResponse.data.localidade, state: cepResponse.data.uf,
          };
          response.isValid = true;
          response.nextStep = cepResponse.data.logradouro ? "streetNumber" : "streetName";
          response.nextQuestion = cepResponse.data.logradouro ? `Encontrei: ${cepResponse.data.logradouro}.||Qual é o número?` : "Qual o nome da sua rua?";
          response.data = { address: addressData };
        } catch (error) {
          response.errorMessage = "Não consegui consultar o CEP.";
          return response;
        }
        break;
      }
      case "streetName": {
        const updatedAddress = { ...address, street: value.trim() };
        response.isValid = true;
        response.nextStep = "neighborhood";
        response.nextQuestion = "E qual é o bairro?";
        response.data = { address: updatedAddress };
        break;
      }
      case "neighborhood": {
        const updatedAddress = { ...address, neighborhood: value.trim() };
        response.isValid = true;
        response.nextStep = "streetNumber";
        response.nextQuestion = "Obrigado! E qual o número do endereço?";
        response.data = { address: updatedAddress };
        break;
      }
      case "streetNumber": {
        const updatedAddress = { ...address, number: value.trim() };
        response.isValid = true;
        response.nextStep = "complement";
        response.nextQuestion = "Tem algum complemento? (Ex: Apto 101)";
        response.data = { address: updatedAddress };
        break;
      }
      case "complement": {
        const updatedAddress = { ...address, complement: _verificarNegativeKeywords(value) ? "" : value.trim() };
        response.isValid = true;
        response.nextStep = "avatar";
        response.nextQuestion = "Gostaria de adicionar uma foto de perfil? [link:uploadAvatar|Adicionar foto]";
        response.data = { address: updatedAddress };
        break;
      }
      case "avatar": {
        // O perfil está completo. Antes de ir para a revisão, salvamos tudo em uma sessão.
        if (userProfile.email && userProfile.password) {
          // Garante que a photoURL seja salva corretamente, mesmo que o usuário pule o upload
          const profileToSave = { ...userProfile, photoURL: value === "Foto enviada" ? userProfile.photoURL : "" };

          await admin.firestore().collection('registrationSessions').doc(userProfile.email).set({
            profileToSave: profileToSave,
            password: userProfile.password, // Salvamos a senha aqui também
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } else {
          // Isso não deve acontecer se o fluxo estiver correto, mas é uma boa proteção.
          throw new HttpsError("invalid-argument", "E-mail ou senha faltando na etapa final do cadastro.");
        }

        // Agora, o fluxo continua normalmente para a etapa de revisão
        response.isValid = true;
        response.nextStep = "finished";
        response.nextQuestion = "Perfeito!||Vamos revisar seus dados...";
        response.isLoading = true;
        break;
      }
      default:
        response.errorMessage = `Passo desconhecido para usuário deslogado: ${step}`;
        break;
    }
  }

  if (response.isValid && userProfile.email) {
    admin.firestore().collection('incompleteRegistrations').doc(userProfile.email).set({
      userProfile,
      lastCompletedStep: step,
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).catch(err => {
      logger.error(`Falha ao salvar progresso do cadastro:`, err);
    });
  }
  return response;
});








export const finalizeRegistration = onCall({ cpu: 0.5 }, async (request) => {
  try {
    logger.log("--- finalizeRegistration INICIADA ---");
    const { userProfile: rawProfile, mode, email } = request.data; // Adicionado 'email' para o modo confirm
    const isAuthed = !!(request.auth && request.auth.uid);

    logger.log(`Dados recebidos: MODO='${mode}', AUTENTICADO=${isAuthed}`);

    // 1. A verificação do 'review'
    if (mode === 'review') {
      logger.log(">>> Entrando no bloco 'review'.");
      if (!rawProfile) {
        throw new HttpsError("invalid-argument", "O perfil do usuário (rawProfile) é necessário para a revisão.");
      }
      const fakeUid = `review_${uuidv4()}`;

      logger.log("Chamando _processProfileForFirestore para revisão...");
      const processedProfile = await _processProfileForFirestore(rawProfile, fakeUid, false);
      logger.log("_processProfileForFirestore para revisão CONCLUÍDO.");

      const hp = processedProfile.healthProfile;
      const activityLevelMap: { [key: string]: string } = { '1': 'Sedentário', '2': 'Levemente ativo', '3': 'Moderadamente ativo', '4': 'Ativo', '5': 'Muito Ativo' };
      const bodyFatMap: { [key: string]: string } = { '1': 'Magro(a)', '2': 'Atlético(a)', '3': 'Em Forma', '4': 'Acima do Peso' };

      const formattedText = `DADOS PESSOAIS
Nome: ${processedProfile.fullName}
Email: ${processedProfile.email}
CPF: ${processedProfile.nationalId}
Celular: ${processedProfile.phone}

ENDEREÇO
${processedProfile.addresses[0].street}, ${processedProfile.addresses[0].number}
Bairro: ${processedProfile.addresses[0].neighborhood}
Cidade: ${processedProfile.addresses[0].city} - ${processedProfile.addresses[0].state}

PERFIL DE SAÚDE
Nascimento: ${hp.dateOfBirth}
Sexo: ${hp.sex === 'male' ? 'Masculino' : 'Feminino'}
Altura: ${hp.height} cm
Peso: ${hp.weight} kg
Atividade: ${activityLevelMap[hp.activityLevel] || 'Não informado'}
Composição: ${bodyFatMap[hp.bodyFatLevel] || 'Não informado'}
Alergias: ${hp.allergies.length > 0 ? hp.allergies.join(', ') : 'Nenhuma'}
Restrições: ${hp.dietaryRestrictions.length > 0 ? hp.dietaryRestrictions.join(', ') : 'Nenhuma'}
Condições: ${hp.healthConditions.length > 0 ? hp.healthConditions.join(', ') : 'Nenhuma'}
Medicamentos: ${hp.currentMedications.length > 0 ? hp.currentMedications.join(', ') : 'Nenhum'}
    `.trim().replace(/^    /gm, '');

      logger.log("<<< Retornando do bloco 'review' com sucesso.");
      return {
        success: true,
        mode: 'review',
        formattedProfile: formattedText,
        termsText: "Ao responder \"sim\", você confirma que leu e concorda com nossos Termos de Serviço e Política de Privacidade."
      };
    }

    // 2. O bloco para salvar o usuário do Google
    else if (mode === 'save_google_user' && request.auth && request.auth.uid) {
      logger.log(">>> Entrando no bloco 'save_google_user'.");
      if (!rawProfile) {
        throw new HttpsError("invalid-argument", "O perfil do usuário é necessário para salvar.");
      }
      // ✅ NOVA LÓGICA IMPLEMENTADA AQUI
      // Garante que a foto do Google seja usada se o usuário não enviou uma nova.
      // Verificamos se a URL no perfil vindo do cliente é uma URL de upload temporária.
      const hasUploadedNewPhoto = rawProfile.photoURL && rawProfile.photoURL.includes('/avatars/temp/');

      if (!hasUploadedNewPhoto) {
        // Se não enviou foto nova, usamos a foto do token de autenticação do Google como a fonte da verdade.
        // Se o usuário do Google não tiver foto, 'request.auth.token.picture' será nulo,
        // e a função _processProfileForFirestore usará a foto placeholder.
        rawProfile.photoURL = request.auth.token.picture || null;
      }

      const uid = request.auth.uid;
      // Agora, o `rawProfile` é enviado para processamento com a URL da foto correta.
      const profileToSave = await _processProfileForFirestore(rawProfile, uid, false);

      await admin.auth().updateUser(uid, { displayName: profileToSave.fullName, photoURL: profileToSave.photoURL });
      await admin.firestore().collection("users").doc(uid).set(profileToSave);

      if (profileToSave.email) {
        await admin.firestore().collection('incompleteRegistrations').doc(profileToSave.email).delete();
      }
      await _sendWelcomeEmails(profileToSave);
      logger.log("<<< Retornando do bloco 'save_google_user' com sucesso.");
      return { success: true, uid: uid };
    }

    // 3. ✅ BLOCO CORRIGIDO E IMPLEMENTADO
    else if (mode === 'confirm') {
      logger.log(">>> Entrando no bloco 'confirm'.");
      if (!email) {
        throw new HttpsError("invalid-argument", "O e-mail é necessário para confirmar o cadastro.");
      }

      // 1. Busca os dados da sessão de registro
      const sessionRef = admin.firestore().collection('registrationSessions').doc(email);
      const sessionDoc = await sessionRef.get();
      if (!sessionDoc.exists) {
        throw new HttpsError("not-found", "Sessão de cadastro expirada ou inválida. Por favor, tente novamente.");
      }
      const { profileToSave: finalRawProfile, password } = sessionDoc.data() as any;

      // 2. Cria o usuário no Firebase Auth
      const userRecord = await admin.auth().createUser({
        email: finalRawProfile.email,
        password: password,
        displayName: finalRawProfile.fullName,
        photoURL: finalRawProfile.photoURL,
      });

      // 3. Processa o perfil para salvar no Firestore
      const profileToSaveInDb = await _processProfileForFirestore(finalRawProfile, userRecord.uid, true);

      // 4. Salva o perfil no Firestore
      await admin.firestore().collection("users").doc(userRecord.uid).set(profileToSaveInDb);

      // 5. Envia e-mails
      await _sendWelcomeEmails(profileToSaveInDb);

      // 6. Limpa as sessões temporárias
      await sessionRef.delete();
      await admin.firestore().collection('incompleteRegistrations').doc(email).delete();
      await admin.firestore().collection('authSessions').doc(email).delete();

      logger.log("<<< Retornando do bloco 'confirm' com sucesso.");
      return { success: true, uid: userRecord.uid };
    }

    // --- ERRO FINAL ---
    else {
      logger.error("!!! NENHUM BLOCO VÁLIDO FOI EXECUTADO. Retornando erro.", { mode, isAuthed });
      throw new HttpsError("unauthenticated", "Operação não permitida ou modo inválido.");
    }

  } catch (error: any) {
    logger.error("!!!!!!!!!! ERRO INESPERADO CAPTURADO EM finalizeRegistration !!!!!!!!!!", {
      errorMessage: error.message,
      errorStack: error.stack,
      requestData: JSON.stringify(request.data, null, 2),
    });

    throw new HttpsError("internal", `Erro interno no servidor: ${error.message}`);
  }
});



async function _processProfileForFirestore(rawProfile: any, uid: string, isFinalCreationStep: boolean): Promise<any> {
  logger.log("Iniciando _processProfileForFirestore para UID:", uid);

  const hp_raw = rawProfile.healthProfile || {};
  const address_raw = rawProfile.address || {};

  if (isFinalCreationStep && !rawProfile.password) {
    throw new HttpsError("invalid-argument", "Senha é obrigatória para cadastro com e-mail.");
  }

  if (!rawProfile.email || !rawProfile.fullName || !rawProfile.nationalId || !address_raw?.zipCode) {
    logger.error("Dados essenciais faltando no processamento do perfil:", {
      emailExists: !!rawProfile.email,
      fullNameExists: !!rawProfile.fullName,
      nationalIdExists: !!rawProfile.nationalId,
      zipCodeExists: !!address_raw?.zipCode,
    });
    throw new HttpsError("invalid-argument", "Dados essenciais estão faltando para processar o perfil.");
  }

  // --- Lógica de Foto de Perfil (sem alterações) ---
  let permanentPhotoURL: string;
  const placeholderAvatarUrl = "https://firebasestorage.googleapis.com/v0/b/meal-plan-280d2.appspot.com/o/app%2Favatars%2Favatar-placeholder.jpg?alt=media&token=441f5cfb-bd0f-4f96-80a1-19138ef0aa57";
  const tempUrl = rawProfile.photoURL;
  if (tempUrl && tempUrl.includes('/avatars/temp/')) {
    const decodedUrl = decodeURIComponent(tempUrl);
    const pathRegex = /\/o\/(avatars\/temp\/.*?)\?alt=media/;
    const match = decodedUrl.match(pathRegex);
    const tempFilePath = match?.[1];

    if (tempFilePath) {
      const bucket = admin.storage().bucket();
      const tempFile = bucket.file(tempFilePath);
      const newFilePath = `users/${uid}/avatar/${tempFilePath.split('/').pop()}`;
      await tempFile.move(newFilePath);
      const newFile = bucket.file(newFilePath);
      await newFile.makePublic();
      permanentPhotoURL = newFile.publicUrl();
    } else {
      permanentPhotoURL = placeholderAvatarUrl;
    }
  } else {
    permanentPhotoURL = tempUrl || placeholderAvatarUrl;
  }

  // --- Processamento de Dados de Saúde (sem alterações) ---
  const [
    allergiesResult,
    dietaryRestrictionsResult,
    healthConditionsResult,
    currentMedicationsResult,
  ] = await Promise.all([
    _interpretHealthDataInternal(hp_raw.allergies, 'allergies'),
    _interpretHealthDataInternal(hp_raw.dietaryRestrictions, 'dietaryRestrictions'),
    _interpretHealthDataInternal(hp_raw.healthConditions, 'healthConditions'),
    _interpretHealthDataInternal(hp_raw.currentMedications, 'currentMedications'),
  ]);

  // =====================================================================
  // ✅ INÍCIO DA LÓGICA DE ENDEREÇO E GEOCODIFICAÇÃO
  // =====================================================================

  const cepResponse = await axios.get(`https://viacep.com.br/ws/${address_raw.zipCode.replace(/\D/g, "")}/json/`);
  if (cepResponse.data.erro) throw new HttpsError("not-found", "CEP não encontrado.");
  const cepData = cepResponse.data;

  // 1. Montamos o objeto de endereço completo, com tipagem explícita.
  const finalAddress: Address = {
    id: uuidv4(),
    street: address_raw?.street || cepData.logradouro || '',
    number: address_raw?.number || '',
    complement: address_raw?.complement || '',
    neighborhood: address_raw?.neighborhood || cepData.bairro || '',
    city: cepData.localidade,
    state: cepData.uf,
    zipCode: cepData.cep,
    isDefault: true,
  };

  // 2. Chamamos a função de geocodificação centralizada.
  logger.log(`Iniciando geocodificação para o endereço:`, finalAddress);
  const coordinates = await _geocodeAddress(finalAddress);

  // 3. Se a geocodificação for bem-sucedida, anexamos as coordenadas.
  if (coordinates) {
    finalAddress.coordinates = coordinates;
    logger.log(`Geocodificação bem-sucedida. Coordenadas:`, coordinates);
  } else {
    logger.warn(`Não foi possível obter as coordenadas para o endereço do usuário ${uid}. O perfil será salvo sem elas.`);
  }

  // 4. O array de endereços agora contém o objeto completo.
  const addressesArray = [finalAddress];

  // =====================================================================
  // ✅ FIM DA LÓGICA DE ENDEREÇO E GEOCODIFICAÇÃO
  // =====================================================================


  const finalHealthProfile = {
    sex: hp_raw.sex,
    dateOfBirth: hp_raw.dateOfBirth,
    height: parseInt(String(hp_raw.height).replace(/\D/g, '') || '0', 10),
    weight: parseFloat(String(hp_raw.weight).replace(/,/g, '.').replace(/[^\d.-]/g, '') || '0'),
    activityLevel: hp_raw.activityLevel,
    bodyFatLevel: hp_raw.bodyFatLevel,
    bodyFatPercentage: hp_raw.bodyFatPercentage || 0,
    allergies: allergiesResult.items,
    dietaryRestrictions: dietaryRestrictionsResult.items,
    healthConditions: healthConditionsResult.items,
    currentMedications: currentMedicationsResult.items,
  };


  return {
    uid: uid,
    email: rawProfile.email.toLowerCase(),
    fullName: formatFullName(rawProfile.fullName),
    photoURL: permanentPhotoURL,
    nationalId: rawProfile.nationalId.replace(/\D/g, ""),
    phone: formatPhone(rawProfile.phone),
    addresses: addressesArray, // O array agora contém o endereço com coordenadas
    healthProfile: finalHealthProfile,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function _sendWelcomeEmails(profile: any) {
  await getSecrets();
  const firstName = formatFirstName(profile.fullName);
  const saudacao = profile.healthProfile.sex === 'male' ? 'Bem-vindo' : 'Bem-vinda';
  const pronomeObjeto = profile.healthProfile.sex === 'male' ? 'tê-lo' : 'tê-la';
  const templateProps = { firstName, saudacao, pronomeObjeto };
  const emailHtml = getWelcomeEmailHTML(templateProps);
  await sgMail.send({
    to: profile.email,
    from: { name: "colormind", email: "noreply@colormind.com.br" },
    subject: `🎉 ${saudacao} à colormind, ${firstName}!`,
    html: emailHtml,
  });

  const adminEmail = 'ronaldo.fortini.jr@gmail.com';
  const adminAlertProps = {
    userName: profile.fullName,
    userEmail: profile.email,
    userId: profile.uid,
    adminPanelLink: `https://console.firebase.google.com/u/0/project/meal-plan-280d2/firestore/data/~2Fusers~2F${profile.uid}`
  };
  const adminEmailHtml = getNewUserAdminAlertEmailHTML(adminAlertProps);
  await sgMail.send({
    to: adminEmail,
    from: { name: "Alerta colormind", email: "noreply@colormind.com.br" },
    subject: `🎉 Novo Cadastro: ${profile.fullName}`,
    html: adminEmailHtml,
  });
}

export const notifyAdminOnRegistrationStart = onDocumentCreated("incompleteRegistrations/{email}", async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    logger.error("Evento onDocumentCreated sem dados.");
    return;
  }
  const userEmail = event.params.email;
  const data = snapshot.data();
  logger.info(`Novo cadastro iniciado: ${userEmail}`);
  if (!data || !data.userProfile) {
    logger.warn(`Documento em "incompleteRegistrations/${userEmail}" sem userProfile.`);
    return;
  }
  try {
    await getSecrets();
    const adminEmail = "ronaldo.fortini.jr@gmail.com";
    const userName = data.userProfile.fullName || "Ainda não informado";
    const emailProps = { userEmail, userName };
    const emailHtml = getRegistrationStartAdminAlertEmailHTML(emailProps);
    const msg = {
      to: adminEmail,
      from: { name: "Alerta colormind", email: "noreply@colormind.com.br" },
      subject: `🚀 Início de Novo Cadastro: ${userEmail}`,
      html: emailHtml,
    };
    await sgMail.send(msg);
    logger.info(`Notificação de início de cadastro enviada para ${adminEmail}.`);
  } catch (error) {
    logger.error(`Falha ao enviar notificação de início de cadastro para ${userEmail}.`, error);
  }
});