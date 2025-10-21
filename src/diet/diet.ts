import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { v4 as uuidv4 } from 'uuid';
import Holidays from "date-holidays";
import { callAI, formatActivityLevel } from "../core/utils"
// Imports da Lógica de Negócio
import { interpretUserPrompt } from "./prompt-interpreter";
import { calculateNutritionalTargets } from "./nutrition-calculator";
import { fetchAllFoods, filterFoodListWithAI, selectAndQuantifyFoods, generateDietExplanationAI, _generateFoodExplanationsInOneShot } from "./diet-logic";
import { calculateAge, formatFirstName, sendEmail } from "../core/utils";
// Imports de Modelos e Funções Utilitárias
import { Diet, FoodItem, Address, UserProfile, HealthProfile, JobDiet, InterpretedPrompt, dietGoalDictionaryPT } from "@models/models";
import { getRecalculatedDietEmailHTML } from './../core/email-templates'
import { calculateDietMetrics, generateSequentialDietId, sanitizeNaNValues, _getRidePriceEstimateLogic, _generatePixChargeLogic, _initiatePixRefundLogic, getEfiAuthToken, getEfiCertificates, httpsRequest } from "../core/utils";
const db = admin.firestore();


/**
 * Função leve de pré-validação chamada pelo frontend ANTES de criar o job.
 */
export const validateDietRequest = onCall({ region: "southamerica-east1" }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Autenticação requerida.");

    const uid = request.auth.uid;
    const { address } = request.data as { address: Address };
    if (!address) throw new HttpsError("invalid-argument", "O endereço é obrigatório.");

    const userRecord = await admin.auth().getUser(uid);
    const userEmail = userRecord.email;
    const userName = userRecord.displayName || '';
    if (!userEmail) throw new HttpsError("internal", "E-mail do usuário não encontrado.");

    const db = admin.firestore();
    const dietsRef = db.collection('diets');
    const waitlistRef = db.collection('waitlist'); // Referência para a coleção waitlist

    // Validação de dieta pendente (permanece igual)
    const pendingDietsQuery = dietsRef.where('userId', '==', uid).where('currentStatus.status', '==', 'pending').limit(1);
    const pendingDietsSnapshot = await pendingDietsQuery.get();
    if (!pendingDietsSnapshot.empty) {
        throw new HttpsError('failed-precondition', 'Você já possui uma dieta pendente de pagamento.');
    }

    // VERIFICAÇÃO 2: Limite da fila de separação
    const counterDocRef = db.collection('counters').doc('diets');
    const counterDoc = await counterDocRef.get();
    const confirmedCount = counterDoc.data()?.confirmedCount || 0;

    if (confirmedCount >= 3) {
        // --- INÍCIO DA MUDANÇA PARA QUEUE_FULL ---
        const existingQueueDoc = await waitlistRef
            .where('uid', '==', uid)
            .where('type', '==', 'queue_full')
            .where('notified', '==', false) // Consideramos duplicata se ainda não foi notificado
            .limit(1)
            .get();

        if (existingQueueDoc.empty) {
            // Se não existe um registro ativo, cria um novo
            await waitlistRef.add({
                uid: uid,
                email: userEmail,
                firstName: userName.split(' ')[0] || '',
                type: 'queue_full',
                address: address,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                notified: false
            });
        } else {
            // Se já existe, apenas atualiza o timestamp para "trazer para cima" na fila de espera
            // ou mantém como está, pois o usuário já está na lista.
            // Para simplicidade, vamos apenas não criar um novo.
            logger.info(`Usuário ${uid} já está na waitlist 'queue_full'. Não criando duplicata.`);
            // Opcional: existingQueueDoc.docs[0].ref.update({ timestamp: admin.firestore.FieldValue.serverTimestamp() });
        }
        // --- FIM DA MUDANÇA PARA QUEUE_FULL ---

        throw new HttpsError("resource-exhausted", "A fila de pedidos está cheia no momento. Avisaremos por e-mail assim que uma vaga abrir!");
    }

    // VERIFICAÇÃO 3: Limite geográfico 
    const normalizedCity = address.city.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // Busca a cidade na nova coleção de áreas de serviço
    const cityDocRef = db.collection('serviceAreas').doc(normalizedCity);
    const cityDoc = await cityDocRef.get();

    // Compara se o documento da cidade não existe ou não está ativo
    if (!cityDoc.exists || !cityDoc.data()?.isActive) {
        // --- INÍCIO DA MUDANÇA PARA REGION_UNAVAILABLE ---
        const existingRegionDoc = await waitlistRef
            .where('uid', '==', uid)
            .where('type', '==', 'region_unavailable')
            .where('address.city', '==', address.city) // Adiciona a cidade para ser mais específico
            .where('notified', '==', false) // Consideramos duplicata se ainda não foi notificado
            .limit(1)
            .get();

        if (existingRegionDoc.empty) {
            // Se não existe um registro ativo para esta região, cria um novo
            await waitlistRef.add({
                uid: uid,
                email: userEmail,
                firstName: userName.split(' ')[0] || '',
                type: 'region_unavailable',
                address: address, // Salva o endereço completo para referência
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                notified: false
            });
        } else {
            // Se já existe, apenas atualiza o timestamp ou mantém como está.
            logger.info(`Usuário ${uid} já está na waitlist 'region_unavailable' para ${address.city}. Não criando duplicata.`);
            // Opcional: existingRegionDoc.docs[0].ref.update({ timestamp: admin.firestore.FieldValue.serverTimestamp() });
        }
        // --- FIM DA MUDANÇA PARA REGION_UNAVAILABLE ---

        throw new HttpsError(
            "out-of-range",
            "Ainda não estamos atendemos sua região."
        );
    }

    // Validação de horário comercial (este já estava correto usando .doc(uid).set())
    const horarioPrompt = _verificarHorarioComercial();
    if (horarioPrompt) {
        // Usa o UID do usuário como ID do documento para garantir unicidade por usuário.
        // Isso sobrescreve qualquer registro anterior do tipo 'off_hours' para este UID.
        await waitlistRef.doc(uid).set({
            uid: uid,
            email: userEmail,
            firstName: userName.split(' ')[0] || '',
            type: 'off_hours',
            address: address,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            notified: false
        });
        return { requiresConfirmation: true, prompt: horarioPrompt };
    }

    return { requiresConfirmation: false, prompt: null };
});


/**
 * Verifica o horário comercial, fins de semana e feriados.
 */
