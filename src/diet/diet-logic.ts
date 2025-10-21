// import * as functions from "firebase-functions";
import { HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Food, NutritionalInfo, FoodItem, HealthProfile, InterpretedPrompt } from "../models/models";
import { createEmptyNutritionalInfo } from "../core/utils";
// import { GoogleGenerativeAI } from "@google/generative-ai"; // ALTERADO
import { logger } from "firebase-functions";
// import { getSecrets } from "../core/secrets";

import { callAI } from "../core/utils"

const db = admin.firestore();

let foodCache: { foods: Food[], timestamp: number } | null = null; 
const CACHE_DURATION_MS = 10 * 60 * 1000; // Cache de 10 minutos

// export async function getAvailableFoodNames(): Promise<string[]> {
//     const allFoods = await fetchAllFoods();
//     return allFoods.map(f => f.standard_name);
// }

export async function getAvailableFoodNames(): Promise<string[]> {
  try {
    // LÊ APENAS UM ÚNICO DOCUMENTO - EXTREMAMENTE RÁPIDO
    const indexDoc = await db.collection('system_config').doc('food_index').get();
    if (!indexDoc.exists) {
      logger.error("Documento de índice de alimentos 'food_index' não encontrado!");
      return [];
    }
    // Retorna o array de nomes que está dentro do documento
    return indexDoc.data()?.allNames || [];
  } catch (error) {
    logger.error("Erro ao buscar o índice de alimentos:", error);
    return [];
  }
}

export async function fetchAllFoods(): Promise<Food[]> {
  const now = Date.now();
  if (foodCache && (now - foodCache.timestamp < CACHE_DURATION_MS)) {
    return foodCache.foods;
  }

  try {
    // LÊ APENAS UM ÚNICO DOCUMENTO - EXTREMAMENTE RÁPIDO
    const indexDoc = await admin.firestore().collection('system_config').doc('food_index').get();
    if (!indexDoc.exists) {
      logger.error("Documento de índice de alimentos 'food_index' não encontrado!");
      return [];
    }
    
    // Supondo que o seu documento 'food_index' armazena os objetos de comida completos.
    // Se ele armazena apenas nomes, a lógica aqui precisaria ser ajustada.
    const foods = indexDoc.data()?.allFoods || []; 
    foodCache = { foods, timestamp: now };
    return foods;
  } catch (error) {
    logger.error("Erro ao buscar o índice de alimentos:", error);
    return [];
  }
}

/**
 * USA IA para analisar as restrições do usuário e retornar uma lista de nomes de alimentos permitidos.
 */
export async function filterFoodListWithAI(
  allFoods: Food[],
  healthProfile: HealthProfile,
  aiProvider: 'GEMINI' | 'OPENAI'
): Promise<string[]> {
  
    const allExclusionsText = [
        ...(healthProfile.allergies || []),
        ...(healthProfile.dietaryRestrictions || [])
    ].join(', ');

    // Se não há restrições, todos os alimentos são permitidos.
    if (!allExclusionsText.trim()) {
        return allFoods.map(food => food.standard_name);
    }

    const allFoodNames = allFoods.map(food => food.standard_name);

    const prompt = `
        Você é um nutricionista especialista em segurança alimentar. Sua tarefa é filtrar uma lista de alimentos.
        
        **Contexto:**
        - Alergias e Restrições do Usuário: "${allExclusionsText}"
        - Lista Mestra de Alimentos Disponíveis: [${allFoodNames.join(', ')}]

        **Tarefa:**
        Com base nas restrições do usuário, analise a "Lista Mestra de Alimentos" e retorne um array JSON contendo APENAS os nomes dos alimentos que o usuário PODE consumir.
        Seja extremamente rigoroso. Por exemplo, se a restrição for "intolerância à lactose", remova todos os laticínios. Se for "carne vermelha", remova todos os cortes bovinos.

        **Formato da Resposta (Regra Estrita):**
        Retorne APENAS um array JSON de strings com os nomes dos alimentos permitidos. Exemplo: ["Maçã Fuji", "Peito de Frango", "Arroz Branco"]
    `;

    try {
        const jsonResponse = await callAI(prompt, aiProvider, true);
        const allowedFoodNames = JSON.parse(jsonResponse);

        if (!Array.isArray(allowedFoodNames)) {
            throw new Error("A IA não retornou um array de alimentos válidos.");
        }
        
        logger.info(`[FILTRO IA] A IA permitiu ${allowedFoodNames.length} de ${allFoodNames.length} alimentos.`);
        return allowedFoodNames;

    } catch (error) {
        logger.error("[FILTRO IA] Falha crítica ao filtrar alimentos com IA:", error);
        throw new HttpsError("internal", "Tivemos um problema ao filtrar os alimentos com base no seu perfil.");
    }
}

