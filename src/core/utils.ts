import { logger } from "firebase-functions";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import { getSecrets } from "./secrets";
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { NutritionalInfo, FoodItem, Food, Address, Coordinates } from "../models/models";
import { v4 as uuidv4 } from 'uuid';
import Holidays from "date-holidays";
// import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
// import sgMail = require("@sendgrid/mail");
const sgClient = require("@sendgrid/client");
import { Twilio } from "twilio";
import { GoogleGenAI } from '@google/genai';
import { Client } from "@googlemaps/google-maps-services-js";


// Função callAI atualizada para usar o Vertex AI
export async function callAI(prompt: string, aiProvider: 'GEMINI' | 'OPENAI', jsonResponse: boolean = true): Promise<string> {
  const secrets = await getSecrets();
  let aiResponseText: string | null = null;

  // As suas funções estão em São Paulo, então definimos a localização.
  const project = process.env.GCP_PROJECT || "meal-plan-280d2";
  const location = "us-central1";

  console.log('using VERTEX AI')

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (aiProvider === 'GEMINI') {
        
        // 1. Inicialização do Cliente GenAI no modo Vertex AI
        const aiClient = new GoogleGenAI({
            vertexai: true,
            project: project,
            location: location,
        });

        // 2. NOME DO MODELO
        const model = "gemini-2.5-flash";

        // 3. Chamada de Conteúdo CORRIGIDA (usando .models.generateContent)
        const result = await aiClient.models.generateContent({
            model: model,
            contents: prompt,
            config: {
                // A configuração de geração agora usa a chave 'config'
                responseMimeType: jsonResponse ? "application/json" : "text/plain",
            }
        });

        // 4. Tratamento da resposta CORRIGIDA (usando .text e .usageMetadata diretamente no 'result')
        if (result.usageMetadata) {
          logger.info(`Gemini Token Usage (Vertex AI):`, result.usageMetadata);
        }

        aiResponseText = result.text ?? null; // Correção: Acessa o texto principal via .text

      } else { // OPENAI (continua igual)
        if (!secrets.openAiApiKey) throw new HttpsError("failed-precondition", "Chave da API da OpenAI não configurada.");
        const openai = new OpenAI({ apiKey: secrets.openAiApiKey });
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          response_format: jsonResponse ? { type: "json_object" } : { type: "text" }
        });
        aiResponseText = completion.choices[0].message.content;
      }

      if (aiResponseText) {
        return aiResponseText;
      }
      throw new Error("A resposta da IA veio vazia.");
    } catch (err: any) {
      // Loga o objeto de erro completo (que pode revelar a mensagem detalhada)
      console.error(`ERRO BRUTO NA TENTATIVA ${attempt}:`, err); 
      
      let detailedMessage = `ApiError 404: Sem detalhes`;
      
      // Tenta extrair a mensagem de erro do objeto se for um ApiError
      if (err.message) {
          detailedMessage = err.message;
      } else if (err.details) {
          detailedMessage = JSON.stringify(err.details);
      }

      // Logamos o erro WARN incluindo a mensagem detalhada
      logger.warn(`Tentativa ${attempt} de chamar a IA (${aiProvider}) falhou. Causa: ${detailedMessage}`);
      
      if (attempt === 3) {
        // Se for a última tentativa, criamos um erro mais informativo antes de lançar
        throw new Error(`Falha final na IA: ${detailedMessage}`); 
      }
      
      await new Promise(res => setTimeout(res, 2000));
    }
  }
  throw new HttpsError("internal", `Falha na comunicação com a IA (${aiProvider}) após 3 tentativas.`);
}


/**
 * Converte um objeto de endereço em coordenadas geográficas usando a API do Google Maps.
 * Esta é a função centralizada para ser usada em todo o backend.
 * @param address O objeto de endereço a ser geocodificado.
 * @returns Uma Promise que resolve para um objeto Coordinates { lat, lon } ou null se não for encontrado.
 */
export async function _geocodeAddress(address: Partial<Address>): Promise<Coordinates | null> {
    if (!address.street || !address.city || !address.state) {
        logger.warn("Tentativa de geocodificar um endereço incompleto.", { address });
        return null;
    }

    try {
        const secrets = await getSecrets();
        const apiKey = secrets.geocodingApiKey;

        if (!apiKey) {
            logger.error("A chave da API do Google Maps não foi encontrada no Secret Manager (googleMapsApiKey).");
            return null;
        }

        const mapsClient = new Client({});
        const addressString = `${address.street}, ${address.number || ''}, ${address.neighborhood || ''}, ${address.city}, ${address.state}, ${address.zipCode || ''}`;

        const response = await mapsClient.geocode({
            params: {
                address: addressString,
                key: apiKey,
                region: 'BR', // Adiciona um viés para resultados no Brasil
                language: 'pt-BR' // Retorna nomes em português
            },
        });

        if (response.data.status === 'OK' && response.data.results.length > 0) {
            const location = response.data.results[0].geometry.location;
            return {
                lat: location.lat,
                lon: location.lng // A API do Google retorna 'lng', mapeamos para 'lon'
            };
        } else {
            logger.warn(`Geocodificação falhou ou não encontrou resultados para o endereço: "${addressString}"`, { status: response.data.status });
            return null;
        }

    } catch (error: any) {
        logger.error("Erro CRÍTICO durante a chamada da API de Geocodificação do Google Maps:", {
            errorMessage: error.message,
            address: address,
        });
        // Retornamos null para não quebrar o fluxo principal (ex: cadastro de usuário)
        return null;
    }
}


// --- INÍCIO DA CORREÇÃO SENDGRID ---
// 1. A promessa é declarada como nula. Ela não é inicializada aqui.
let sendgridClientPromise: Promise<any> | null = null;
// const sendgridClientPromise = initializeSendGridClient(); // <- LINHA ANTIGA

async function initializeSendGridClient() {
  try {
    // Busca os segredos (aqui que a nova chave será carregada após o deploy)
    const secrets = await getSecrets();
    if (!secrets.sendgridKey) {
      logger.error("Chave da API do SendGrid não encontrada durante a inicialização.");
      return null;
    }
    // Configura o cliente com a chave
    sgClient.setApiKey(secrets.sendgridKey);
    logger.info("Cliente SendGrid inicializado com sucesso.");
    return sgClient;
  } catch (error) {
    logger.error("Falha catastrófica ao inicializar o cliente SendGrid:", error);
    return null;
  }
}

// Substitua sua função sendEmail por esta
export async function sendEmail(to: string, subject: string, html: string, fromName: string = "colormind"): Promise<void> {
  // 2. A inicialização é chamada AQUI, na primeira vez que a função for usada.
  if (!sendgridClientPromise) {
    sendgridClientPromise = initializeSendGridClient();
  }
  // 3. Aguarda a promessa de inicialização ser resolvida
  const client = await sendgridClientPromise;

  // 4. Verifica se o cliente foi inicializado com sucesso
  if (!client) {
    // 5. CORREÇÃO: Removido o texto "firebase deploy --only functions" do log de erro
    logger.error("Tentativa de enviar e-mail, mas o cliente SendGrid não está inicializado.");
    throw new HttpsError("internal", "Serviço de e-mail não está disponível.");
  }

  // 6. Monta a requisição (a lógica interna permanece a mesma)
  const request = {
    method: 'POST' as const,
    url: '/v3/mail/send',
    body: {
      personalizations: [{ to: [{ email: to }] }],
      from: { name: fromName, email: "noreply@colormind.com.br" },
      subject: subject,
      content: [{ type: 'text/html', value: html }]
    }
  };

  try {
    // 7. Envia a requisição usando o cliente já configurado
    await client.request(request);
    logger.info(`E-mail com assunto "${subject}" enviado para ${to}.`);
  } catch (error: any) {
    logger.error(`Falha ao enviar e-mail para ${to}:`, error);
    if (error.response) {
      logger.error("Detalhes da resposta do erro do SendGrid:", error.response.body);
    }
    throw new HttpsError("internal", "Não foi possível enviar o e-mail.");
  }
}
// --- FIM DA CORREÇÃO SENDGRID ---


// --- INÍCIO DA CORREÇÃO TWILIO (MESMO PROBLEMA) ---
// 1. A promessa é declarada como nula.
let twilioPromise: Promise<TwilioConfig | null> | null = null;
// const twilioPromise = initializeTwilio(); // <- LINHA ANTIGA

interface TwilioConfig {
  client: Twilio;
  phoneNumber: string;
}