export function _verificarHorarioComercial(): { question: string, options: string[] } | null {
    const hd = new Holidays("BR", "MG");
    const agoraSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));

    const diaDaSemana = agoraSP.getDay(); // 0 = Domingo, 6 = Sábado
    const hora = agoraSP.getHours();     // 0-23

    logger.log(`[Horário Comercial] Verificando... Dia: ${diaDaSemana}, Hora: ${hora}h`);
    logger.log(`[Horário Comercial] É feriado? ${hd.isHoliday(agoraSP)}`);

    // 1. Verifica Feriados e Fins de Semana (entrega no próximo dia útil)
    if (hd.isHoliday(agoraSP) || diaDaSemana === 0 || diaDaSemana === 6) {
        logger.log('[Horário Comercial] Fora do horário: Feriado ou Fim de Semana.');
        return {
            question: "Pedidos feitos em feriados ou fins de semana são preparados e entregues no próximo dia útil. Deseja continuar?",
            options: ['Sim, agendar', 'Não, cancelar']
        };
    }

    // 2. Verifica APÓS o horário comercial (entrega no dia seguinte)
    if (hora >= 17) {
        logger.log(`[Horário Comercial] Fora do horário: Após as 17h.`);
        return {
            question: "Pedidos feitos após as 17:00 são preparados e entregues no dia seguinte. Deseja continuar?",
            options: ['Sim, agendar', 'Não, cancelar']
        };
    }

    // 3. Verifica ANTES do horário comercial (entrega HOJE, mais tarde)
    if (hora < 10) { // Usando 10:00 como início do preparo
        logger.log(`[Horário Comercial] Fora do horário: Antes das 10h.`);
        return {
            question: "Seu pedido será preparado e entregue hoje a partir das 10:00. Deseja continuar?",
            options: ['Sim, agendar', 'Não, cancelar']
        };
    }

    // 4. Se nenhuma das condições acima for atendida, está dentro do horário.
    logger.log('[Horário Comercial] Dentro do horário comercial (10h-17h).');
    return null;
}

/**
 * Ponto de entrada chamado pelo App para iniciar a criação de uma dieta.
 */
export const createDiet = onCall({ region: "southamerica-east1" }, async (request) => {
    // 1. Log de autenticação inicial
    if (!request.auth) {
        logger.error("[createDiet] Chamada não autenticada. Request data:", JSON.stringify(request.data)); // Inclui dados para depuração, mesmo sem autenticação
        throw new HttpsError("unauthenticated", "A função precisa ser chamada por um usuário autenticado.");
    }

    const uid = request.auth.uid;
    logger.log(`[createDiet] Iniciando para UID: ${uid}`);
    // 2. Log dos dados completos recebidos - CRÍTICO PARA DEBUGAÇÃO
    logger.log(`[createDiet] Dados recebidos na chamada: ${JSON.stringify(request.data)}`);

    const { healthProfile, address, selectedGoals, aiProvider, jobId } = request.data as {
        healthProfile: HealthProfile,
        address: Address,
        selectedGoals: string[],
        aiProvider: 'GEMINI' | 'OPENAI',
        jobId: string
    };

    // 3. Validação detalhada dos dados de entrada
    if (!healthProfile || !address || !selectedGoals || !Array.isArray(selectedGoals) || selectedGoals.length === 0 || !aiProvider || !jobId) {
        logger.error(`[createDiet] ERRO DE VALIDAÇÃO: Dados essenciais faltando para UID: ${uid}.`);
        logger.error(`  healthProfile: ${!!healthProfile ? 'OK' : 'FALTANDO/NULO'}`);
        logger.error(`  address: ${!!address ? 'OK' : 'FALTANDO/NULO'}`);
        logger.error(`  selectedGoals: ${!!selectedGoals ? `OK (length: ${selectedGoals.length})` : 'FALTANDO/NULO/NÃO É ARRAY'}`);
        logger.error(`  aiProvider: ${!!aiProvider ? 'OK' : 'FALTANDO/NULO'}`);
        logger.error(`  jobId: ${!!jobId ? 'OK' : 'FALTANDO/NULO'}`);
        throw new HttpsError("invalid-argument", "Dados essenciais (healthProfile, address, selectedGoals, aiProvider, jobId) estão faltando.");
    }
    logger.log(`[createDiet] Validação inicial dos dados bem-sucedida para UID: ${uid}`);
    const formattedActivity = formatActivityLevel(healthProfile.activityLevel);


    const initialProgressLog: string[] = [
        `Metas do Usuário: ${selectedGoals.join(', ')}`,
        `Provedor de IA: ${aiProvider}`,
        `Altura: ${healthProfile.height} cm, Peso: ${healthProfile.weight} kg`,
        `Nível de Atividade: ${formattedActivity}`,
        `Restrições Alimentares: ${healthProfile.dietaryRestrictions?.join(', ') || 'Nenhuma'}`,
        `Condições de Saúde: ${healthProfile.healthConditions?.join(', ') || 'Nenhuma'}`,
        `Localização: ${address.city}, ${address.state}`,
    ];

    logger.log(`[createDiet] Initial progress log preparado para jobId: ${jobId}`);

    // 4. Gravação do documento do job no Firestore
    try {
        // ✨ 2. Crie uma constante e declare seu tipo como JobDiet ✨
        const newJob: JobDiet = {
            status: 'Iniciando',
            processedStep: null,
            progressLog: initialProgressLog,
            createdAt: admin.firestore.FieldValue.serverTimestamp() as any, // Cast para any por causa do ServerTimestamp
            userId: uid,
            error: false,
            finished: false,
            isCancelled: false,
            inputData: { healthProfile, address, selectedGoals, aiProvider }
            // Se faltasse um campo obrigatório aqui, o TypeScript daria erro!
        };

        // ✨ 3. Use o objeto tipado para criar o documento ✨
        await db.collection("jobDiets").doc(jobId).set(newJob);

        logger.log(`[createDiet] Documento jobDiets/${jobId} criado com sucesso.`);
    } catch (dbError: any) {
        logger.error(`[createDiet] ERRO ao gravar documento jobDiets/${jobId}:`, dbError);
        throw new HttpsError("internal", "Falha ao iniciar o job no banco de dados.", dbError);
    }

    // Retorno de sucesso
    return { success: true, jobId: jobId };
});




/**
 * Orquestrador principal que processa a criação da dieta em etapas assíncronas.
 */