export async function selectAndQuantifyFoods(
  allowedFoods: Food[],
  dailyNutritionalValuesTarget: NutritionalInfo,
  interpretedPrompt: InterpretedPrompt,
  jobDocRef: admin.firestore.DocumentReference
): Promise<FoodItem[]> {
  
  const dietTemplate = {
      animal_protein: 4, legume: 3, cereal: 3, vegetable: 10,
      fruit: 6, nut: 2, fat: 1, dairy: 2
  };

  const sortFunction = createDynamicSortFunction(interpretedPrompt);

  await jobDocRef.update({
    progressLog: admin.firestore.FieldValue.arrayUnion('Selecionando alimentos base dinamicamente...')
  });
  
  const selectedFoods = deterministicFoodSelector(allowedFoods, dietTemplate, sortFunction);

  if (interpretedPrompt.foodsToInclude && interpretedPrompt.foodsToInclude.length > 0) {
      await jobDocRef.update({
          progressLog: admin.firestore.FieldValue.arrayUnion(`Priorizando alimentos como: ${interpretedPrompt.foodsToInclude.join(', ')}.`)
      });
  }
  
  if (selectedFoods.length < 15) {
      throw new HttpsError("internal", "Seleção determinística falhou em encontrar alimentos suficientes.");
  }

  await jobDocRef.update({
    progressLog: admin.firestore.FieldValue.arrayUnion(`${selectedFoods.length} alimentos base selecionados.`, 'Otimizando quantidades...')
  });
  
  const quantifiedDiet = distributeQuantitiesProportionally(selectedFoods, dailyNutritionalValuesTarget, sortFunction);

  if (quantifiedDiet.length === 0) {
    throw new HttpsError("failed-precondition", "Não foi possível calcular as quantidades para atingir suas metas. Isso pode acontecer se as metas forem muito restritivas. Tente novamente com um objetivo diferente.");
  }
  
  return quantifiedDiet;
}