async function initializeTwilio(): Promise<TwilioConfig | null> {
  try {
    const secrets = await getSecrets();

    // --- CORREÇÃO AQUI ---
    // Usando os nomes corretos da sua interface: twilioSid e twilioToken
    if (!secrets.twilioSid || !secrets.twilioToken || !secrets.twilioPhoneNumber) {
      logger.error("Segredos do Twilio (twilioSid, twilioToken, twilioPhoneNumber) não encontrados durante a inicialização.");
      return null;
    }

    // --- E CORREÇÃO AQUI ---
    const twilioClient = new Twilio(secrets.twilioSid, secrets.twilioToken);
    logger.info("Cliente Twilio inicializado com sucesso.");

    return {
      client: twilioClient,
      phoneNumber: secrets.twilioPhoneNumber,
    };

  } catch (error) {
    logger.error("Falha catastrófica ao inicializar o cliente Twilio:", error);
    return null;
  }
}


// --- A FUNÇÃO sendSms CONTINUA IGUAL E JÁ FUNCIONARÁ ---
export async function sendSms(phone: string, message: string): Promise<void> {
  // 2. A inicialização é chamada AQUI, na primeira vez que a função for usada.
  if (!twilioPromise) {
    twilioPromise = initializeTwilio();
  }
  const twilioConfig = await twilioPromise;

  if (!twilioConfig) {
    logger.error("Tentativa de enviar SMS, mas o cliente Twilio não está inicializado.");
    throw new HttpsError("internal", "Serviço de SMS não está disponível.");
  }

  const cleanPhoneNumber = `+55${phone.replace(/\D/g, "")}`;

  try {
    await twilioConfig.client.messages.create({
      body: message,
      from: twilioConfig.phoneNumber,
      to: cleanPhoneNumber,
    });
    logger.info(`SMS enviado com sucesso para ${cleanPhoneNumber}.`);
  } catch (error: any) {
    logger.error(`Falha ao enviar SMS para ${cleanPhoneNumber}:`, error);
    throw new HttpsError("internal", `Não foi possível enviar o SMS. Código: ${error.code}`);
  }
}
// --- FIM DA CORREÇÃO TWILIO ---


export function formatFirstName(fullName: string | undefined | null): string {
  // 1. Garante que o nome não é nulo ou vazio
  if (!fullName || typeof fullName !== 'string' || fullName.trim() === '') {
    return 'Cliente'; // Retorna um valor padrão educado
  }

  // 2. Pega a primeira palavra
  const firstNameRaw = fullName.trim().split(' ')[0];

  // 3. Formata: primeira letra maiúscula, resto minúsculo
  return firstNameRaw.charAt(0).toUpperCase() + firstNameRaw.slice(1).toLowerCase();
}


/**
 * Calcula os nutrientes totais de um item alimentar com base em sua quantidade.
 * @param food O objeto Food.
 * @param quantity A quantidade em gramas.
 * @returns Um objeto com os nutrientes totais calculados.
 */
export const calculateTotalNutrients = (food: Food, quantity: number) => {
    const info = food.nutritional_info_per_100g;
    if (!info) {
        return { totalEnergy: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0 };
    }
    const factor = quantity / 100;
    return {
        totalEnergy: (info.energy || 0) * factor,
        totalProtein: (info.proteins || 0) * factor,
        totalCarbs: (info.carbohydrates || 0) * factor,
        totalFat: (info.total_fat || 0) * factor,
        // Adicione outros micro/macronutrientes que você usa no seu score
    };
};

// NOVO: Função para achar o macro principal
export const getMainMacronutrient = (food: Food): 'protein' | 'carbohydrates' | 'fat' => {
    const info = food.nutritional_info_per_100g;
    if (!info) return 'carbohydrates'; // Padrão
    if ((info.proteins || 0) > (info.carbohydrates || 0) && (info.proteins || 0) > (info.total_fat || 0)) return 'protein';
    if ((info.total_fat || 0) > (info.carbohydrates || 0) && (info.total_fat || 0) > (info.proteins || 0)) return 'fat';
    return 'carbohydrates';
};


/**
 * Calcula o número de horas úteis decorridas entre duas datas.
 * Considera apenas o horário das 10:00 às 17:00, de Seg a Sex, e exclui feriados.
 * @param start A data/hora de início.
 * @param end A data/hora final (geralmente o momento atual).
 * @returns O número de horas úteis decorridas.
 */
export function calculateBusinessHoursElapsed(start: Date, end: Date): number {
  const hd = new Holidays("BR", "MG");
  const BUSINESS_START_HOUR = 10;
  const BUSINESS_END_HOUR = 17;
  let totalBusinessMillis = 0;

  // Normaliza as datas para o fuso horário de São Paulo para consistência
  const startTime = new Date(start.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const endTime = new Date(end.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));

  // Define um cursor que começa no início do dia do start time
  let cursor = new Date(startTime);
  cursor.setHours(0, 0, 0, 0);

  // Itera dia a dia até o dia do end time
  while (cursor <= endTime) {
    const dayOfWeek = cursor.getDay(); // 0=Dom, 6=Sáb
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = hd.isHoliday(cursor);

    if (!isWeekend && !isHoliday) {
      // Define o início e o fim do horário comercial para o dia do cursor
      const dayBusinessStart = new Date(cursor);
      dayBusinessStart.setHours(BUSINESS_START_HOUR, 0, 0, 0);

      const dayBusinessEnd = new Date(cursor);
      dayBusinessEnd.setHours(BUSINESS_END_HOUR, 0, 0, 0);

      // Calcula a sobreposição (intersecção) entre o intervalo do pedido e o horário comercial do dia
      const effectiveStart = Math.max(startTime.getTime(), dayBusinessStart.getTime());
      const effectiveEnd = Math.min(endTime.getTime(), dayBusinessEnd.getTime());

      const overlap = Math.max(0, effectiveEnd - effectiveStart);
      totalBusinessMillis += overlap;
    }

    // Avança o cursor para o próximo dia
    cursor.setDate(cursor.getDate() + 1);
  }

  // Converte os milissegundos totais para horas
  return totalBusinessMillis / (1000 * 60 * 60);
}


export const formatActivityLevel = (level: string): string => {
  const activityMap: { [key: string]: string } = {
    "1": "Sedentário (pouco ou nenhum exercício)",
    "2": "Levemente Ativo (exercício leve 1-3 dias/semana)",
    "3": "Moderadamente Ativo (exercício moderado 3-5 dias/semana)",
    "4": "Muito Ativo (exercício intenso 6-7 dias/semana)",
    "5": "Extremamente Ativo (exercício muito intenso/trabalho físico)",
  };
  return activityMap[level] || `Nível desconhecido (${level})`; // Retorna o texto ou um padrão
};


/**
 * Função central para chamadas à IA, agora usando @google/generative-ai.
 */
// export async function callAI(prompt: string, aiProvider: 'GEMINI' | 'OPENAI'): Promise<string> {
//   if (aiProvider !== 'GEMINI') {
//     throw new HttpsError("unimplemented", "Apenas o provedor GEMINI está configurado.");
//   }

//   // const secrets = await getSecrets();
//   // const GEMINI_API_KEY = secrets.geminiApiKey;
//   const GEMINI_API_KEY = "AIzaSyACO1zMxsV2sEooba2_lt8RftUvjZD4vHI";
//   // --- FIM DA ALTERAÇÃO ---

//   if (!GEMINI_API_KEY) {
//     // A mensagem de erro agora reflete que a chave não foi encontrada via Secret Manager
//     throw new HttpsError("internal", "A API Key do Gemini não foi encontrada no Secret Manager.");
//   }

//   for (let attempt = 1; attempt <= 3; attempt++) {
//     try {
//       const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
//       const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });

//       const result = await model.generateContent(prompt);
//       const response = result.response;
//       const responseText = response.text();

//       if (responseText) {
//         const cleanedText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
//         return cleanedText;
//       }
//       throw new Error("A resposta da IA veio vazia.");

//     } catch (err: any) {
//       logger.warn(`Tentativa ${attempt} de chamar a IA (Gemini) falhou. Erro: ${err.message}`);
//       if (attempt === 3) throw err;
//       await new Promise(res => setTimeout(res, 2000));
//     }
//   }
//   throw new HttpsError("internal", `Falha na comunicação com a IA (Gemini) após 3 tentativas.`);
// }


/**
 * Calcula o "início efetivo" para a contagem do tempo de um pedido confirmado,
 * pulando fins de semana, feriados e horários fora do expediente.
 * @param confirmedTimestamp O timestamp de quando o pedido foi confirmado.
 * @returns O timestamp de quando a contagem de tempo deve começar (ex: próximo dia útil às 10h).
 */