export const processDietJobStep = onDocumentWritten({
    region: "us-central1",
    document: "jobDiets/{jobId}"
}, async (event) => {
    if (!event.data?.after.exists) return;
    const jobDocRef = event.data.after.ref;
    const jobData = event.data.after.data() as JobDiet;

    if (jobData?.isCancelled) {
        logger.log(`Job [${event.params.jobId}] foi cancelado. Interrompendo processamento.`);
        return;
    }

    if (!jobData || jobData.finished || jobData.processedStep === jobData.status) return;

    await jobDocRef.update({ processedStep: jobData.status });

    const { healthProfile, address, selectedGoals, aiProvider } = jobData.inputData;
    const uid = jobData.userId;

    try {
        switch (jobData.status) {
            case 'Iniciando': {
                const userDoc = await db.collection('users').doc(uid).get();
                if (!userDoc.exists) throw new HttpsError("not-found", "Perfil de usuário não encontrado.");

                await jobDocRef.update({
                    status: 'Interpretando Prompt'
                });
                break;
            }

            case 'Interpretando Prompt': {
                if (!selectedGoals || selectedGoals.length === 0 || !selectedGoals[0]) {
                    throw new HttpsError("invalid-argument", "O prompt do usuário está vazio ou é inválido.");
                }
                const userPrompt = selectedGoals[0];
                const interpretedPrompt = await interpretUserPrompt(userPrompt, aiProvider);

                if (["inválida", "inválido", "não entendi", "não consegui"].some(keyword => interpretedPrompt.explanation.toLowerCase().includes(keyword))) {
                    logger.warn(`IA interpretou o prompt como inválido. Explicação: "${interpretedPrompt.explanation}"`);
                    throw new HttpsError(
                        "failed-precondition",
                        "Não consegui interpretar o seu pedido. Por favor, tente novamente com outras palavras ou seja mais específico sobre seus objetivos."
                    );
                }

                _validatePromptConflict(interpretedPrompt, healthProfile);

                const logMessages = [
                    `Pedido interpretado: ${interpretedPrompt.explanation}`
                ];
                if (interpretedPrompt.isBudgetFriendly) {
                    logMessages.push('Priorizando alimentos com melhor custo-benefício.');
                }

                await jobDocRef.update({
                    // ✅ ATUALIZAÇÃO PARA USAR O NOVO ARRAY DE LOGS
                    progressLog: admin.firestore.FieldValue.arrayUnion(...logMessages),
                    intermediateData: { interpretedPrompt },
                    status: 'Analisando Perfil'
                });


                break;
            }

            case 'Analisando Perfil': {
                const currentInterpretedPrompt = jobData.intermediateData.interpretedPrompt;
                const { targets: nutritionalValuesTarget } = await calculateNutritionalTargets(healthProfile, currentInterpretedPrompt.applicableGoalKeys);
                const log1 = `Metas calculadas: ${Math.round(nutritionalValuesTarget.energy)} kcal, ${Math.round(nutritionalValuesTarget.proteins)}g de proteína.`;
                const allFoods = await fetchAllFoods();
                const log2 = `Analisando ${allFoods.length} alimentos com seu perfil...`;
                const allowedFoodNames = await filterFoodListWithAI(allFoods, healthProfile, aiProvider);
                const allowedFoods = allFoods.filter(food => allowedFoodNames.includes(food.standard_name));

                if (allowedFoods.length < 15) {
                    throw new HttpsError("failed-precondition", "Não encontramos alimentos suficientes para seu pedido.", { requiresAction: 'adjust_profile' });
                }
                const log3 = `Análise concluída. ${allowedFoods.length} alimentos pré-selecionados.`;

                await jobDocRef.update({
                    status: 'Selecionando com AI',
                    progressLog: admin.firestore.FieldValue.arrayUnion(log1, log2, log3),
                    intermediateData: { ...jobData.intermediateData, nutritionalValuesTarget, allowedFoods }
                });
                break;
            }

            case 'Selecionando com AI': {
                const quantifiedDiet = await selectAndQuantifyFoods(
                    jobData.intermediateData.allowedFoods,
                    jobData.intermediateData.nutritionalValuesTarget,
                    jobData.intermediateData.interpretedPrompt,
                    jobDocRef
                );

                if (!quantifiedDiet || quantifiedDiet.length === 0) {
                    throw new HttpsError("internal", "Não foi possível gerar uma dieta com os alimentos disponíveis.");
                }
                const metrics = calculateDietMetrics(quantifiedDiet);
                const nutritionalValuesGetted = metrics.nutritionalValuesGetted;

                await jobDocRef.update({
                    // progressLog: admin.firestore.FieldValue.arrayUnion('Cálculo da dieta finalizado.'),
                    intermediateData: { ...jobData.intermediateData, quantifiedDiet, nutritionalValuesGetted },
                    status: 'Consultando AI' // Status agora é 'Consultando AI'
                });
                break;
            }

            // PASSO UNIFICADO: Executa a consulta individual e a geral em sequência.
            case 'Consultando AI': {
                logger.log(`[Consultando AI] Iniciando consultas de IA.`);
                // Desestrutura todos os dados necessários do estado intermediário
                const { quantifiedDiet, nutritionalValuesGetted, interpretedPrompt } = jobData.intermediateData;
                const goalText = interpretedPrompt.explanation || interpretedPrompt.originalPrompt || 'um plano de alimentação balanceado';

                // 1. Gerar explicações por alimento. O resultado é o array com o campo 'explanationInDiet' preenchido.
                const dietWithExplanations = await _generateFoodExplanationsInOneShot(quantifiedDiet, goalText, aiProvider);

                // 2. Gerar a explicação geral da dieta, usando a versão JÁ ATUALIZADA da dieta.
                const dietExplanation = await generateDietExplanationAI(
                    dietWithExplanations,
                    nutritionalValuesGetted,
                    interpretedPrompt, // Corrigido para passar o objeto 'interpretedPrompt' completo
                    aiProvider
                );

                // 3. Fazer uma ÚNICA atualização no banco de dados com todos os dados novos.
                await jobDocRef.update({
                    status: 'Finalizando Processo',
                    progressLog: admin.firestore.FieldValue.arrayUnion(
                        `Explicações para ${dietWithExplanations.length} alimentos geradas.`,
                        'Explicações gerais geradas.'
                    ),
                    intermediateData: {
                        ...jobData.intermediateData, // Mantém os dados antigos que não mudaram
                        quantifiedDiet: dietWithExplanations, // Salva a dieta COM as explicações
                        dietExplanation: dietExplanation       // Salva a explicação geral
                    }
                });
                break;
            }

            case 'Finalizando Processo': {

                await _finalDietValidationAI(
                    jobData.intermediateData.quantifiedDiet,
                    healthProfile,
                    aiProvider
                );

                const { totalEstimatedPrice, totalEstimatedWeightInGrams } = calculateDietMetrics(jobData.intermediateData.quantifiedDiet);
                const finalSelectedFoods: FoodItem[] = jobData.intermediateData.quantifiedDiet.map((item: FoodItem) => ({ ...item, orderItemId: uuidv4() }));
                const pickupAddress = "Av. Edmeia Matos Lazzarotti, 4455 - Sra. das Graças, Betim - MG, 32630-080";
                const dropoffAddress = `${address.street}, ${address.number}, ${address.city}, ${address.state}`;
                const rideEstimate = await _getRidePriceEstimateLogic(pickupAddress, dropoffAddress);
                const finalTotalPrice = (totalEstimatedPrice * 1.4) + rideEstimate.highEstimate;

                const newDietId = await generateSequentialDietId(db, uid);
                // const paymentDetails = await _generatePixChargeLogic(finalTotalPrice.toFixed(2), newDietId);
                const paymentDetails = await _generatePixChargeLogic('0.10', newDietId);

                const userDocFinal = await db.collection('users').doc(uid).get();
                const userDataFinal = userDocFinal.data() as UserProfile;



                const finalDiet: Diet = {
                    id: newDietId, userId: uid, userEmail: userDataFinal.email, userPhone: userDataFinal.phone,
                    healthProfile, userFullName: userDataFinal.fullName, address, userAvatarUrl: userDataFinal.photoURL || '',
                    interpretedPrompt: jobData.intermediateData.interpretedPrompt,
                    aiProvider,
                    nutritionalValuesTarget: jobData.intermediateData.nutritionalValuesTarget,
                    nutritionalValuesGetted: jobData.intermediateData.nutritionalValuesGetted,
                    totalEstimatedFoodsPrice: parseFloat(totalEstimatedPrice.toFixed(2)),
                    totalEstimatedDeliveryPrice: parseFloat(rideEstimate.highEstimate.toFixed(2)),
                    totalPrice: parseFloat(finalTotalPrice.toFixed(2)),
                    currentStatus: { status: "pending", timestamp: new Date() },
                    statusHistory: [{ status: "pending", timestamp: new Date() }],
                    timestamp: new Date(),
                    paymentDetails,
                    foodItemsCount: finalSelectedFoods.length,
                    totalEstimatedWeightInGrams: totalEstimatedWeightInGrams,
                    dietExplanation: jobData.intermediateData.dietExplanation,
                    selectedFoods: finalSelectedFoods,
                    pendingReminderSent: false,
                    recalculatedForCost: false
                };

                await db.collection("diets").doc(finalDiet.id).set(sanitizeNaNValues(finalDiet));
                const waitlistDocRef = db.collection('waitlist').doc(uid);
                await waitlistDocRef.delete();

                await jobDocRef.update({
                    status: 'Dieta Gerada',
                    progressLog: admin.firestore.FieldValue.arrayUnion('Código PIX gerado.', 'Processo finalizado.'),
                    finished: true, error: false, dietId: newDietId,
                    resultData: sanitizeNaNValues(finalDiet)
                });
                break;
            }

            case 'Cancelado pelo Usuário': {
                await jobDocRef.update({
                    progressLog: admin.firestore.FieldValue.arrayUnion(`Processo cancelado pelo usuário.`),
                    finished: true, error: true,
                    status: 'Cancelado pelo Usuário'
                });
                break;
            }
        }
    } catch (error: any) {
        const isControlledError = error instanceof HttpsError;
        const errorMessage = isControlledError ? error.message : "Um erro inesperado ocorreu.";
        const errorCode = isControlledError ? error.code : "internal";
        const errorDetails = isControlledError && error.details ? error.details : null;
        await jobDocRef.update({
            status: "Erro na Geração",
            errorMessage: errorMessage,
            progressLog: admin.firestore.FieldValue.arrayUnion(`ERRO: ${errorMessage}`),
            error: true, finished: true,
            errorCode,
            errorDetails
        });
        logger.error(`[${uid}] Erro no job [${event.params.jobId}] no passo [${jobData.status}]:`, error);
    }
});