export async function generateDietExplanationAI(
  quantifiedDiet: FoodItem[],
  actualDailyValues: NutritionalInfo,
  interpretedPrompt: InterpretedPrompt, // NOVO ARGUMENTO
  aiProvider: 'GEMINI' | 'OPENAI'
): Promise<string> {

    // 1. Preparação dos dados para o Prompt
    const dietItems = quantifiedDiet ?? []; 

    const topFoods = dietItems
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 15)
      .map(item => item.food.standard_name);

    const formattedEnergy = Math.round(actualDailyValues.energy).toLocaleString('pt-BR');
    const formattedProteins = Math.round(actualDailyValues.proteins).toLocaleString('pt-BR');

    const goalMap: Record<string, string> = {
        'muscle_gain': 'ganho de massa muscular',
        'fat_loss': 'perda de gordura',
        'skin_health': 'saúde da pele',
        'energy_boost': 'aumento de energia',
        'gut_health': 'saúde intestinal',
        'hair_and_nails': 'saúde de cabelo e unhas',
        'cognitive_function': 'função cognitiva',
        'reduce_bloating': 'redução de inchaço',
        'physical_performance': 'melhora da performance física',
    };
    
    const goalsFriendly = (interpretedPrompt.applicableGoalKeys ?? [])
        .map(key => goalMap[key] || key.replace(/_/g, ' '))
        .join(', ');

    const nutrientsFriendly = (interpretedPrompt.prioritizedNutrients ?? []).join(', ');
    const foodsToInclude = (interpretedPrompt.foodsToInclude ?? []).join(', ');
    const foodsToAvoid = (interpretedPrompt.foodsToAvoid ?? []).join(', ');

    // 2. Montagem do Prompt de IA Aprimorado
    const fullPrompt = `
        Você é um nutricionista de IA. Sua tarefa é criar uma explicação curta, amigável e profissional para a dieta gerada (nao comece com Olá! ou com comprimentos.. Vamos direto aos principais pontos...).

        **Dados do Plano de Dieta:**
        - **Objetivo principal do usuário:** "${interpretedPrompt.originalPrompt}"
        - **Objetivos identificados:** ${goalsFriendly || 'N/A'}
        - **Nutrientes chave priorizados:** ${nutrientsFriendly || 'N/A'}
        - **Alimentos que o usuário pediu para INCLUIR:** ${foodsToInclude || 'N/A'}
        - **Alimentos que o usuário pediu para EVITAR:** ${foodsToAvoid || 'N/A'}
        - **Valores Nutricionais da Dieta (aprox. diários):** ${formattedEnergy} kcal e ${formattedProteins}g de proteína.
        - **Alimentos principais na dieta (para citação):** ${topFoods.join(', ')}.

        **Sua Tarefa (Regras Estritas):**
        1. Escreva um parágrafo de 3 a 4 frases, unindo o objetivo do usuário (citar o que ele buscou), os nutrientes priorizados e como a dieta, com seus alimentos, atinge esse foco.
        2. Você DEVE OBRIGATORIAMENTE citar 2 ou 3 alimentos como exemplos.
        3. Os alimentos citados DEVEM ser escolhidos EXCLUSIVAMENTE da lista de "Alimentos principais na dieta" (TOP 15).
        4. Evite citar os valores de kcal ou proteína. Concentre-se nos benefícios.
        5. Não use nenhuma formatação de ênfase como Markdown (sem asteriscos **). O texto deve ser puro e sem formatação.

        Escreva a explicação diretamente para o usuário, mantendo um tom encorajador e profissional.
    `;

    try {
        const rawResponse = await callAI(fullPrompt, aiProvider, false);

        try {
            // Tenta fazer o parse, caso a IA retorne um JSON inesperadamente
            const parsedJson = JSON.parse(rawResponse);
            return parsedJson.explanation || rawResponse;
        } catch (e) {
            // Se falhar no parse, significa que já é um texto puro, que é o que queríamos.
            return rawResponse;
        }

    } catch (error) {
        // Loga o erro de falha na IA e retorna a mensagem de fallback.
        console.error("Falha ao gerar explicação da dieta com IA:", error);
        return "Sua dieta foi cuidadosamente planejada para atender às suas necessidades e objetivos. Selecionamos alimentos frescos e nutritivos que se alinham com seu perfil de saúde para garantir os melhores resultados.";
    }
}