export function getEffectiveStartTime(confirmedTimestamp: admin.firestore.Timestamp): admin.firestore.Timestamp {
  const hd = new Holidays("BR", "MG");
  const confirmedDate = confirmedTimestamp.toDate();
  const confirmedDateSP = new Date(confirmedDate.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));

  const diaDaSemana = confirmedDateSP.getDay(); // Domingo=0, Sábado=6
  const hora = confirmedDateSP.getHours();

  const isWeekend = diaDaSemana === 0 || diaDaSemana === 6;
  const isHoliday = hd.isHoliday(confirmedDateSP);

  // Caso 1: Dentro do horário comercial (Seg-Sex, 10h-17h, não feriado)
  if (!isWeekend && !isHoliday && hora >= 10 && hora < 17) {
    return confirmedTimestamp;
  }

  // Caso 2: Fora do horário comercial. Encontrar o próximo início de dia útil.
  let effectiveStartDate = new Date(confirmedDateSP);

  if (!isWeekend && !isHoliday && hora < 10) {
    effectiveStartDate.setHours(10, 0, 0, 0);
    return admin.firestore.Timestamp.fromDate(effectiveStartDate);
  }

  effectiveStartDate.setDate(effectiveStartDate.getDate() + 1);

  while (effectiveStartDate.getDay() === 0 || effectiveStartDate.getDay() === 6 || hd.isHoliday(effectiveStartDate)) {
    effectiveStartDate.setDate(effectiveStartDate.getDate() + 1);
  }

  effectiveStartDate.setHours(10, 0, 0, 0);

  return admin.firestore.Timestamp.fromDate(effectiveStartDate);
}


/**
 * Gera um ID de dieta sequencial para um usuário usando uma transação atômica.
 * Ex: Se o usuário tem 2 dietas, o próximo ID será '{userId}-3'.
 * @param db A instância do Firestore.
 * @param userId O UID do usuário.
 * @returns Uma string com o novo ID sequencial.
 */
export async function generateSequentialDietId(db: admin.firestore.Firestore, userId: string): Promise<string> {
  const userDocRef = db.collection('users').doc(userId);

  // db.runTransaction garante que as operações de leitura e escrita sejam atômicas.
  const nextDietNumber = await db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userDocRef);

    // Obtém a contagem atual do documento do usuário, ou 0 se não existir.
    const currentCount = userDoc.data()?.dietCount || 0;

    // Calcula o próximo número.
    const newCount = currentCount + 1;

    // Atualiza o documento do usuário com a nova contagem dentro da transação.
    transaction.update(userDocRef, { dietCount: newCount });

    // Retorna o novo número para ser usado no ID.
    return newCount;
  });

  // Constrói e retorna o ID final.
  return `${userId}-${nextDietNumber}`;
}