// const TIMEOUT_MS = 30000; // 30 segundos
// /**
//  * Executa uma promessa e a cancela se ela exceder o tempo limite.
//  * @param {Promise<T>} promise A promessa a ser executada.
//  * @returns {Promise<T>} A promessa original ou um erro de timeout.
//  */
// function withTimeout<T>(promise: Promise<T>): Promise<T> {
//     let timeoutId: NodeJS.Timeout;
//     const timeoutPromise = new Promise<never>((_, reject) => {
//         timeoutId = setTimeout(() => {
//             reject(new Error('Timeout')); // Erro genérico que vamos capturar
//         }, TIMEOUT_MS);
//     });

//     return Promise.race([promise, timeoutPromise]).finally(() => {
//         clearTimeout(timeoutId);
//     });
// }

/**
 * Permite que o cliente cancele um job de criação de dieta em andamento.
 */
export const cancelDietJob = onCall({ region: "southamerica-east1" }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "A função precisa ser chamada por um usuário autenticado.");
    const { jobId } = request.data as { jobId: string };
    if (!jobId) throw new HttpsError("invalid-argument", "jobId é obrigatório.");

    const jobDocRef = db.collection("jobDiets").doc(jobId);
    const jobDoc = await jobDocRef.get();

    if (!jobDoc.exists || jobDoc.data()?.userId !== request.auth.uid) {
        throw new HttpsError("permission-denied", "Você não tem permissão para cancelar este job.");
    }

    const jobData = jobDoc.data();
    const dietId = jobData?.dietId;

    // Se uma dieta já foi criada e está pendente, cancele a cobrança também
    if (dietId) {
        const dietDocRef = db.collection("diets").doc(dietId);
        const dietDoc = await dietDocRef.get();
        if (dietDoc.exists) {
            const dietData = dietDoc.data() as Diet;
            if (dietData.currentStatus.status === 'pending') {
                try {
                    await _cancelPixCharge(dietData.paymentDetails?.txid as string);
                    const newStatus = { status: "cancelled" as const, timestamp: admin.firestore.Timestamp.now(), reason: "Cancelado pelo usuário durante a geração." };
                    await dietDocRef.update({ currentStatus: newStatus, statusHistory: admin.firestore.FieldValue.arrayUnion(newStatus) });
                } catch (error) {
                    logger.error(`Falha ao cancelar cobrança PIX para a dieta [${dietId}] durante o cancelamento do job.`, error);
                    // Continua o processo para pelo menos cancelar o job
                }
            }
        }
    }

    // Marca o job como cancelado para interromper o processDietJobStep
    await jobDocRef.update({ status: 'cancelado_pelo_usuario', isCancelled: true });

    return { success: true, message: "Solicitação de cancelamento enviada." };
});