export async function _generateFoodExplanationsInOneShot(
    quantifiedDiet: FoodItem[],
    dietGoal: string,
    aiProvider: 'GEMINI' | 'OPENAI'
): Promise<FoodItem[]> {
    logger.log(`Iniciando geração de explicações em lote para ${quantifiedDiet.length} itens.`);

    // 1. Prepara a lista de alimentos em um formato estruturado (JSON) para a IA.
    // Usamos o 'id' do alimento como uma chave única para mapear as respostas de volta.
    const foodListForAI = quantifiedDiet.map(item => ({
        id: item.food.id,
        name: item.food.standard_name,
        category: item.food.category
    }));

    // 2. Cria um prompt único e poderoso que instrui a IA a retornar um JSON estruturado.
    const prompt = `
    Você é um assistente nutricional focado em criar descrições de marketing únicas e eficientes.

    **Tarefa Principal:**
    Para CADA alimento na lista JSON abaixo, gere uma explicação curta e amigável sobre seu papel na dieta.

    **Objetivo Geral da Dieta:** "${dietGoal}"

    **Lista de Alimentos para Analisar:**
    ${JSON.stringify(foodListForAI, null, 2)}

    **Regras Estritas de Geração e Formato:**
    1.  Para cada alimento, a explicação deve ter UMA frase curta (máximo 20 palavras).
    2.  NÃO cite o nome do alimento na sua explicação.
    3.  As explicações devem ser variadas e não repetitivas entre si.
    4.  Sua resposta DEVE SER um único objeto JSON.
    5.  As chaves do objeto JSON devem ser os "id" dos alimentos da lista de entrada.
    6.  Os valores devem ser as strings de explicação geradas.

    **Exemplo do Formato de Resposta OBRIGATÓRIO:**
    {
      "arroz_branco": "Fornece energia de rápida absorção para seus treinos e dia a dia.",
      "frango_peito_sem_pele": "Fonte de proteína magra essencial para a construção e reparo muscular.",
      "brocolis": "Rico em fibras e vitaminas que auxiliam na sua saúde digestiva e imunidade."
    }
    `;

    try {
        // 3. Faz uma ÚNICA chamada para a IA.
        const jsonResponse = await callAI(prompt, aiProvider, true);
        const explanationsMap = JSON.parse(jsonResponse) as { [foodId: string]: string };

        // 4. Mapeia as respostas de volta para a lista de dieta original.
        const dietWithExplanations = quantifiedDiet.map(item => {
            const explanation = explanationsMap[item.food.id];
            return {
                ...item,
                // Se uma explicação existir no mapa, usa, senão, usa um fallback.
                explanationInDiet: explanation || `Este item contribui para uma nutrição completa e balanceada.`
            };
        });

        logger.log("Geração de explicações em lote concluída com sucesso.");
        return dietWithExplanations;

    } catch (error) {
        logger.error(`Falha crítica ao gerar explicações em lote:`, error);
        // Em caso de erro, retorna a dieta original com um fallback genérico para todos.
        return quantifiedDiet.map(item => ({
            ...item,
            explanationInDiet: `Este item foi incluído para garantir uma nutrição completa e balanceada.`
        }));
    }
}

/**
 * Gera uma explicação curta e amigável para um único alimento,
 * considerando o objetivo geral da dieta.
 *
 * @param food O objeto Food do alimento para o qual gerar a explicação.
 * @param dietGoal O objetivo principal da dieta (ex: "Perda de peso", "Ganho de massa muscular").
 * @param aiProvider O provedor de IA a ser usado ('GEMINI' ou 'OPENAI').
 * @returns Uma string com a explicação gerada ou um texto genérico em caso de falha.
 */
export async function generateExplanationForSingleFood(
    food: Food,
    dietGoal: string,
    aiProvider: 'GEMINI' | 'OPENAI'
): Promise<string> {
    logger.log(`Iniciando geração de explicação para o item: ${food.standard_name}`);

    // 1. Cria um prompt simples e direto para a tarefa.
    const prompt = `
    Você é um assistente nutricional focado em criar descrições de marketing eficientes.

    **Tarefa Principal:**
    Gere UMA explicação curta e amigável sobre o papel do alimento abaixo na dieta.

    **Objetivo Geral da Dieta:** "${dietGoal}"

    **Alimento para Analisar:**
    - Nome: "${food.standard_name}"
    - Categoria: "${food.category}"

    **Regras Estritas de Geração:**
    1.  A explicação deve ter UMA frase curta (máximo 20 palavras).
    2.  NÃO cite o nome do alimento na sua explicação.
    3.  Sua resposta deve ser APENAS a frase da explicação, sem aspas ou qualquer outro texto.

    **Exemplo de Resposta OBRIGATÓRIA:**
    Fornece energia de rápida absorção para seus treinos e dia a dia.
    `;

    try {
        // 2. Faz a chamada para a IA, esperando uma string de texto simples como resposta.
        const explanation = await callAI(prompt, aiProvider, false); // O 'false' indica que não esperamos um JSON.

        if (!explanation || explanation.trim() === '') {
            throw new Error("A IA retornou uma explicação vazia.");
        }

        logger.log(`Explicação gerada para "${food.standard_name}": ${explanation}`);
        return explanation.trim();

    } catch (error) {
        logger.error(`Falha ao gerar explicação para o alimento "${food.standard_name}":`, error);
        // Em caso de erro, retorna um fallback genérico.
        return `Este item contribui para uma nutrição completa e balanceada.`;
    }
}

