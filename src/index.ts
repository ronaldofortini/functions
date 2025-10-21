require('module-alias/register');

import * as admin from "firebase-admin";

admin.initializeApp();

// EXPORTA AS FUNÇOES DE AUTENTICACAO
export * from "./auth/auth";

// EXPORTA A FUNÇÃO DE PERFIL
export * from "./profile/profile";

// EXPORTA A FUNÇÃO DO PICKER
export * from "./picker/picker"; 

// EXPORTA A FUNÇÃO DO SUPPORT
export * from "./support/support";

// EXPORTA AS FUNCOES DA DIETA
export * from "./diet/diet";

// EXPORTA AS FUNCOES UTILS
export * from "./core/utils";

// EXPORTA AS FUNCOES DE PAGAMENTO
export * from "./payments/payments";     

// EXPORTA AS FUNCOES DE NOTIFICACOES
export * from "./notifications/notifications"; 

// FUNCOES QUE EXECUTAM AUTOMATICAMENTE
export * from "./jobs/scheduled";