/**
 * Atualiza o contador de dietas confirmadas no Firestore.
 * @param change O valor a ser somado (1 para incrementar, -1 para decrementar).
 */
export async function updateConfirmedCount(change: 1 | -1): Promise<void> {
    const counterRef = db.collection('counters').doc('diets');
    try {
        await counterRef.update({
            confirmedCount: admin.firestore.FieldValue.increment(change)
        });
        logger.info(`Contador 'confirmedCount' atualizado em: ${change}`);
    } catch (error) {
        logger.error(`Falha ao atualizar o contador 'confirmedCount'. Mudança: ${change}`, error);
        // Em um ambiente de produção, você pode querer adicionar um sistema de alerta aqui.
    }
}

/**
 * Função auxiliar para cancelar uma cobrança PIX na Efí.
 */
async function _cancelPixCharge(txid: string): Promise<void> {
    if (!txid) {
        throw new Error("TXID da cobrança é necessário para o cancelamento.");
    }
    const accessToken = await getEfiAuthToken();
    const { keyBuffer, certBuffer } = await getEfiCertificates();
    const isSandbox = process.env.EFI_SANDBOX === 'true';
    const hostname = isSandbox ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';
    const cancelBody = JSON.stringify({ status: "REMOVIDA_PELO_USUARIO_RECEBEDOR" });
    const options = {
        hostname, path: `/v2/cob/${txid}`, method: 'PATCH',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        cert: certBuffer, key: keyBuffer,
    };
    await httpsRequest(options, cancelBody);
    logger.info(`Cobrança PIX com txid [${txid}] cancelada na Efí.`);
}


/**
 * Recalcula uma dieta existente para otimizar o custo, cancela o PIX antigo e gera um novo.
 */
export const recalculateDietForCost = onCall({ region: "southamerica-east1" }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Autenticação requerida.");
    }
    const uid = request.auth.uid;
    const { dietId } = request.data as { dietId: string };

    if (!dietId) {
        throw new HttpsError("invalid-argument", "O ID da dieta é obrigatório.");
    }

    logger.log(`Iniciando recálculo de custo para dieta [${dietId}] do usuário [${uid}]`);

    const dietDocRef = db.collection("diets").doc(dietId);

    try {
        const dietDoc = await dietDocRef.get();
        if (!dietDoc.exists) {
            throw new HttpsError("not-found", "A dieta solicitada não foi encontrada.");
        }

        const originalDiet = dietDoc.data() as Diet;

        if (originalDiet.userId !== uid) {
            throw new HttpsError("permission-denied", "Você não tem permissão para alterar esta dieta.");
        }
        if (originalDiet.currentStatus.status !== 'pending') {
            throw new HttpsError("failed-precondition", "Apenas dietas pendentes de pagamento podem ser recalculadas.");
        }
        if (originalDiet.recalculatedForCost === true) {
            throw new HttpsError("failed-precondition", "Esta dieta já foi otimizada e não pode ser recalculada novamente.");
        }

        const oldTxid = originalDiet.paymentDetails?.txid;
        if (oldTxid) {
            try {
                await _cancelPixCharge(oldTxid);
                logger.log(`Cobrança PIX antiga [${oldTxid}] para a dieta [${dietId}] foi cancelada.`);
            } catch (cancelError) {
                logger.error(`Falha ao cancelar a cobrança PIX antiga [${oldTxid}]. O processo continuará, mas a cobrança antiga pode permanecer ativa.`, cancelError);
            }
        }

        const { healthProfile, nutritionalValuesTarget, interpretedPrompt } = originalDiet;

        const costEffectivePrompt = {
            ...interpretedPrompt,
            isBudgetFriendly: true,
            explanation: `${interpretedPrompt.explanation} (Otimizado para custo-benefício).`
        };

        const allFoods = await fetchAllFoods();
        const allowedFoodNames = await filterFoodListWithAI(allFoods, healthProfile, 'GEMINI');
        const allowedFoods = allFoods.filter(food => allowedFoodNames.includes(food.standard_name));

        if (allowedFoods.length < 15) {
            throw new HttpsError("failed-precondition", "Não encontramos alimentos suficientes para seu perfil ao tentar otimizar o custo.");
        }

        const newQuantifiedDiet = await selectAndQuantifyFoods(
            allowedFoods,
            nutritionalValuesTarget,
            costEffectivePrompt,
            dietDocRef
        );

        if (!newQuantifiedDiet || newQuantifiedDiet.length === 0) {
            throw new HttpsError("internal", "Não foi possível gerar uma nova lista de alimentos com custo otimizado.");
        }

        const { totalEstimatedPrice, totalEstimatedWeightInGrams, nutritionalValuesGetted } = calculateDietMetrics(newQuantifiedDiet);
        const finalTotalPrice = (totalEstimatedPrice * 1.3) + originalDiet.totalEstimatedDeliveryPrice;

        logger.log(`Recálculo concluído. Preço antigo: ${originalDiet.totalPrice}, Preço novo: ${finalTotalPrice}`);

        const newPaymentDetails = await _generatePixChargeLogic(finalTotalPrice.toFixed(2), dietId);

        const updatedDietData = {
            ...originalDiet,
            interpretedPrompt: costEffectivePrompt,
            selectedFoods: newQuantifiedDiet,
            nutritionalValuesGetted,
            totalEstimatedFoodsPrice: parseFloat(totalEstimatedPrice.toFixed(2)),
            totalPrice: parseFloat(finalTotalPrice.toFixed(2)),
            totalEstimatedWeightInGrams,
            foodItemsCount: newQuantifiedDiet.length,
            recalculatedForCost: true,
            timestamp: admin.firestore.Timestamp.now(),
            paymentDetails: newPaymentDetails
        };

        await dietDocRef.set(sanitizeNaNValues(updatedDietData));

        try {
            const firstName = formatFirstName(updatedDietData.userFullName);
            const emailHtml = getRecalculatedDietEmailHTML({
                firstName: firstName,
                orderId: dietId,
                oldPrice: originalDiet.totalPrice,
                newPrice: finalTotalPrice,
                pixCopiaECola: newPaymentDetails.copiaECola,
                qrCodeImageUrl: newPaymentDetails.qrCodeImageUrl,
            });

            await sendEmail(
                updatedDietData.userEmail,
                `✅ Sua dieta foi otimizada! Novo valor: ${finalTotalPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
                emailHtml
            );
            logger.log(`E-mail de recálculo enviado com sucesso para a dieta [${dietId}].`);
        } catch (emailError) {
            logger.error(`Falha ao enviar o e-mail de recálculo para a dieta [${dietId}]. O processo principal não foi afetado.`, emailError);
        }

        // A função agora retorna explicitamente o objeto de sucesso no final do bloco 'try'.
        return { success: true, newPrice: finalTotalPrice };

    } catch (error: any) {
        logger.error(`Erro crítico ao recalcular a dieta [${dietId}]:`, error);
        // Se qualquer erro for lançado dentro do 'try', ele será capturado aqui e
        // o wrapper onCall o enviará corretamente ao cliente.
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Um erro inesperado ocorreu durante o recálculo da dieta.");
    }
});









/**
 * Permite que um cliente cancele sua própria dieta PENDENTE.
 */
export const requestOrderCancellation = onCall({ region: "southamerica-east1" }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Você precisa estar logado.");
    const uid = request.auth.uid;
    const { dietId, reason } = request.data;
    if (!dietId || !reason) {
        throw new HttpsError("invalid-argument", "O ID da dieta e um motivo são obrigatórios.");
    }
    const dietDocRef = db.collection("diets").doc(dietId);
    try {
        const dietDoc = await dietDocRef.get();
        if (!dietDoc.exists) throw new HttpsError("not-found", "Pedido não encontrado.");
        const dietData = dietDoc.data() as Diet;

        if (dietData?.userId !== uid) throw new HttpsError("permission-denied", "Você não tem permissão para cancelar este pedido.");
        if (dietData?.currentStatus.status !== 'pending') throw new HttpsError("failed-precondition", "Este pedido já foi pago e não pode ser cancelado por esta via.");

        // Usa a nova função auxiliar
        await _cancelPixCharge(dietData.paymentDetails?.txid as string);

        const newStatus = { status: "cancelled" as const, timestamp: admin.firestore.Timestamp.now(), reason: `Cancelado pelo cliente: ${reason}` };
        await dietDocRef.update({ currentStatus: newStatus, statusHistory: admin.firestore.FieldValue.arrayUnion(newStatus), 'paymentDetails.status': 'cancelled_by_user' });

        return { success: true, message: "Pedido cancelado com sucesso." };
    } catch (error: any) {
        logger.error(`Falha ao cancelar o pedido [${dietId}]:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Não foi possível cancelar a cobrança PIX com o provedor de pagamento.");
    }
});

