import * as logger from "firebase-functions/logger";
// import sgMail = require("@sendgrid/mail"); // <- REMOVA ESTA LINHA
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
// REMOVE a inicialização do twilioClient daqui também, para seguir o mesmo padrão
export let twilioClient: Twilio | undefined; // <- MANTENHA A DECLARAÇÃO, REMOVA A ATRIBUIÇÃO

/**
 * Busca todos os segredos das variáveis de ambiente.
 * A inicialização dos clientes de API foi removida daqui.
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

    // --- REMOVA TODO O BLOCO DE INICIALIZAÇÃO DAQUI ---
    /* if (newSecrets.sendgridKey) {
      // sgMail.setApiKey(newSecrets.sendgridKey); // <- REMOVIDO
      // logger.info("Chave do SendGrid configurada com sucesso."); // <- REMOVIDO
    } else {
      logger.warn("Chave do SendGrid não encontrada nas variáveis de ambiente."); // <- REMOVIDO (O aviso já acontece no deploy)
    }

    if (newSecrets.twilioSid && newSecrets.twilioToken && !twilioClient) {
      // logger.info("Inicializando cliente Twilio..."); // <- REMOVIDO
      // twilioClient = new Twilio(newSecrets.twilioSid, newSecrets.twilioToken); // <- REMOVIDO
    }
    */
    // --- FIM DA REMOÇÃO ---
    
    // Salva no cache global
    apiSecrets = newSecrets;
    logger.info("Segredos carregados e cacheados com sucesso (sem inicialização de clientes).");
    return apiSecrets;

  } catch (error) {
    logger.error("Falha CRÍTICA ao ler segredos das variáveis de ambiente:", error);
    return {}; 
  }
}