export async function _initiatePixRefundLogic(txid: string, amount: number, reason: string) {
  try {
    console.log('IS SANDBOX FROM PROCESS.ENV.EFI_SANDBOX::: ', process.env.EFI_SANDBOX);
    const accessToken = await getEfiAuthToken();
    const { keyBuffer, certBuffer } = await getEfiCertificates();
    const isSandbox = process.env.EFI_SANDBOX === 'true';
    const hostname = isSandbox ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';

    // 1. Primeiro, precisamos consultar a cobrança para obter o 'endToEndId' (e2eId)
    const cobOptions = {
      hostname,
      path: `/v2/cob/${txid}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      cert: certBuffer,
      key: keyBuffer,
    };
    const chargeDetails = await httpsRequest(cobOptions);
    const e2eId = chargeDetails.pix?.[0]?.endToEndId;

    if (!e2eId) {
      throw new Error("Não foi possível encontrar o 'endToEndId' da transação original para o estorno.");
    }

    // 2. Agora, com o e2eId, iniciamos a devolução
    const refundId = `REF${uuidv4().replace(/-/g, '')}`.slice(0, 32); // ID único para a devolução
    const refundAmountString = amount.toFixed(2);
    const refundBody = JSON.stringify({ valor: refundAmountString });

    const refundOptions = {
      hostname,
      path: `/v2/pix/${e2eId}/devolucao/${refundId}`,
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      cert: certBuffer,
      key: keyBuffer,
    };

    const refundResponse = await httpsRequest(refundOptions, refundBody);
    logger.info(`Estorno solicitado com sucesso na Efí para o e2eId [${e2eId}]. ID da Devolução: ${refundId}`, refundResponse);

    // 3. Retorna os detalhes do estorno para serem salvos no Firestore
    return {
      refundId: refundId,
      rtrId: refundResponse.rtrId,
      status: refundResponse.status, // Ex: EM_PROCESSAMENTO
      amount: parseFloat(refundResponse.valor),
      requestedAt: admin.firestore.Timestamp.now(),
      reason: reason,
    };

  } catch (error: any) {
    logger.error(`Falha crítica ao iniciar o estorno para o txid [${txid}]:`, error);
    // Verifica se o erro é de estorno duplicado e o propaga
    if (error.message && error.message.includes("valor_devolucao_atingido")) {
      throw new HttpsError("already-exists", "Um estorno para este pedido já foi processado anteriormente.");
    }
    throw new HttpsError("internal", "Não foi possível se comunicar com o provedor de pagamento para o estorno.");
  }
}


/**
 * Formata um ID de dieta sequencial (ex: "uid-1") para um formato amigável ("#001").
 * @param {string} dietId O ID completo da dieta.
 * @returns {string} O ID formatado para exibição.
 */
export function formatOrderIdForDisplay(dietId: string): string {
  if (!dietId || typeof dietId !== 'string') {
    return '#';
  }

  const parts = dietId.split('-');
  const numberPart = parts.pop();

  if (!numberPart || isNaN(Number(numberPart))) {
    return '#';
  }

  // Formata o número para ter sempre 3 dígitos (ex: 1 -> "001", 10 -> "010")
  const formattedNumber = numberPart.padStart(3, '0');

  return `#${formattedNumber}`;
}

// Interface para o objeto de retorno da nossa nova função
export interface DietMetrics {
  totalEstimatedPrice: number;
  totalEstimatedWeightInGrams: number;
  nutritionalValuesGetted: NutritionalInfo;
}

/**
 * Função auxiliar para calcular o peso de um item em gramas com base na sua unidade.
 */
// Função auxiliar para calcular o peso de um item em gramas
function getItemWeightInGrams(food: Food): number {
  const quantity = Number(food.quantity);

  // Sua regra: se a unidade for 'unit' E weight_per_unit_in_g existir, usa o cálculo especial.
  if (food.default_unit?.toLowerCase() === 'unit' && food.weight_per_unit_in_g) {
    // Converte o peso por unidade (que é string) para número
    const weightPerUnit = Number(food.weight_per_unit_in_g);
    return quantity * (weightPerUnit || 0);
  }

  // Para TODOS os outros casos ('g', 'kg', etc.), a 'quantity' representa o peso na unidade especificada.
  switch (food.default_unit?.toLowerCase()) {
    case 'g':
    case 'ml':
      return quantity;
    case 'kg':
    case 'l':
      return quantity * 1000;
    default:
      logger.warn(`Unidade desconhecida ou não aplicável '${food.default_unit}' para o alimento '${food.standard_name}'. Assumindo que a 'quantity' está em gramas.`);
      return quantity;
  }
}

/**
 * Calcula o preço, peso e totais nutricionais de uma seleção de alimentos.
 */
export function calculateDietMetrics(aiSelection: FoodItem[]): DietMetrics {

  // Usamos 'reduce' para iterar sobre a seleção e acumular os totais em um único objeto.
  const weeklyTotals = aiSelection.reduce((totals, item) => {
    // Garante que o item e seus dados essenciais existam
    if (item?.food?.estimatedPrice && item?.food?.nutritional_info_per_100g && item?.food?.quantity) {
      const food = item.food;

      // Acumula o preço
      totals.price += food.estimatedPrice;

      // Calcula e acumula o peso usando a função auxiliar
      const itemWeightInGrams = getItemWeightInGrams(food);
      totals.weight += itemWeightInGrams;

      // Acumula os nutrientes
      for (const key of Object.keys(totals.nutrients) as Array<keyof NutritionalInfo>) {
        const nutrientValue = food.nutritional_info_per_100g[key] || 0;
        totals.nutrients[key] += nutrientValue * (itemWeightInGrams / 100);
      }
    }
    return totals;
  }, { // Valor inicial do nosso acumulador
    price: 0,
    weight: 0,
    nutrients: createEmptyNutritionalInfo(),
  });

  // Calcula a média diária dos nutrientes, da mesma forma que antes
  const nutritionalValuesGetted = { ...weeklyTotals.nutrients };
  for (const key of Object.keys(nutritionalValuesGetted) as Array<keyof NutritionalInfo>) {
    nutritionalValuesGetted[key] = parseFloat((nutritionalValuesGetted[key] / 7).toFixed(2));
  }

  // Retorna o objeto final no formato esperado
  return {
    totalEstimatedPrice: weeklyTotals.price,
    totalEstimatedWeightInGrams: weeklyTotals.weight,
    nutritionalValuesGetted,
  };
}








/**
 * LÓGICA CENTRAL: Calcula a estimativa de preço de uma corrida usando a API do Google Directions.
 * @param pickupAddressString O endereço de partida.
 * @param dropoffAddressString O endereço de destino.
 * @returns Um objeto com a estimativa de preço.
 */
export async function _getRidePriceEstimateLogic(pickupAddressString: string, dropoffAddressString: string) {
  const secrets = await getSecrets();
  const GOOGLE_MAPS_API_KEY = secrets.geocodingApiKey;
  if (!GOOGLE_MAPS_API_KEY) {
    throw new HttpsError("failed-precondition", "A chave da API do Google Maps não está configurada.");
  }

  const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(pickupAddressString)}&destination=${encodeURIComponent(dropoffAddressString)}&key=${GOOGLE_MAPS_API_KEY}&language=pt-BR`;

  const directionsResponse = await fetch(directionsUrl);
  const directionsData = await directionsResponse.json();

  if (directionsData.status !== 'OK' || !directionsData.routes[0]?.legs[0]) {
    logger.error("Erro da Directions API ao estimar preço da corrida:", directionsData);
    throw new HttpsError("not-found", "Não foi possível calcular a rota para a estimativa de preço.");
  }

  const leg = directionsData.routes[0].legs[0];
  const distanceInKm = leg.distance.value / 1000;
  const durationInMin = leg.duration.value / 60;

  // Fórmula de Preço (baseada em médias de apps de transporte no Brasil)
  const baseFare = 3.00;
  const pricePerKm = 1.40;
  const pricePerMin = 0.26;

  const estimatedPrice = baseFare + (distanceInKm * pricePerKm) + (durationInMin * pricePerMin);

  const lowEstimate = Math.max(estimatedPrice, 7.00); // Valor mínimo de corrida
  const highEstimate = lowEstimate * 1.30; // Margem de 30% para trânsito/demanda

  return {
    lowEstimate: parseFloat(lowEstimate.toFixed(2)),
    highEstimate: parseFloat(highEstimate.toFixed(2)),
  };
}











/**
 * Função auxiliar para extrair informações do motorista do texto de um print.
 * @param text O texto completo extraído pela Vision API.
 * @returns Um objeto com os detalhes do motorista.
 */
export function _extractDriverInfoFromText(text: string) {
  const cleanedText = text.toUpperCase().replace(/\n/g, ' ');

  let driverName = 'Não identificado';
  let vehicleInfo = 'Não identificado';
  let licensePlate = 'Não identificada';

  // Tenta encontrar a placa (padrão Mercosul e antigo)
  const plateRegex = /[A-Z]{3}[0-9][A-Z][0-9]{2}|[A-Z]{3}-?[0-9]{4}/;
  const plateMatch = cleanedText.match(plateRegex);
  if (plateMatch) {
    licensePlate = plateMatch[0].replace('-', '');
  }

  // Tenta encontrar o veículo (Ex: "FIAT MOBI BRANCO")
  // Esta é uma expressão simplificada, pode ser melhorada
  const vehicleRegex = /(?:CARRO|VEÍCULO|MODELO)\s*:\s*([A-Z\s0-9]+?)(?=\s+[A-Z]{3}[0-9]|$)/;
  const vehicleMatch = cleanedText.match(vehicleRegex);
  if (vehicleMatch && vehicleMatch[1]) {
    vehicleInfo = vehicleMatch[1].trim();
  }

  // Tenta encontrar o nome do motorista (um nome em maiúsculas antes da placa)
  if (plateMatch && plateMatch.index) {
    const textBeforePlate = cleanedText.substring(0, plateMatch.index);
    const nameRegex = /([A-ZÀ-Ú\s]+)\s*$/;
    const nameMatch = textBeforePlate.match(nameRegex);
    if (nameMatch && nameMatch[1].trim().length > 3) {
      driverName = nameMatch[1].trim().split(' ').map(n => n.charAt(0) + n.slice(1).toLowerCase()).join(' ');
    }
  }

  return { driverName, vehicleInfo, licensePlate };
}








export async function getUberAccessToken(): Promise<string> {

  let secrets = await getSecrets();


  const clientId = secrets.uberClientId;
  const clientSecret = secrets.uberClientSecret;

  // Verificação de segurança para garantir que as credenciais foram carregadas
  if (!clientId || !clientSecret) {
    logger.error("Credenciais da Uber (Client ID ou Client Secret) não encontradas. Verifique a configuração de segredos/env.");
    throw new HttpsError("failed-precondition", "A integração com o serviço de entrega não está configurada corretamente.");
  }

  const tokenUrl = "https://login.uber.com/oauth/v2/token";
  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);
  params.append("grant_type", "client_credentials");
  params.append("scope", "direct.deliveries");

  try {
    logger.info("Solicitando token de acesso real da Uber...");
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const data = await response.json() as any;
    if (!response.ok) {
      logger.error("Falha ao obter token da Uber:", data);
      throw new Error(data.error_description || data.error);
    }
    logger.info("Token de acesso da Uber obtido com sucesso.");
    return data.access_token;
  } catch (error) {
   logger.error("Erro catastrófico ao obter token da Uber:", error);
    throw new HttpsError("internal", "Não foi possível autenticar com a API da Uber.");
  }
}



// =========================================================================
// FUNÇÃO AUXILIAR PARA FAZER REQUISIÇÕES HTTPS
// =========================================================================

/**
 * Função genérica e reutilizável para fazer requisições HTTPS seguras com certificado.
 * @param options As opções da requisição (hostname, path, method, headers, cert, key).
 * @param postData O corpo da requisição para métodos POST/PUT.
 * @returns Uma promessa com a resposta da API em formato JSON.
 */
export async function httpsRequest(options: https.RequestOptions, postData?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        try {
          if (!responseBody) {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve({});
              return;
            } else {
              reject(new Error(`API Error - Status ${res.statusCode} with empty response.`));
              return;
            }
          }
          const responseJson = JSON.parse(responseBody);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(responseJson);
          } else {
            reject(new Error(`API Error - Status ${res.statusCode}: ${responseBody}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse JSON response: ${responseBody}`));
        }
      });
    });
    req.on('error', (error) => reject(error));
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}


// =========================================================================
// FUNÇÃO AUXILIAR PARA OBTER OS CERTIFICADOS DE FORMA CENTRALIZADA
// =========================================================================

interface EfiCertificates {
  keyBuffer: Buffer;
  certBuffer: Buffer;
}

export async function getEfiCertificates(): Promise<EfiCertificates> {


  const privateKeyName = 'chave_privada.pem';
  const certificateName = 'certificado_publico.pem';

  const privateKeyPath = path.join(process.cwd(), 'certs', privateKeyName);
  const certificatePath = path.join(process.cwd(), 'certs', certificateName);

  const keyBuffer = fs.readFileSync(privateKeyPath);
  const certBuffer = fs.readFileSync(certificatePath);

  return { keyBuffer, certBuffer };
}

// =========================================================================
// FUNÇÃO PARA OBTER O TOKEN DE AUTENTICAÇÃO
// =========================================================================
export async function getEfiAuthToken() {
  const secrets = await getSecrets(); 
  const isSandbox = process.env.EFI_SANDBOX === 'true';

  logger.info(`Iniciando autenticação na Efí em modo: ${isSandbox ? 'Homologação' : 'Produção'}`);

  const clientId = isSandbox ? secrets.efiChaveClientIdHom : secrets.efiChaveClientId;
  const clientSecret = isSandbox ? secrets.efiChaveSecretHom : secrets.efiChaveClientSecret;
  const hostname = isSandbox ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';

  // Obter os certificados de forma centralizada
  const { keyBuffer, certBuffer } = await getEfiCertificates();

  const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const options: https.RequestOptions = {
    hostname: hostname,
    path: '/oauth/token',
    method: 'POST',
    headers: {
      'Authorization': `Basic ${authString}`,
      'Content-Type': 'application/json'
    },
    cert: certBuffer,
    key: keyBuffer,
  };

  const postData = JSON.stringify({ grant_type: 'client_credentials' });

  try {
    const authResponse = await httpsRequest(options, postData);
    if (authResponse.access_token) {
      return authResponse.access_token;
    } else {
      throw new Error("A resposta da autenticação não continha um access_token.");
    }
  } catch (error) {
    logger.error("Falha na autenticação com a Efí:", error);
    throw new Error("Não foi possível obter o token de autenticação da Efí.");
  }
}

// =========================================================================
// FUNÇÕES AUXILIARES PARA AS CHAMADAS DA API DE COBRANÇA
// =========================================================================

async function createEfiCharge(accessToken: string, valor: string, pedidoId: string, pixKey: string, hostname: string, keyBuffer: Buffer, certBuffer: Buffer) {
  const cobBody = JSON.stringify({
    calendario: { expiracao: 3600 },
    valor: { original: valor },
    chave: pixKey,
    solicitacaoPagador: `Pagamento do Pedido #${pedidoId} - colormind`,
  });
  const cobOptions = {
    hostname, path: '/v2/cob', method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cobBody) },
    cert: certBuffer,
    key: keyBuffer,
  };
  return httpsRequest(cobOptions, cobBody);
}

