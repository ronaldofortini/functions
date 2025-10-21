import { https, logger } from "firebase-functions";
import { getAvailableFoodNames } from "./diet-logic";
import { InterpretedPrompt } from "@models/models";
import { callAI } from "../core/utils"

export async function interpretUserPrompt(
  prompt: string,
  aiProvider: 'GEMINI' | 'OPENAI'
): Promise<InterpretedPrompt> {

  const availableFoodNames = await getAvailableFoodNames();
  logger.info(`[interpretUserPrompt] Total de alimentos disponíveis no índice: ${availableFoodNames.length}`);

  const availableGoals = [
    'muscle_gain', 'fat_loss', 'skin_health', 'energy_boost', 'gut_health',
    'hair_and_nails', 'cognitive_function', 'reduce_bloating', 'physical_performance'
  ];

  // MUDANÇA 1: Criamos uma AMOSTRA da lista de alimentos, não a lista completa.
  // Isso dá contexto à IA sem sobrecarregá-la.
  const foodNameSample = availableFoodNames.length > 70
    ? availableFoodNames.slice(0, 70).join(', ') + '...' // Pega os primeiros 70 como exemplo
    : availableFoodNames.join(', ');

const systemPrompt = `
    Você é um app de nutrição avançada especialista. Sua tarefa é analisar o prompt de um usuário e traduzi-lo para uma estrutura JSON.

    **Contexto:**
    - Objetivos disponíveis no sistema: ${availableGoals.join(', ')}
    - Nosso banco de dados contém centenas de alimentos comuns (frutas, carnes, vegetais, grãos, laticínios, etc.).
    - Amostra de alimentos disponíveis para sua referência: ${foodNameSample}
    - Nós selecionamos os alimentos para o usuário, compramos e entregamos.
  
    **Sua Tarefa:**
    Analise o prompt do usuário e preencha o seguinte formato JSON:
    {
      "interpretationStatus": "SUCCESS" ou "FAILURE",
      "applicableGoalKeys": ["uma ou mais chaves da lista de objetivos disponíveis"],
      "prioritizedNutrients": ["lista de nutrientes chave em inglês (ex: 'proteins', 'fiber')"],
      "foodsToInclude": ["lista de 3-5 alimentos específicos e comuns (em português)"],
      "foodsToAvoid": ["lista de alimentos que o usuário quer evitar"],
      "explanation": "uma explicação curta (1 frase) sobre o pedido do usuário.",
      "isBudgetFriendly": true ou false
    }

    **Regras Estritas:**
    1. O campo "interpretationStatus" é OBRIGATÓRIO.
    2. Se entender o prompt, defina "interpretationStatus" como "SUCCESS".
    3. Se o prompt for ambíguo, inválido, etc., defina "interpretationStatus" como "FAILURE".
    4. Para "foodsToInclude", sugira de 3 a 5 alimentos específicos e comuns (em português) que se alinhem com o pedido do usuário e que provavelmente existiriam em um supermercado.
    5. Se o usuário mencionar termos como 'barato', 'econômico', 'em conta', 'acessível', 'não muito caro', ou 'custo-benefício', defina "isBudgetFriendly" como true. Caso contrário, defina como false.
    6. Retorne apenas o objeto JSON.

    ---
    PROMPT DO USUÁRIO: "${prompt}"
  `;
  
  // O resto da função de try/catch permanece igual, pois já é robusto.
  try {
    const jsonResponse = await callAI(systemPrompt, aiProvider, true);
    logger.info('Resposta Bruta da IA:', jsonResponse);
    
    const parsedResponse = JSON.parse(jsonResponse) as InterpretedPrompt & { interpretationStatus: 'SUCCESS' | 'FAILURE' };

    if (!parsedResponse || !parsedResponse.interpretationStatus) {
        throw new Error("Resposta da IA com estrutura inválida.");
    }
    
    if (parsedResponse.interpretationStatus === 'FAILURE') {
        throw new https.HttpsError(
            "failed-precondition",
             parsedResponse.explanation || "Por favor, tente novamente com outras palavras ou seja mais específico sobre seus objetivos."
        );
    }

    parsedResponse.originalPrompt = prompt;
    return parsedResponse;

  } catch (error: any) {
    logger.error("Erro final ao interpretar o prompt do usuário:", { prompt, error: error.message });
    if (error instanceof https.HttpsError) throw error;
    throw new https.HttpsError("internal", "Ocorreu um problema ao tentar entender o seu pedido.");
  }
}