/**
 * Permite que um cliente solicite o cancelamento de um pedido PAGO ('confirmed') e inicia o estorno.
 */
export const requestRefundAndCancelOrder = onCall({ region: "southamerica-east1" }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Você precisa estar logado.");
    const uid = request.auth.uid;
    const { dietId, reason } = request.data;
    if (!dietId || !reason) throw new HttpsError("invalid-argument", "O ID da dieta e um motivo são obrigatórios.");

    const dietDocRef = db.collection("diets").doc(dietId);
    try {
        const refundDetailsFromApi = await db.runTransaction(async (transaction) => {
            const dietDoc = await transaction.get(dietDocRef);
            if (!dietDoc.exists) throw new HttpsError("not-found", "Pedido não encontrado.");
            const dietData = dietDoc.data() as Diet;

            if (dietData.userId !== uid) throw new HttpsError("permission-denied", "Você não tem permissão para cancelar este pedido.");
            if (dietData.currentStatus.status !== 'confirmed') throw new HttpsError("failed-precondition", "Este pedido não pode ser cancelado pois já está em preparação ou trânsito.");
            if (dietData.refundDetails) throw new HttpsError("failed-precondition", "Um estorno para este pedido já foi solicitado.");

            // << MUDANÇA AQUI: Pegamos o 'txid' em vez do 'e2eId' >>
            const txid = dietData.paymentDetails?.txid;
            const refundAmount = dietData.totalPrice;

            if (!txid) {
                throw new HttpsError("internal", "ID da transação (txid) não encontrado no pedido para processar o estorno.");
            }

            // << MUDANÇA AQUI: Passamos o 'txid' para a função de estorno >>
            const refundDetails = await _initiatePixRefundLogic(txid, refundAmount, `Cancelado pelo cliente: ${reason}`);

            const newStatus = { status: "in_refund_progress" as const, timestamp: admin.firestore.Timestamp.now(), reason: `Cancelado pelo cliente: ${reason}` };
            transaction.update(dietDocRef, { currentStatus: newStatus, statusHistory: admin.firestore.FieldValue.arrayUnion(newStatus), refundDetails });
            return refundDetails;
        });
        return { success: true, message: "Solicitação de estorno enviada. O status será atualizado em breve.", refundDetails: refundDetailsFromApi };
    } catch (error: any) {
        if (error.message && error.message.includes("valor_devolucao_atingido")) {
            logger.warn(`Tentativa de estorno duplicado para a dieta [${dietId}]. Sincronizando status local.`);
            const newStatus = { status: "cancelled" as const, timestamp: admin.firestore.Timestamp.now(), reason: `Cancelado pelo cliente (sincronizado).` };
            const pseudoRefundDetails = { status: "SYNCED_ERROR", reason: `Sincronizado após erro de duplicidade.`, requestedAt: admin.firestore.Timestamp.now() };
            await dietDocRef.update({ currentStatus: newStatus, statusHistory: admin.firestore.FieldValue.arrayUnion(newStatus), refundDetails: pseudoRefundDetails });
            return { success: true, message: "Este pedido já foi cancelado e estornado." };
        }
        logger.error(`Erro ao solicitar estorno para a dieta [${dietId}]:`, error);
        if (error instanceof HttpsError) throw error;
        // A mensagem de erro original da sua função _initiatePixRefundLogic é boa, vamos usá-la.
        throw new HttpsError("internal", error.message || "Não foi possível processar o cancelamento e estorno.");
    }
});


/**
 * Verifica se os alimentos que a IA sugeriu incluir entram em conflito
 * com as alergias ou restrições do perfil do usuário.
 */
