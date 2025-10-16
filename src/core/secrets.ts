import * as logger from "firebase-functions/logger";
import sgMail = require("@sendgrid/mail");
import { Twilio } from "twilio";

// A interface permanece a mesma
export interface ApiSecrets {
  sendgridKey?: string;
  geminiApiKey?: string;
  openAiApiKey?: string;
  twilioSid?: string;
  twilioToken?: string;
  twilioPhoneNumber?: string;
  efiChaveClientIdHom?: string;
  efiChaveSecretHom?: string;
  efiChaveClientId?: string;
  efiChaveClientSecret?: string;
  efiSandbox?: string;
  uberClientId?: string;
  uberClientSecret?: string;
  geocodingApiKey?: string;
}

// O cache continua sendo essencial
let apiSecrets: ApiSecrets | undefined;
export let twilioClient: Twilio | undefined;

/**
 * Busca todos os segredos das variáveis de ambiente e inicializa os clientes de API.
 */
export async function getSecrets(): Promise<ApiSecrets> {
  
  if (apiSecrets) {
    return apiSecrets;
  }

  try {
    logger.info("Lendo segredos das variáveis de ambiente (process.env)...");
    
    // Mapeia as variáveis de ambiente para a interface ApiSecrets
    const newSecrets: ApiSecrets = {
      sendgridKey: process.env.SENDGRID_KEY,
      geminiApiKey: process.env.GEMINI_API_KEY,
      openAiApiKey: process.env.OPENAI_API_KEY,
      twilioSid: process.env.TWILIO_SID,
      twilioToken: process.env.TWILIO_TOKEN,
      twilioPhoneNumber: process.env.TWILIO_PHONE,
      efiChaveClientIdHom: process.env.EFI_CLIENT_ID_HOM,
      efiChaveSecretHom: process.env.EFI_CLIENT_SECRET_HOM,
      efiChaveClientId: process.env.EFI_CLIENT_ID,
      efiChaveClientSecret: process.env.EFI_CLIENT_SECRET,
      efiSandbox: process.env.EFI_SANDBOX,
      uberClientId: process.env.UBER_CLIENT_ID,
      uberClientSecret: process.env.UBER_CLIENT_SECRET,
      geocodingApiKey: process.env.GEOCODING_API_KEY
    };

    // A lógica de inicialização dos clientes permanece a mesma
    if (newSecrets.sendgridKey) {
      sgMail.setApiKey(newSecrets.sendgridKey);
      logger.info("Chave do SendGrid configurada com sucesso.");
    } else {
      logger.warn("Chave do SendGrid não encontrada nas variáveis de ambiente.");
    }

    if (newSecrets.twilioSid && newSecrets.twilioToken && !twilioClient) {
      logger.info("Inicializando cliente Twilio...");
      twilioClient = new Twilio(newSecrets.twilioSid, newSecrets.twilioToken);
    }
    
    // Salva no cache global
    apiSecrets = newSecrets;
    logger.info("Segredos e clientes carregados e cacheados com sucesso.");
    return apiSecrets;

  } catch (error) {
    logger.error("Falha CRÍTICA ao ler segredos das variáveis de ambiente:", error);
    return {}; 
  }
}