async function generateEfiQrCode(accessToken: string, locId: string, hostname: string, keyBuffer: Buffer, certBuffer: Buffer) {
  const qrCodeOptions = {
    hostname, path: `/v2/loc/${locId}/qrcode`, method: 'GET',
    headers: { 'Authorization': `Bearer ${accessToken}` },
    cert: certBuffer,
    key: keyBuffer,
  };
  return httpsRequest(qrCodeOptions);
}

// =========================================================================
// FUNÇÃO PRINCIPAL PARA GERAR A COBRANÇA PIX COMPLETA
// =========================================================================
export async function _generatePixChargeLogic(valor: string, pedidoId: string) {
  try {
    const accessToken = await getEfiAuthToken();
    logger.info(`Token de acesso obtido para o pedido [${pedidoId}]`);

    const isSandbox = process.env.EFI_SANDBOX === 'true';
    const hostname = isSandbox ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';
    const pixKey = isSandbox ? 'bbd6d1fe-318f-42b3-8998-746fc8cef08e' : 'bbd6d1fe-318f-42b3-8998-746fc8cef08e';

    // Obter os certificados de forma centralizada
    const { keyBuffer, certBuffer } = await getEfiCertificates();

    const chargeResponse = await createEfiCharge(accessToken, valor, pedidoId, pixKey, hostname, keyBuffer, certBuffer);
    const locId = chargeResponse.loc.id;

    const qrCodeResponse = await generateEfiQrCode(accessToken, locId, hostname, keyBuffer, certBuffer);

    logger.info(`Iniciando upload do QR Code para o pedido [${pedidoId}]`);

    const base64Data = qrCodeResponse.imagemQrcode.split(';base64,').pop();
    if (!base64Data) {
      throw new Error("Formato de imagem Base64 inválido recebido da Efí.");
    }

    const imageBuffer = Buffer.from(base64Data, 'base64');
    const filePath = `diets/${pedidoId}/qrcode.png`;
    const bucket = admin.storage().bucket();
    const file = bucket.file(filePath);

    await file.save(imageBuffer, { metadata: { contentType: 'image/png' } });
    await file.makePublic();
    const qrCodePublicUrl = file.publicUrl();

    logger.info(`QR Code salvo com sucesso no Storage em: ${qrCodePublicUrl}`);

    return {
      method: "pix",
      status: "pending",
      txid: chargeResponse.txid,
      qrCodeImage: qrCodeResponse.imagemQrcode,
      qrCodeImageUrl: qrCodePublicUrl,
      copiaECola: qrCodeResponse.qrcode,
      createdAt: new Date()
    };

  } catch (error) {
    logger.error(`Erro na lógica de geração de PIX para o pedido [${pedidoId}]:`, error);
    throw new Error("Falha ao se comunicar com o provedor de pagamento.");
  }
}



export function parsePix(payload: string): any {
  // O objeto onde vamos guardar os resultados (ex: {'54': '10.00', '59': 'Nome Loja'})
  const result: { [key: string]: any } = {};
  // Um 'cursor' que marca onde estamos na string gigante. Começa no início (posição 0).
  let index = 0;

  // Um loop que continua enquanto nosso 'cursor' não chegar ao final da string.
  while (index < payload.length) {

    // 1. Pega o ID do campo (os 2 primeiros caracteres).
    const id = payload.substring(index, index + 2);

    // 2. Pega o Tamanho do campo (os 2 caracteres seguintes).
    const lengthStr = payload.substring(index + 2, index + 4);

    // Se não houver mais nada para ler, sai do loop.
    if (!lengthStr) break;

    // Converte o tamanho (que é texto, ex: "05") para um número (ex: 5).
    const length = parseInt(lengthStr, 10);

    // 3. Pega o Valor, usando o tamanho que acabamos de descobrir.
    const value = payload.substring(index + 4, index + 4 + length);

    // 4. Move o 'cursor' para o início do próximo campo.
    index += 4 + length;

    // Lógica especial para o campo '26', que pode conter outros campos PIX dentro dele.
    if (id === '26' && value.length > 0) {
      // Se for o campo 26, chamamos a função novamente para decodificar a parte interna.
      result[id] = parsePix(value);
    } else {
      // Para todos os outros campos, simplesmente guardamos o valor.
      result[id] = value;
    }
  }

  // Retorna o objeto final com tudo decodificado.
  return result;
}




// =========================================================================
// FUNÇÃO AUXILIAR PARA INICIAR UM PAGAMENTO PIX (ALTO RISCO - PRODUÇÃO)
// =========================================================================
// export async function _initiatePixPaymentLogic(pixCode: string) {
//   logger.info("Iniciando pagamento real via PIX na Efí...");

//   // 1. Decodificar o PIX para extrair as informações do recebedor
//   const parsedPix = parsePix(pixCode);
//   const recipientName = parsedPix['59'];
//   const pixKeyFromCode = parsedPix['26']['01'];
//   const pixPrice = parseFloat(parsedPix['54'] || '0.00');

//   if (!recipientName || !pixKeyFromCode || pixPrice === 0) {
//     throw new Error("O código PIX fornecido é inválido ou incompleto.");
//   }

//   // 2. Obter o token de autenticação e os certificados
//   const secrets = await getSecrets();
//   const accessToken = await getEfiAuthToken();
//   const { keyBuffer, certBuffer } = await getEfiCertificates();
//   const isSandbox = secrets.efiSandbox === 'true';

//   // O PIX de pagamento precisa de um txid único, diferente do da cobrança.
//   const paymentTxid = `PAG${admin.firestore().collection('temp').doc().id}`;

//   // 3. Montar o corpo da requisição de pagamento (Payout)
//   const paymentBody = JSON.stringify({
//     valor: pixPrice.toFixed(2),
//     chave: pixKeyFromCode,
//     nome: recipientName,
//     pagador: {
//       chave: 'bbd6d1fe-318f-42b3-8998-746fc8cef08e', // A chave Pix da sua conta (PAGADOR)
//     },
//     infoAdicionais: [
//       {
//         nome: "Pedido",
//         valor: paymentTxid,
//       },
//     ],
//   });

//   const hostname = isSandbox ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';

//   // 4. Montar as opções da requisição HTTPS
//   const paymentOptions = {
//     hostname,
//     path: `/v2/pix/payments/${paymentTxid}`,
//     method: 'PUT',
//     headers: {
//       'Authorization': `Bearer ${accessToken}`,
//       'Content-Type': 'application/json',
//       'Content-Length': Buffer.byteLength(paymentBody),
//     },
//     cert: certBuffer,
//     key: keyBuffer,
//   };

//   try {
//     // 5. Fazer a chamada real à API
//     const paymentResponse = await httpsRequest(paymentOptions, paymentBody);

//     logger.info("Pagamento PIX realizado com sucesso:", paymentResponse);

//     // O retorno da API da Efí contém o EndToEndId e o status
//     return {
//       endToEndId: paymentResponse.endToEndId,
//       valor: paymentResponse.valor,
//       nomeRecebedor: paymentResponse.nome,
//     };
//   } catch (error) {
//     logger.error("Falha ao realizar pagamento PIX:", error);
//     throw new Error("Não foi possível processar o pagamento PIX. Verifique as credenciais e o código.");
// D }
// }