function _validatePromptConflict(interpretedPrompt: InterpretedPrompt, healthProfile: HealthProfile): void {
    const foodsToInclude = interpretedPrompt.foodsToInclude || [];
    if (foodsToInclude.length === 0) {
        return; // Nenhum alimento para verificar
    }

    const allExclusions = [
        ...(healthProfile.allergies || []),
        ...(healthProfile.dietaryRestrictions || [])
    ];

    const normalizedExclusions = new Set(
        allExclusions
            .map(e => String(e || '').toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
            .filter(e => e.length > 0)
    );

    if (normalizedExclusions.size === 0) {
        return; // O usuário não tem nenhuma exclusão
    }

    const conflictingFoods: string[] = [];

    for (const foodToInclude of foodsToInclude) {
        const normalizedFood = foodToInclude.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        if (normalizedExclusions.has(normalizedFood)) {
            conflictingFoods.push(foodToInclude);
        }
    }

    if (conflictingFoods.length > 0) {
        const conflictList = conflictingFoods.join(', ');
        throw new HttpsError(
            "failed-precondition",
            `Seu pedido ("${interpretedPrompt.originalPrompt}") entra em conflito com suas restrições/alergias cadastradas para: ${conflictList}. Por favor, ajuste seu pedido ou seu perfil.`
        );
    }
}



/**
 * Usa IA como uma camada final de segurança para verificar se algum alimento na dieta
 * final conflita com as alergias e restrições do usuário.
 */
export async function _finalDietValidationAI(
    quantifiedDiet: FoodItem[],
    healthProfile: HealthProfile,
    aiProvider: 'GEMINI' | 'OPENAI'
): Promise<void> {

    const allExclusionsText = [
        ...(healthProfile.allergies || []),
        ...(healthProfile.dietaryRestrictions || [])
    ].join(', ');

    if (!allExclusionsText.trim()) {
        logger.info("[VALIDAÇÃO IA] Nenhuma restrição encontrada no perfil, verificação final não necessária.");
        return;
    }

    const dietFoodList = quantifiedDiet.map(item => item.food.standard_name).join(', ');

    if (!dietFoodList.trim()) {
        logger.warn("[VALIDAÇÃO IA] A dieta final está vazia, não há o que verificar.");
        return;
    }

    const prompt = `
        Você é um especialista em segurança alimentar e alergias. Sua tarefa é analisar uma lista de compras final e compará-la com as restrições de um usuário.

        **Restrições e Alergias do Usuário:** "${allExclusionsText}"

        **Lista de Compras da Dieta Final:** "${dietFoodList}"

        **Tarefa:**
        Verifique se ALGUM item na "Lista de Compras" conflita DIRETAMENTE com as "Restrições e Alergias do Usuário".

        **Formato da Resposta (Regras Estritas):**
        - Se encontrar um ou mais conflitos, retorne um objeto JSON com a seguinte estrutura:
          { "hasConflict": true, "conflictingFoods": ["nome do alimento 1", "nome do alimento 2"], "reason": "Explique brevemente por que o(s) alimento(s) conflita(m) com a(s) restrição(ões)." }
        - Se NÃO encontrar NENHUM conflito, retorne um objeto JSON com a seguinte estrutura:
          { "hasConflict": false, "conflictingFoods": [], "reason": "Nenhum conflito encontrado." }

        Retorne APENAS o objeto JSON.
    `;

    try {
        const jsonResponse = await callAI(prompt, aiProvider, true);
        const validationResult = JSON.parse(jsonResponse);

        if (validationResult.hasConflict === true && Array.isArray(validationResult.conflictingFoods) && validationResult.conflictingFoods.length > 0) {
            logger.error(`[VALIDAÇÃO IA] Conflito detectado na dieta final! Alimentos: ${validationResult.conflictingFoods.join(', ')}. Motivo: ${validationResult.reason}`);
            throw new HttpsError(
                "internal",
                `Verificação final falhou: A dieta gerada continha ${validationResult.conflictingFoods.join(', ')}, que conflita com seu perfil. Por favor, tente gerar novamente.`
            );
        }

        logger.info("[VALIDAÇÃO IA] Nenhuma inconsistência encontrada na dieta final.");

    } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error("[VALIDAÇÃO IA] Erro crítico ao executar a verificação final com IA:", error);
        throw new HttpsError("internal", "Não foi possível realizar a verificação de segurança final da sua dieta.");
    }
}




// export const getConfirmedOrderStatus = onCall({ region: "southamerica-east1" }, async (request) => {
//     if (!request.auth) {
//         throw new HttpsError("unauthenticated", "Autenticação requerida.");
//     }
//     const uid = request.auth.uid;
//     const { dietId } = request.data;

//     if (!dietId || typeof dietId !== 'string') {
//         throw new HttpsError("invalid-argument", "O ID da dieta é obrigatório.");
//     }

//     try {
//         const dietDocRef = db.collection("diets").doc(dietId);
//         const dietDoc = await dietDocRef.get();

//         if (!dietDoc.exists) {
//             throw new HttpsError("not-found", "Pedido não encontrado.");
//         }

//         const diet = dietDoc.data() as Diet;

//         if (diet.userId !== uid) {
//             throw new HttpsError("permission-denied", "Você não tem permissão para consultar este pedido.");
//         }

//         if (diet.currentStatus.status !== 'confirmed') {
//             return {
//                 status: 'not_confirmed',
//                 message: `O status atual do pedido é '${diet.currentStatus.status}', e não 'confirmed'.`
//             };
//         }

//         const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
//         const currentHour = now.getHours();
//         const currentDay = now.getDay(); // 0 = Domingo, 6 = Sábado
//         const isWeekday = currentDay > 0 && currentDay < 6;

//         // A LÓGICA PRINCIPAL ACONTECE AQUI
//         if (diet.deliveryScheduledFor) {
//             const scheduledDate = (diet.deliveryScheduledFor as admin.firestore.Timestamp).toDate();

//             // Formata a data para ser mais amigável (ex: "terça-feira, 24 de setembro")
//             const formattedDate = scheduledDate.toLocaleDateString('pt-BR', {
//                 weekday: 'long',
//                 day: 'numeric',
//                 month: 'long'
//             });

//             return {
//                 status: 'scheduled',
//                 message: `Sua dieta está agendada para ser entregue na ${formattedDate}.`,
//                 scheduledFor: scheduledDate
//             };
//         } else {
//             return {
//                 status: 'active',
//                 message: 'Estamos notificando um picker para separar seu pedido agora mesmo.'
//             };
//         }

//     } catch (error) {
//         logger.error(`Erro ao verificar status do pedido confirmado [${dietId}]:`, error);
//         if (error instanceof HttpsError) {
//             throw error;
//         }
//         throw new HttpsError("internal", "Não foi possível obter os detalhes do seu pedido.");
//     }
// });