/**
 * Gera uma explicação sobre a importância de cada alimento na dieta.
 * O processamento é sequencial para evitar que a IA gere textos repetitivos,
 * usando um histórico de explicações geradas na mesma chamada.
 */
// export async function _generateFoodExplanations(
//     quantifiedDiet: FoodItem[],
//     dietGoal: string,
//     aiProvider: 'GEMINI' | 'OPENAI'
// ): Promise<FoodItem[]> {
//     logger.log(`Iniciando geração sequencial de explicação por alimento para ${quantifiedDiet.length} itens.`);

//     // 1. Array para armazenar o histórico de explicações geradas NESTA chamada.
//     const pastExplanations: string[] = [];

//     // 2. Itera sequencialmente (usando for...of)
//     for (const item of quantifiedDiet) {
//         const foodName = item.food.standard_name;
//         const category = item.food.category;
        
//         // Constrói a lista de textos a serem evitados para o prompt.
//         const avoidanceText = pastExplanations.length > 0
//             ? `Evite repetir ou usar termos muito similares a estas explicações já geradas: [${pastExplanations.join('; ')}].`
//             : '';

//         // Prompt de IA focado, enxuto e com a instrução de exclusão
//         const prompt = `
//         Você é um assistente nutricional focado em criar descrições únicas.
        
//         **Instruções de Estilo:**
//         1. Explique em UMA frase curta e amigável, no máximo 20 palavras, em português.
//         2. NÃO cite o nome do alimento ("${foodName}") na explicação.
//         3. ${avoidanceText}

//         **Tarefa:**
//         Descreva o papel do alimento "${foodName}" (que é da categoria "${category}") para o objetivo geral da dieta: "${dietGoal}".

//         **Exemplo de formato (NÃO inclua o nome do alimento):**
//         é rico em Ômega-3, essencial para o seu objetivo de saúde cardiovascular.
//         `;

//         try {
//             const explanation = await callAI(prompt, aiProvider, false);
//             const finalExplanation = explanation.trim().replace(/^"|"$/g, '');
            
//             // 3. Salva a explicação no item e no histórico (se for nova)
//             item.explanationInDiet = finalExplanation;
//             pastExplanations.push(finalExplanation);
            
//         } catch (error) {
//             logger.error(`Falha ao gerar explicação para ${foodName}:`, error);
//             item.explanationInDiet = `Este item foi incluído para garantir uma nutrição completa e balanceada.`; // Fallback seguro
//         }
//     }

//     logger.log("Geração de explicações por alimento concluída.");
//     return quantifiedDiet;
// }


function createDynamicSortFunction(interpretedPrompt: InterpretedPrompt): (food: Food) => number {
  const { prioritizedNutrients, foodsToInclude, isBudgetFriendly } = interpretedPrompt; // ✅ Adicione isBudgetFriendly
  const lowerFoodsToInclude = foodsToInclude.map(f => f.toLowerCase());

  // ✅ Listas de alimentos para ajuste de custo
  const lowCostFoodIds = new Set(['ovo_branco', 'peito_de_frango', 'batata_doce', 'batata_inglesa', 'arroz_branco', 'feijao_carioca', 'banana_prata', 'repolho']);
  const highCostFoodIds = new Set(['salmao', 'file_mignon', 'camarao', 'queijo_brie', 'amendoas', 'nozes', 'castanha_do_para', 'aspargos', 'blueberry']);

  return (food: Food): number => {
    let score = 0;
    const foodNames = [food.standard_name.toLowerCase(), ...(food.synonyms || []).map(s => s.toLowerCase())];
    
    if (lowerFoodsToInclude.some(f => foodNames.some(name => name.includes(f)))) {
      score += 100;
    }

    const info = food.nutritional_info_per_100g;
    for (const nutrient of prioritizedNutrients) {
      if (info[nutrient as keyof NutritionalInfo]) {
        score += getPurityScore(food, nutrient as keyof NutritionalInfo) * 20;
      }
    }

    // ✅ NOVA LÓGICA DE CUSTO-BENEFÍCIO
    if (isBudgetFriendly) {
      if (highCostFoodIds.has(food.id)) {
        score -= 50; // Penaliza alimentos caros
      }
      if (lowCostFoodIds.has(food.id)) {
        score += 50; // Recompensa alimentos baratos
      }
    }

    score += Math.random();
    return score;
  };
}