export async function _initiatePixPaymentLogic(pixCode: string) {
  logger.info("Iniciando lógica de pagamento real de PIX (payout)...");

  try {
    // 1. Decodifica o PIX para obter os dados do recebedor (loja/mercado)
    const parsedPix = parsePix(pixCode);
    const recipientName = parsedPix['59']; // Nome do recebedor
    const pixKeyFromCode = parsedPix['26']?.['01']; // Chave PIX do recebedor
    const pixPrice = parseFloat(parsedPix['54'] || '0.00');

    if (!recipientName || !pixKeyFromCode || pixPrice === 0) {
      throw new HttpsError("invalid-argument", "O código PIX fornecido é inválido ou não contém os dados necessários (chave, valor, nome).");
    }

    // 2. Autentica-se na Efí para obter o token e os certificados
    const accessToken = await getEfiAuthToken();
    const { keyBuffer, certBuffer } = await getEfiCertificates();
    const isSandbox = process.env.EFI_SANDBOX === 'true';
    const hostname = isSandbox ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';

    // 3. Obtém a chave PIX da SUA conta, que será a pagadora
    // const secrets = await getSecrets();
    const payerPixKey = isSandbox ? 'bbd6d1fe-318f-42b3-8998-746fc8cef08e' : 'bbd6d1fe-318f-42b3-8998-746fc8cef08e'; // Assumindo que você guardou sua chave PIX nos segredos
    if (!payerPixKey) {
      throw new Error("A chave PIX da sua conta (pagadora) não está configurada.");
    }

    // 4. Cria um ID de transação único para este pagamento. É obrigatório.
    const paymentId = `PAY${uuidv4().replace(/-/g, '')}`.slice(0, 32);

    // 5. Monta o corpo (body) da requisição de pagamento
    const paymentBody = JSON.stringify({
      valor: pixPrice.toFixed(2),
      pagador: {
        chave: payerPixKey // A chave PIX da sua conta
      },
      favorecido: {
        chave: pixKeyFromCode // A chave PIX da loja que você está pagando
      }
    });

    // 6. Monta as opções da requisição HTTPS para o endpoint de pagamento
    const paymentOptions = {
      hostname,
      path: `/v2/gn/pix/${paymentId}`, // Endpoint de Payout
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      cert: certBuffer,
      key: keyBuffer,
    };

    // 7. Executa a requisição de pagamento
    const paymentResponse = await httpsRequest(paymentOptions, paymentBody);
    logger.info(`Pagamento PIX (payout) solicitado com sucesso. ID: ${paymentId}`, paymentResponse);

    // 8. Retorna os detalhes importantes da transação
    return {
      endToEndId: paymentResponse.endToEndId,
      valor: paymentResponse.valor,
    };

  } catch (error: any) {
    logger.error("Falha ao processar pagamento PIX na Efí:", error);
    // Propaga o erro para a função que a chamou (payForDiet)
    throw new Error("Não foi possível processar o pagamento PIX. Verifique as credenciais e o código.");
  }
}













// /**
//  * Obtém um token de autenticação da Efí, alternando entre os ambientes
//  * de Produção e Homologação com base nas variáveis de ambiente.
//  */
// export async function getEfiAuthToken() {
//   // 1. Busca os segredos uma única vez
//   const secrets = await getSecrets();
//   const isSandbox = secrets.efiSandbox === 'true';

//   logger.info(`Iniciando autenticação na Efí em modo: ${isSandbox ? 'Homologação' : 'Produção'}`);

//   // 2. Seleciona as credenciais, certificado, senha e hostname corretos
//   const clientId = isSandbox ? secrets.efiChaveClientIdHom : secrets.efiChaveClientId;
//   const clientSecret = isSandbox ? secrets.efiChaveSecretHom : secrets.efiChaveClientSecret;
//   const certName = isSandbox ? 'certificado-homologacao.pem' : 'certificado-producao.pem';
//   // const passphrase = isSandbox ? undefined : secrets.efiCertPass; // Senha só para produção
//   const hostname = isSandbox ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';

//   const certificatePath = path.join(process.cwd(), 'certs', certName);
//   const certBuffer = fs.readFileSync(certificatePath);

//   const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

//   // 3. Monta o objeto de opções para a requisição
//   const options: https.RequestOptions = {
//     hostname: hostname,
//     path: '/oauth/token',
//     method: 'POST',
//     headers: {
//       'Authorization': `Basic ${authString}`,
//       'Content-Type': 'application/json'
//     },
//     cert: certBuffer,
//     key: certBuffer,
//   };

//   // // 4. Adiciona a senha do certificado APENAS se ela existir (necessário para produção)
//   // if (passphrase) {
//   //   options.passphrase = passphrase;
//   // }

//   const postData = JSON.stringify({ grant_type: 'client_credentials' });

//   try {
//     // 5. Executa a requisição usando sua função auxiliar `httpsRequest`
//     const authResponse = await httpsRequest(options, postData);
//     if (authResponse.access_token) {
//       return authResponse.access_token;
//     } else {
//       throw new Error("A resposta da autenticação não continha um access_token.");
//     }
//   } catch (error) {
//     logger.error("Falha na autenticação com a Efí:", error);
//     throw new Error("Não foi possível obter o token de autenticação da Efí.");
//   }
// }

// // =========================================================================
// // FUNÇÃO PRINCIPAL PARA GERAR A COBRANÇA PIX COMPLETA (VERSÃO ATUALIZADA)
// // =========================================================================
// export async function _generatePixChargeLogic(valor: string, pedidoId: string) {
//   try {
//     // Passos 1, 2 e 3 (Autenticar, Criar Cobrança, Gerar QR) permanecem os mesmos...
//     const accessToken = await getEfiAuthToken();
//     // const secrets = await getSecrets()
//     logger.info(`Token de acesso obtido para o pedido [${pedidoId}]`);

//     const isSandbox = process.env.EFI_SANDBOX === 'true';
//     const hostname = isSandbox ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';
//     const certName = isSandbox ? 'certificado-homologacao.pem' : 'certificado-producao.pem';
//     const pixKey = isSandbox ? '62.596.365/0001-88' : '62.596.365/0001-88'; // Configure suas chaves

//     const certificatePath = path.join(process.cwd(), 'certs', certName);
//     const certBuffer = fs.readFileSync(certificatePath);

//     // Cria a cobrança...
//     const chargeResponse = await createEfiCharge(accessToken, valor, pedidoId, pixKey, hostname, certBuffer);
//     const locId = chargeResponse.loc.id;

//     // Gera o QR Code...
//     const qrCodeResponse = await generateEfiQrCode(accessToken, locId, hostname, certBuffer);

//     // --- NOVO PASSO 4: Salvar a imagem do QR Code no Firebase Storage ---
//     logger.info(`Iniciando upload do QR Code para o pedido [${pedidoId}]`);

//     const base64Data = qrCodeResponse.imagemQrcode.split(';base64,').pop();
//     if (!base64Data) {
//       throw new Error("Formato de imagem Base64 inválido recebido da Efí.");
//     }

//     const imageBuffer = Buffer.from(base64Data, 'base64');
//     const filePath = `diets/${pedidoId}/qrcode.png`;
//     const bucket = admin.storage().bucket();
//     const file = bucket.file(filePath);

//     await file.save(imageBuffer, { metadata: { contentType: 'image/png' } });
//     await file.makePublic();
//     const qrCodePublicUrl = file.publicUrl();

//     logger.info(`QR Code salvo com sucesso no Storage em: ${qrCodePublicUrl}`);

//     // ================================================================
//     // CORREÇÃO FINAL: Retorna o objeto com AMBOS os formatos do QR Code
//     // ================================================================
//     return {
//       method: "pix",
//       status: "pending",
//       txid: chargeResponse.txid,
//       qrCodeImage: qrCodeResponse.imagemQrcode, // A string Base64 completa para o app
//       qrCodeImageUrl: qrCodePublicUrl,         // A URL pública para o e-mail
//       copiaECola: qrCodeResponse.qrcode,
//       createdAt: admin.firestore.Timestamp.now()
//     };

//   } catch (error) {
//     logger.error(`Erro na lógica de geração de PIX para o pedido [${pedidoId}]:`, error);
//     throw new Error("Falha ao se comunicar com o provedor de pagamento.");
//   }
// }

// // Funções auxiliares para manter o código limpo (você pode já tê-las)
// async function createEfiCharge(accessToken: string, valor: string, pedidoId: string, pixKey: string, hostname: string, certBuffer: Buffer) {
//     const cobBody = JSON.stringify({
//       calendario: { expiracao: 3600 },
//       valor: { original: valor },
//       chave: pixKey,
//       solicitacaoPagador: `Pagamento do Pedido #${pedidoId} - colormind`,
//     });
//     const cobOptions = {
//       hostname, path: '/v2/cob', method: 'POST',
//       headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cobBody) },
//       cert: certBuffer, key: certBuffer,
//     };
//     return httpsRequest(cobOptions, cobBody);
// }