export const getConfirmedOrderStatus = onCall({ region: "southamerica-east1" }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Autenticação requerida.");
    }
    const uid = request.auth.uid;
    const { dietId } = request.data;
    if (!dietId) {
        throw new HttpsError("invalid-argument", "O ID da dieta é obrigatório.");
    }

    try {
        const dietDoc = await db.collection("diets").doc(dietId).get();
        if (!dietDoc.exists) {
            throw new HttpsError("not-found", "Pedido não encontrado.");
        }

        const diet = dietDoc.data() as Diet;
        if (diet.userId !== uid) {
            throw new HttpsError("permission-denied", "Acesso negado.");
        }
        if (diet.currentStatus.status !== 'confirmed') {
            return { status: 'not_confirmed', message: `Status atual: '${diet.currentStatus.status}'` };
        }

        // ✅ --- LÓGICA DE STATUS HÍBRIDA E CORRIGIDA ---

        // 1. PRIORIDADE MÁXIMA: Verifica se há um agendamento explícito no banco de dados.
        if (diet.deliveryScheduledFor) {
            let scheduledDate: Date;
            const scheduledValue = diet.deliveryScheduledFor as any;
            if (scheduledValue && typeof scheduledValue.toDate === 'function') {
                scheduledDate = scheduledValue.toDate(); // Converte de Timestamp para Date
            } else {
                scheduledDate = scheduledValue; // Já é um Date, apenas atribui
            }

            // Formata a data para ser mais amigável
            const formattedDate = scheduledDate.toLocaleDateString('pt-BR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long'
            });

            return {
                status: 'scheduled',
                // Mensagem ajustada para mais clareza
                message: `Sua entrega está agendada para ${formattedDate}.`,
                scheduledFor: scheduledDate
            };
        }

        // 2. FALLBACK: Se não houver agendamento explícito, calcula o status com base na hora atual.
        else {
            const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
            const currentHour = now.getHours();
            const currentDay = now.getDay(); // 0 = Domingo, 6 = Sábado
            const isWeekday = currentDay > 0 && currentDay < 6;

            // Caso 2a: Dentro do horário de separação (Seg-Sex, 10h-17h)
            if (isWeekday && currentHour >= 10 && currentHour < 17) {
                return {
                    status: 'active',
                    message: 'Estamos notificando um picker para separar seu pedido.'
                };
            }
            // Caso 2b: Dia de semana, mas antes do início do expediente
            else if (isWeekday && currentHour < 10) {
                return {
                    status: 'scheduled',
                    message: 'A busca por um picker começará às 10:00.'
                };
            }
            // Caso 2c: Fora do horário (depois das 17h ou fins de semana)
            else {
                return {
                    status: 'scheduled',
                    message: 'Sua dieta está agendada para ser entregue na ${formattedDate}.'
                };
            }
        }

    } catch (error) {
        logger.error(`Erro ao verificar status do pedido confirmado [${dietId}]:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Não foi possível obter os detalhes do seu pedido.");
    }
});


/**
 * Gera ideias de prompts de dieta personalizadas com base no perfil do usuário usando IA.
 */
export const generatePromptIdeas = onCall({ region: "southamerica-east1" }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Autenticação requerida.");
    }

    const { healthProfile, aiProvider } = request.data as {
        healthProfile: HealthProfile,
        aiProvider: 'GEMINI' | 'OPENAI'
    };

    if (!healthProfile || !healthProfile.sex || !healthProfile.dateOfBirth) {
        throw new HttpsError("invalid-argument", "Perfil de saúde com gênero e data de nascimento é obrigatório.");
    }

    const age = calculateAge(healthProfile.dateOfBirth);
    const sexText = healthProfile.sex === 'male' ? 'um homem' : 'uma mulher';

    type ActivityLevel = 'sedentary' | 'lightly_active' | 'active' | 'very_active';
    const activityLevelMap: Record<ActivityLevel, string> = {
        sedentary: 'sedentária',
        lightly_active: 'levemente ativa',
        active: 'ativa',
        very_active: 'muito ativa',
    };
    const isValidActivityLevel = (level: any): level is ActivityLevel => level in activityLevelMap;

    let activityLevelText = '';
    if (healthProfile.activityLevel && isValidActivityLevel(healthProfile.activityLevel)) {
        activityLevelText = `e sou uma pessoa ${activityLevelMap[healthProfile.activityLevel]}`;
    }

    // Lista de chaves válidas que a IA deve usar
    const validGoalKeys = Object.keys(dietGoalDictionaryPT);

    const systemPrompt = `
        Você é um nutricionista criativo e especialista em marketing para um serviço de dietas.

        **CONTEXTO DO USUÁRIO:**
        - O usuário é ${sexText} de ${age} anos ${activityLevelText}.

        **SUA TAREFA:**
        Crie 4 ideias de prompts CRIATIVAS e ORIGINAIS. Os prompts devem simular a voz de um usuário real. Para cada prompt, associe-o a UMA das seguintes categorias de objetivo (goalKey).

        **Categorias de Objetivo Válidas (goalKey):**
        ${validGoalKeys.join(', ')}

        **REGRAS ESTRITAS DE GERAÇÃO E FORMATAÇÃO:**
        1.  Os prompts devem ser casuais, em primeira pessoa ("eu quero", "preciso de", etc.).
        2.  Cada prompt deve ter entre 50 e 80 caracteres.
        3.  Para cada prompt, escolha a 'goalKey' mais relevante da lista de categorias válidas.
        4.  A resposta DEVE ser um array JSON válido de objetos, cada um contendo uma chave "goalKey" e uma chave "prompt".
        5.  NÃO inclua nenhum texto, explicação ou formatação fora do array JSON.

        **Formato OBRIGATÓRIO da resposta:**
        [
          { "goalKey": "muscle_gain", "prompt": "Preciso de uma seleção de alimentos para ganhar massa muscular." },
          { "goalKey": "energy_boost", "prompt": "Me ajuda com uma dieta para ter mais energia e disposição no dia a dia." }
        ]
    `;

    try {
        const jsonResponse = await callAI(systemPrompt, aiProvider, true);
        const ideas = JSON.parse(jsonResponse);

        // Validação para o novo formato
        if (!Array.isArray(ideas) || ideas.length === 0 || !ideas[0].prompt || !ideas[0].goalKey) {
            throw new Error("A IA não retornou um array de objetos de ideias válido com 'prompt' e 'goalKey'.");
        }

        return { success: true, ideas };

    } catch (error: any) {
        logger.error("Falha ao gerar ideias de prompts com IA:", { error });
        throw new HttpsError("internal", "Não foi possível gerar novas ideias de prompts no momento. Tente novamente.");
    }
});