function deterministicFoodSelector(
    allowedFoods: Food[], template: { [key: string]: number }, sortFunction: (food: Food) => number
): Food[] {
    const selectedFoods: Food[] = [];
    const usedIds = new Set<string>();
    const usedBaseFoodNames = new Set<string>();
    const categories = Object.keys(template) as (keyof typeof template)[];

    for (const category of categories) {
        const count = template[category];
        let foodPool = allowedFoods.filter(f => f.category === category && !usedIds.has(f.id));
        
        if (category === 'cereal') {
            const rootVegetables = allowedFoods.filter(f => 
                ['batata_doce', 'batata_inglesa', 'mandioca', 'inhame'].includes(f.id) && !usedIds.has(f.id)
            );
            foodPool.push(...rootVegetables);
        }

        foodPool.sort((a, b) => sortFunction(b) - sortFunction(a));
        
        let addedCount = 0;

        for (const food of foodPool) {
            if (addedCount >= count) break;
            const baseName = getBaseFoodName(food.standard_name);
            if (!usedBaseFoodNames.has(baseName)) {
                selectedFoods.push(food);
                usedIds.add(food.id);
                usedBaseFoodNames.add(baseName);
                addedCount++;
            }
        }

        if (addedCount < count) {
            for (const food of foodPool) {
                if (addedCount >= count) break;
                if (!usedIds.has(food.id)) {
                    selectedFoods.push(food);
                    usedIds.add(food.id);
                    addedCount++;
                }
            }
        }
    }
    return selectedFoods;
}