// async function generateEfiQrCode(accessToken: string, locId: string, hostname: string, certBuffer: Buffer) {
//     const qrCodeOptions = {
//         hostname, path: `/v2/loc/${locId}/qrcode`, method: 'GET',
//         headers: { 'Authorization': `Bearer ${accessToken}` },
//         cert: certBuffer, key: certBuffer,
//     };
//     return httpsRequest(qrCodeOptions);
// }





export function createEmptyNutritionalInfo(): NutritionalInfo {
  return {
    energy: 0, carbohydrates: 0, sugars: 0, fiber: 0, starch: 0, proteins: 0,
    total_fat: 0, saturated_fat: 0, trans_fat: 0, monounsaturated_fat: 0,
    polyunsaturated_fat: 0, cholesterol: 0, water: 0, vitamin_a: 0,
    vitamin_b1: 0, vitamin_b2: 0, vitamin_b3: 0, vitamin_b5: 0, vitamin_b6: 0,
    vitamin_b7: 0, vitamin_b9: 0, vitamin_b12: 0, vitamin_c: 0, vitamin_d: 0,
    vitamin_e: 0, vitamin_k: 0, calcium: 0, iron: 0, magnesium: 0,
    phosphorus: 0, potassium: 0, zinc: 0, sodium: 0, copper: 0,
    manganese: 0, selenium: 0, iodine: 0, chromium: 0, molybdenum: 0,
    silicon: 0, vanadium: 0, omega_3: 0, omega_6: 0,
  };
}



export function sanitizeNaNValues(obj: any): any {
  // ================================================================
  // CORREÇÃO ADICIONADA AQUI
  // 1. Verifica se o objeto é um Timestamp do Firestore
  if (obj instanceof admin.firestore.Timestamp) {
    // 2. Se for, retorna o objeto original sem modificá-lo
    return obj;
  }
  // ================================================================

  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeNaNValues(item));
  }
  // Garante que não vamos tentar iterar sobre outros tipos que não são objetos simples
  if (typeof obj === 'object' && obj.constructor === Object) {
    const newObj: { [key: string]: any } = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        newObj[key] = sanitizeNaNValues(obj[key]);
      }
    }
    return newObj;
  }
  if (typeof obj === 'number' && isNaN(obj)) {
    return 0; // Troca NaN por 0
  }
  return obj;
}














// export async function _generatePixChargeLogic(valor: string, pedidoId: string) {
//   try {
//     const certName = 'certificado-homologacao.pem';
//     const certificatePath = path.join(process.cwd(), 'certs', certName);

//     const secrets = await getSecrets();

//     const efiClientId = secrets.efiClientIdHom;
//     const efiClientSecret = secrets.efiChaveSecretHom;
//     const efiSandbox = secrets.efiSandbox;
//     // --- Montagem do Objeto 'options' (Forma Robusta) ---
//     // Definimos o tipo como 'any' para adicionar a propriedade 'pass' condicionalmente
//     const options: any = {
//       client_id: efiClientId,
//       client_secret: efiClientSecret,
//       sandbox: efiSandbox === 'true',
//       certificate: fs.readFileSync(certificatePath),
//     };

//     const passphrase = '';

//     // SÓ ADICIONAMOS A PROPRIEDADE 'pass' SE ELA REALMENTE EXISTIR E NÃO FOR VAZIA
//     if (passphrase && passphrase !== '') {
//       options.pass = passphrase;
//     }

//     // Com o certificado de Homologação (sem senha), a propriedade 'pass' será omitida.

//     const efi = new Gerencianet(options);

//     const body = {
//       calendario: { expiracao: 3600 },
//       valor: { original: valor },
//       chave: "1603b3d7-98cb-4ef5-9c3f-615ced3c4fcd", // Sua chave Pix de homologação
//       solicitacaoPagador: `Pagamento do Pedido #${pedidoId}`,
//     };

//     logger.info("Enviando requisição para Efí com as opções:", {
//       client_id: options.client_id,
//       sandbox: options.sandbox,
//       pass_exists: options.pass !== undefined
//     });

//     const chargeResponse = await efi.pixCreateImmediateCharge([], body);
//     const locId = chargeResponse.loc.id;
//     const qrCodeResponse = await efi.pixGenerateQRCode({ id: locId });

//     return {
//       method: "pix",
//       status: "pending",
//       txid: chargeResponse.txid,
//       qrCodeImage: qrCodeResponse.imagemQrcode,
//       copiaECola: qrCodeResponse.qrcode,
//       createdAt: new Date(),
//     };
//   } catch (error) {
//     logger.error("Erro na lógica de geração de PIX:", error);
//     throw new Error("Falha ao se comunicar com o provedor de pagamento.");
//   }
// }


































export const formatFullName = (name: string): string => {
  if (!name) return "";
  return name.toLowerCase().split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
};




// Converte a Porcentagem (ex: 22%) no Nível correspondente ('1', '2'...)
export function getPercentageFromLevel(level: string, sex: 'male' | 'female'): number {
  const levelNum = parseInt(level, 10);
  if (sex === 'male') {
    switch (levelNum) {
      case 1: return 12;
      case 2: return 15;
      case 3: return 20;
      case 4: return 25;
      default: return 20;
    }
  } else { // female
    switch (levelNum) {
      case 1: return 20;
      case 2: return 23;
      case 3: return 28;
      case 4: return 32;
      default: return 28;
    }
  }
}



export function getLevelFromPercentage(percentage: number, sex: 'male' | 'female'): string {
  if (sex === 'male') {
    if (percentage <= 13) return '1';
    if (percentage <= 17) return '2';
    if (percentage <= 24) return '3';
    return '4';
  } else { // female
    if (percentage <= 21) return '1';
    if (percentage <= 25) return '2';
    if (percentage <= 31) return '3';
    return '4';
  }
}
/**
 * Formata um número de telefone para o padrão brasileiro com DDD.
 * Ex: "31999998888" -> "(31) 99999-8888"
 * @param phone O número de telefone a ser formatado.
 * @returns O telefone formatado.
 */
export function formatPhone(phoneString: string): string {
  if (!phoneString || typeof phoneString !== 'string') {
    throw new Error("Número de telefone não fornecido ou inválido.");
  }

  const digitsOnlyPhone = phoneString.replace(/\D/g, "");

  if (digitsOnlyPhone.length < 10 || digitsOnlyPhone.length > 11) {
    throw new Error("O telefone deve ter 10 ou 11 dígitos (com DDD).");
  }

  if (digitsOnlyPhone.length === 11) {
    // Formato (XX) XXXXX-XXXX para celulares com 9º dígito
    return `(${digitsOnlyPhone.substring(0, 2)}) ${digitsOnlyPhone.substring(2, 7)}-${digitsOnlyPhone.substring(7)}`;
  } else { // length === 10
    // Formato (XX) XXXX-XXXX para telefones fixos ou celulares antigos
    return `(${digitsOnlyPhone.substring(0, 2)}) ${digitsOnlyPhone.substring(2, 6)}-${digitsOnlyPhone.substring(6)}`;
  }
}
export const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();


export function calculateAge(dateString: string): number {
  const parts = dateString.split('/');
  if (parts.length !== 3) return 0;

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  // Validação básica se a data é real
  const birthDate = new Date(year, month - 1, day);
  if (birthDate.getFullYear() !== year || birthDate.getMonth() !== month - 1 || birthDate.getDate() !== day) {
    return 0; // Retorna 0 se a data for inválida (ex: 31/02/2000)
  }

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDifference = today.getMonth() - birthDate.getMonth();

  if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  return age;
}


/**
 * Analisa a data de um pedido e determina o cronograma de entrega.
 * @param orderTimestamp O timestamp de quando o pedido foi criado.
 * @returns Um objeto com o tipo de agendamento, o dia da entrega e o timestamp agendado.
 */
export function getDeliverySchedule(orderTimestamp: admin.firestore.Timestamp): {
  scheduleType: 'immediate' | 'next_day' | 'next_business_day';
  deliveryDay: string;
  scheduledTimestamp: admin.firestore.Timestamp | null;
} {
  const hd = new Holidays("BR", "MG");
  const orderDate = orderTimestamp.toDate();
  const orderDateSP = new Date(orderDate.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));

  const diaDaSemana = orderDateSP.getDay(); // Domingo=0, Sábado=6
  const hora = orderDateSP.getHours();

  const isWeekend = diaDaSemana === 0 || diaDaSemana === 6;
  const isHoliday = hd.isHoliday(orderDateSP);
  const isAfterHours = hora >= 17;

  // Se for durante o horário comercial (Seg-Sex, antes das 17h, não feriado)
  if (!isWeekend && !isHoliday && !isAfterHours) {
    return {
      scheduleType: 'immediate',
      deliveryDay: 'hoje',
      scheduledTimestamp: null
    };
  }

  // Se for fora do horário, calcula o próximo dia útil
  let deliveryDate = new Date(orderDateSP);
  deliveryDate.setDate(deliveryDate.getDate() + 1); // Começa a verificar a partir de amanhã

  // Loop para encontrar o próximo dia que não seja fim de semana ou feriado
  while (deliveryDate.getDay() === 0 || deliveryDate.getDay() === 6 || hd.isHoliday(deliveryDate)) {
    deliveryDate.setDate(deliveryDate.getDate() + 1);
  }

  // Define o horário de início do dia de entrega (ex: 9:00 AM)
  deliveryDate.setHours(9, 0, 0, 0);

  const deliveryDayText = deliveryDate.getDay() === 1 ? 'na segunda-feira' : 'no próximo dia útil';

  return {
    scheduleType: 'next_business_day',
    deliveryDay: deliveryDayText,
    scheduledTimestamp: admin.firestore.Timestamp.fromDate(deliveryDate)
  };
}





export async function _interpretHealthDataInternal(text: string, type: string, existingItems: string[] = []): Promise<any> {
  if (!text || text.trim() === "") {
    return { items: [], reason: "negative" };
  }

  // --- DEFINIÇÃO DO PROMPT (MANTIDA IGUAL) ---

  let prompt = "";
  const persona = "Você é um assistente de IA especialista em nutrição e saúde para um aplicativo de planos alimentares. Precisa usar termos técnicos corretos da área da saúde.";
  const existingItemsString = JSON.stringify(existingItems);
  const baseInstruction = `Analise a entrada do usuário. Retorne um objeto JSON com duas chaves: "items" (um array de strings com os novos itens padronizados) e "reason" (uma string explicando o resultado).
    Valores possíveis para "reason":
    - "processed": Se um ou mais itens novos e válidos foram encontrados.
    - "duplicate": Se a entrada é um sinônimo ou item já existente na lista.
    - "irrelevant": Se a entrada não pertence à categoria especificada.
    - "negative": Se a entrada é uma negação como 'não', 'nada', 'nenhum'.`;

  switch (type) {
    case 'allergies':
      prompt = `${persona} ${baseInstruction}
        Categoria: Alergia ALIMENTAR.
        Itens existentes: ${existingItemsString}.
        Regras:
        1. Normalização: Padronize o termo. Exemplo: "alérgico a leite" deve se tornar "Intolerância à Lactose". Corrija erros de digitação.
        2. Validação de Categoria: A entrada DEVE ser uma alergia alimentar. Se for uma alergia não alimentar (ex: "pólen", "poeira"), o motivo é "irrelevant".
        Exemplos de Tarefa:
        - Lista existente: ["Camarão"], Entrada do usuário: "sou alergico a camaroes e amendoim", Resultado esperado: {"items": ["Amendoim"], "reason": "processed"}
        - Lista existente: [], Entrada do usuário: "alergia a poeira", Resultado esperado: {"items": [], "reason": "irrelevant"}
        Entrada do usuário para analisar: "${text}"`;
      break;
    case 'healthConditions':
      prompt = `${persona} ${baseInstruction}
        Categoria: Condição de saúde, doença, comorbidade, deficiência ou alteração clínica relevante.
        Itens existentes: ${existingItemsString}.
        Regras:
        1. Normalização: Padronize para o termo médico ou mais aceito. Exemplo: "pressão alta" deve se tornar "Hipertensão", "espinha" deve se tornar "Acne". Corrija erros de digitação.
        2. Validação de Categoria: A entrada DEVE ser uma condição de saúde em sentido amplo — incluindo doenças (ex: "Diabetes"), dermatológicas (ex: "Acne"), distúrbios (ex: "Refluxo"), ou alterações clínicas conhecidas. 
           Se for um sintoma inespecífico (ex: "cansaço", "dor") ou emocional, o motivo é "irrelevant".
        Exemplos de Tarefa:
        - Lista existente: [], Entrada do usuário: "diabete", Resultado esperado: {"items": ["Diabetes"], "reason": "processed"}
C       - Lista existente: ["Diabetes"], Entrada do usuário: "tenho diabete e pressão alta", Resultado esperado: {"items": ["Hipertensão"], "reason": "processed"}
        - Lista existente: [], Entrada do usuário: "tenho acne", Resultado esperado: {"items": ["Acne"], "reason": "processed"}
        - Lista existente: [], Entrada do usuário: "cansaço", Resultado esperado: {"items": [], "reason": "irrelevant"}
        Entrada do usuário para analisar: "${text}"`;
      break;
    case 'dietaryRestrictions':
      prompt = `${persona} ${baseInstruction}
        Categoria: Restrição alimentar, estilo de vida alimentar ou alimento/grupo alimentar a ser evitado.
        Itens existentes: ${existingItemsString}.
        Regras:
        1. Normalização de Estilo de Vida: "não como nada de origem animal" deve se tornar "Vegano".
        2. Normalização de Alimento: "leite" ou "laticínios" deve se tornar "Sem Laticínios". "glúten" deve se tornar "Sem Glúten". Um alimento individual (ex: "tomate") deve ser capitalizado ("Tomate").
D       3. Validação de Categoria: A entrada DEVE ser um estilo de vida (vegano), uma restrição conhecida (sem glúten), ou um alimento/grupo alimentar a ser evitado.

        Exemplos de Tarefa:
        - Lista existente: [], Entrada do usuário: "sou vegetariana", Resultado esperado: {"items": ["Vegetariano"], "reason": "processed"}
        - Lista existente: [], Entrada do usuário: "não como tomate", Resultado esperado: {"items": ["Tomate"], "reason": "processed"}
        - Lista existente: [], Entrada do usuário: "Eu adoro batata", Resultado esperado: {"items": [], "reason": "irrelevant"}
E       Entrada do usuário para analisar: "${text}"`;
      break;
    case 'currentMedications':
      prompt = `${persona} ${baseInstruction}
        Categoria: Medicamento ou suplemento alimentar.
F       Itens existentes: ${existingItemsString}.
        Regras:
        1. Normalização: Padronize. "remedio pra dor de cabeça" deve se tornar "Analgésico".
        2. Validação de Categoria: DEVE ser um medicamento ou suplemento. Se for um alimento ou chá (ex: "chá de camomila"), o motivo é "irrelevant".
        Exemplos de Tarefa:
        - Lista existente: ["Whey Protein"], Entrada do usuário: "tomo creatina", Resultado esperado: {"items": ["Creatina"], "reason": "processed"}
G       - Lista existente: [], Entrada do usuário: "chá de camomila", Resultado esperado: {"items": [], "reason": "irrelevant"}
        Entrada do usuário para analisar: "${text}"`;
      break;
    default:
      throw new Error("Tipo de campo de saúde inválido.");
 }


  // --- O BLOCO TRY/CATCH FOI ATUALIZADO PARA USAR O NOVO SDK: @google/genai ---
  try {
    const project = process.env.GCP_PROJECT || "meal-plan-280d2";
    const location = "us-central1"; // Garante que a chamada seja feita da região correta

    // 1. Inicialização do Cliente GenAI no modo Vertex AI
    const aiClient = new GoogleGenAI({
        vertexai: true,
        project: project,
        location: location,
    });
    
    // 2. NOME DO MODELO
    const model = "gemini-2.5-flash";

    // 3. Chamada de Conteúdo CORRIGIDA (usando .models.generateContent)
    const result = await aiClient.models.generateContent({
        model: model,
        contents: prompt,
        config: {
            // Garante que a resposta venha em JSON
            responseMimeType: "application/json",
        }
    });

    // 4. Extração da resposta CORRIGIDA (usando .text)
    const jsonResponse = result.text; 

    if (!jsonResponse) {
      throw new Error("A resposta da IA (Vertex AI) veio vazia ou em formato inesperado.");
    }

    // Sua lógica de validação original foi mantida
    const aiResponse = JSON.parse(jsonResponse);

    // LOG ESSENCIAL: O log agora usa o objeto 'result' completo
    console.log("RESPOSTA BRUTA DA IA:", JSON.stringify(result, null, 2));


    if (!Array.isArray(aiResponse.items) || typeof aiResponse.reason !== 'string') {
      throw new Error("A resposta da IA não está no formato esperado.");
    }
    return aiResponse;

  } catch (error) {
    logger.error("Erro interno ao chamar ou processar a resposta da IA:", { error, text, type });
    // LOG ESSENCIAL: Imprima o objeto de erro completo
    console.error("ERRO AO CHAMAR OU PROCESSAR A IA:", error);

    throw new Error('Não foi possível analisar sua entrada no momento.');
  }
}