function distributeQuantitiesProportionally(
  selectedFoods: Food[],
  dailyTargets: NutritionalInfo,
  sortFunction: (food: Food) => number
): FoodItem[] {
  const weeklyEnergyTarget = dailyTargets.energy * 7;

  const fixedQuantityFoods: Food[] = [];
  const variableWeightFoods: Food[] = [];

  for (const food of selectedFoods) {
    if (food.variableWeight === false) {
      fixedQuantityFoods.push(food);
    } else {
      variableWeightFoods.push(food);
    }
  }

  // 1. Processa os itens de quantidade fixa (pacotes, unidades)
  const quantifiedFixedItems: FoodItem[] = fixedQuantityFoods.map(food => ({
    food,
    quantity: food.quantity,
    isSubstituted: false,
    orderItemId: ''
  }));

  // ✨ --- NOVA LÓGICA PARA ITENS PESÁVEIS --- ✨

  // 2. Para os itens de peso variável, atribui uma "quantidade base razoável"
  const quantifiedVariableItems: FoodItem[] = variableWeightFoods.map(food => {
    let baseQuantity = 0;
    // Usa 60% do máximo semanal como uma base segura e razoável
    if (food.max_weekly_g_per_person) {
      baseQuantity = food.max_weekly_g_per_person * 0.6;
    } else {
      // Fallback se 'max_weekly_g_per_person' não estiver definido
      switch (food.category) {
        case 'animal_protein': baseQuantity = 600; break;
        case 'vegetable': baseQuantity = 300; break;
        case 'fruit': baseQuantity = 400; break;
        default: baseQuantity = 150;
      }
    }
    return {
      food,
      quantity: baseQuantity,
      isSubstituted: false,
      orderItemId: ''
    };
  });
  
  // 3. Monta a dieta base completa
  let diet: FoodItem[] = [...quantifiedFixedItems, ...quantifiedVariableItems];

  // 4. A lógica de limite máximo e redistribuição de excesso continua importante
  let excessEnergy = 0;
  for (const item of diet) {
      const maxGrams = item.food.max_weekly_g_per_person;
      if (maxGrams && item.quantity > maxGrams) {
          const excessQuantity = item.quantity - maxGrams;
          const energyPerGram = item.food.nutritional_info_per_100g.energy / 100;
          excessEnergy += excessQuantity * energyPerGram;
          item.quantity = maxGrams;
      }
  }
  // (A lógica de redistribuição de excesso foi mantida como estava, pois é um bom ajuste)
  if (excessEnergy > 0) {
      const redistributableItems = diet.filter(item => 
        (item.food.variableWeight === true) &&
        (!item.food.max_weekly_g_per_person || item.quantity < item.food.max_weekly_g_per_person)
      );
      if (redistributableItems.length > 0) {
          const energyPerItem = excessEnergy / redistributableItems.length;
          for (const item of redistributableItems) {
              const energyPerGram = item.food.nutritional_info_per_100g.energy / 100;
              if (energyPerGram > 0) {
                  item.quantity += (energyPerItem / energyPerGram);
                  const maxGrams = item.food.max_weekly_g_per_person;
                  if (maxGrams && item.quantity > maxGrams) {
                      item.quantity = maxGrams;
                  }
              }
          }
      }
  }

  // 5. Agora, fazemos o AJUSTE FINO para atingir a meta de calorias
  const currentTotalEnergy = calculateTotalNutrients(diet).energy;
  const energyDifference = weeklyEnergyTarget - currentTotalEnergy;

  const oilItem = diet.find(item => item.food.id === 'azeite_extra_virgem') || diet.find(item => item.food.category === 'fat');
  if (oilItem && oilItem.food.nutritional_info_per_100g.energy > 0) {
    const energyPerGramOil = oilItem.food.nutritional_info_per_100g.energy / 100;
    if (energyPerGramOil > 0) {
      const gramsToAdd = energyDifference / energyPerGramOil;
      oilItem.quantity = Math.max(0, oilItem.quantity + gramsToAdd);
    }
  }

  // 6. A lógica de arredondamento final continua a mesma
  return diet.map(item => {
    if (isNaN(item.quantity)) item.quantity = 0;

    if (item.food.variableWeight === true) {
        item.quantity = Math.round(item.quantity / 5) * 5;
    } 
    else if (item.food.variableWeight === false && item.food.quantity > 0) {
        item.quantity = Math.round(item.quantity / item.food.quantity) * item.food.quantity;
    }
    
    return item;
  }).filter(item => item.quantity > 0);
}



function calculateTotalNutrients(selection: FoodItem[]): NutritionalInfo {
    const totals = createEmptyNutritionalInfo();
    for (const item of selection) {
        if (!item?.food?.nutritional_info_per_100g || !item.quantity) continue;
        const factor = item.quantity / 100;
        for (const key in totals) {
            const nutrientKey = key as keyof NutritionalInfo;
            const foodNutrient = item.food.nutritional_info_per_100g[nutrientKey] || 0;
            (totals[nutrientKey] as number) += foodNutrient * factor;
        }
    }
    return totals;
}

function getPurityScore(food: Food, nutrient: keyof NutritionalInfo): number {
    const nutrients = food.nutritional_info_per_100g;
    const caloriesPerGram: { [key: string]: number } = { proteins: 4, carbohydrates: 4, total_fat: 9, fiber: 2 };
    const totalEnergy = nutrients.energy;
    if (!totalEnergy || totalEnergy === 0) return 0;
    const nutrientValue = nutrients[nutrient] || 0;
    if (nutrient === 'fiber') return nutrientValue;
    const nutrientEnergy = nutrientValue * (caloriesPerGram[nutrient] || 0);
    return nutrientEnergy / totalEnergy;
}

function getBaseFoodName(standardName: string): string {
    const name = standardName.toLowerCase();
    if (name.includes('feijão')) return 'feijão'; if (name.includes('arroz')) return 'arroz';
    if (name.includes('pimentão')) return 'pimentão'; if (name.includes('batata')) return 'batata';
    if (name.includes('ovo')) return 'ovo'; if (name.includes('leite')) return 'leite';
    if (name.includes('queijo')) return 'queijo'; if (name.includes('pão')) return 'pão';
    return name.split(' ')[0];
}

