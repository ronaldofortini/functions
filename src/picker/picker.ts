import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { ImageAnnotatorClient } from "@google-cloud/vision";
// import { VertexAI } from "@google-cloud/vertexai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Diet, Food, FoodItem, HealthProfile, Address } from "../core/models";
import { getSecrets } from "../core/secrets";
import { _getRidePriceEstimateLogic, _initiatePixPaymentLogic, _initiatePixRefundLogic, formatFirstName, calculateTotalNutrients } from "../core/utils";
import { filterFoodListWithAI, generateExplanationForSingleFood } from "../diet/diet-logic";
import { getPickerRegistrationReceivedHTML, getNewProblemReportAlertEmailHTML, getPickerSupportConfirmationEmailHTML, getPickerProblemApologyEmailHTML, getSupportTicketAlertEmailHTML, getNewPickerForApprovalEmailHTML } from "../core/email-templates";
import { logger } from "firebase-functions";
import { sendEmail, formatOrderIdForDisplay, getMainMacronutrient, callAI, _geocodeAddress } from "../core/utils";
import { _verificarHorarioComercial } from "./../diet/diet";
// import { cancelAndRefundOrder } from "../payments/payments";

const visionClient = new ImageAnnotatorClient();
const db = admin.firestore();


interface Coordinates {
    lat: number;
    lon: number;
}



/**
 * Calcula a distância em linha reta entre dois pontos geográficos usando a fórmula de Haversine.
 * @param coords1 Coordenadas do primeiro ponto.
 * @param coords2 Coordenadas do segundo ponto.
 * @returns A distância em quilômetros.
 */
function haversineDistance(coords1: Coordinates, coords2: Coordinates): number {
    const R = 6371; // Raio da Terra em km
    const dLat = (coords2.lat - coords1.lat) * Math.PI / 180;
    const dLon = (coords2.lon - coords1.lon) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(coords1.lat * Math.PI / 180) * Math.cos(coords2.lat * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Busca dietas confirmadas, filtra por cidade (padrão) ou por raio de distância,
 * e as ordena pela proximidade do endereço base do picker.
 */
export const getAvailableDietsForPicker = onCall({ region: "southamerica-east1", memory: "512MiB" }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Autenticação requerida.");
    }
    const pickerUid = request.auth.uid;

    // ✅ CONTROLE DE LÓGICA:
    // Mude para 'false' para usar a lógica de raio de distância (MAX_DISTANCE_KM).
    const FILTER_BY_CITY = true;
    const MAX_DISTANCE_KM = 15; // Usado apenas se FILTER_BY_CITY for false.

    try {
        // 1. Buscar os dados base do picker (endereço e coordenadas)
        const pickerDocRef = db.collection("users").doc(pickerUid);
        const pickerDoc = await pickerDocRef.get();
        const pickerData = pickerDoc.data();

        const pickerAddress = pickerData?.picker?.baseAddress;
        if (!pickerAddress || !pickerAddress.city) {
            throw new HttpsError("failed-precondition", "Seu endereço base com cidade não foi encontrado. Por favor, atualize seu perfil.");
        }

        const pickerCoords = pickerAddress.coordinates;
        if (!pickerCoords?.lat || !pickerCoords?.lon) {
            logger.warn(`Picker ${pickerUid} está buscando dietas sem coordenadas para cálculo de distância.`);
            // Não lançamos um erro aqui, pois a distância é secundária, mas alertamos.
        }

        let availableDiets: (Diet & { distance?: number })[] = [];
        const dietsRef = db.collection("diets");

        // =========================================================================
        // ✅ NOVA LÓGICA: FILTRAGEM POR CIDADE (MAIS EFICIENTE)
        // =========================================================================
        if (FILTER_BY_CITY) {
            logger.info(`Buscando dietas para o picker ${pickerUid} na cidade: ${pickerAddress.city}`);

            // 2.A. Buscar dietas já filtradas pela cidade do picker no Firestore
            const q = dietsRef
                .where("currentStatus.status", "==", "confirmed")
                .where("address.city", "==", pickerAddress.city); // Filtro principal no DB

            const dietsSnapshot = await q.get();
            availableDiets = dietsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Diet));

            // =========================================================================
            // 🚫 LÓGICA ANTIGA: FILTRAGEM POR RAIO DE DISTÂNCIA (MANTIDA)
            // =========================================================================
        } else {
            logger.info(`Buscando dietas para o picker ${pickerUid} em um raio de ${MAX_DISTANCE_KM}km`);

            // 2.B. Buscar TODAS as dietas confirmadas
            const q = dietsRef.where("currentStatus.status", "==", "confirmed");
            const dietsSnapshot = await q.get();
            const allConfirmedDiets = dietsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Diet));

            // 3.B. Filtrar em memória pela distância (menos eficiente)
            availableDiets = allConfirmedDiets
                // Passo 1: Garante que TODOS os objetos tenham a propriedade 'distance', mesmo que seja nula.
                .map(diet => {
                    const dietCoords = diet.address?.coordinates;
                    if (pickerCoords && dietCoords?.lat && dietCoords?.lon) {
                        const distance = haversineDistance(pickerCoords, dietCoords);
                        // Retorna o objeto com a distância calculada.
                        return { ...diet, distance };
                    }
                    // Retorna o objeto com 'distance: null' para manter uma estrutura consistente.
                    return { ...diet, distance: null };
                })
                // Passo 2: Agora o filtro é mais simples e seguro, pois 'diet.distance' sempre existe.
                .filter((diet): diet is Diet & { distance: number } => {
                    // A condição agora verifica por 'null' e o compilador não reclama mais.
                    return diet.distance !== null && diet.distance <= MAX_DISTANCE_KM;
                });
        }


        // 4. Calcular distância (se ainda não foi calculada) e ordenar
        const dietsWithDistance = availableDiets
            .map(diet => {
                // Se a distância ainda não foi calculada (caso do filtro por cidade), calcula agora.
                if (diet.distance === undefined && pickerCoords && diet.address?.coordinates) {
                    // Retorna um NOVO objeto com a distância adicionada
                    return {
                        ...diet,
                        distance: haversineDistance(pickerCoords, diet.address.coordinates)
                    };
                }
                // Retorna o objeto original (que pode ou não ter a distância)
                return diet;
            })
            // ✅ CORREÇÃO: Adicionamos o "type guard" `(diet): diet is Diet & { distance: number } => ...`
            // Isso garante ao TypeScript que, após o filtro, todos os objetos terão a propriedade 'distance'.
            .filter((diet): diet is Diet & { distance: number } =>
                diet.distance !== undefined && diet.distance !== null
            );

        // 5. Ordenar as dietas filtradas pela distância
        // Agora o TypeScript não reclama mais, e podemos simplificar a lógica do sort.
        dietsWithDistance.sort((a, b) => a.distance - b.distance);

        return { diets: dietsWithDistance };

    } catch (error) {
        logger.error(`Erro ao buscar dietas para o picker ${pickerUid}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Não foi possível buscar as dietas disponíveis.");
    }
});






// =========================================================================
// FUNÇÕES DE CADASTRO E VALIDAÇÃO DO PICKER
// =========================================================================

/**
 * Endpoint para o app do Picker verificar se está dentro do horário de trabalho.
 */
export const getPickerOperationalStatus = onCall({ region: "southamerica-east1" }, (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Autenticação requerida.");
    }

    try {
        // 1. Chama a lógica central existente
        const statusResult = _verificarHorarioComercial();

        // 2. Traduz a resposta para um formato simples de 'aberto/fechado'
        if (statusResult === null) {
            // Se o resultado é nulo, significa que está dentro do horário comercial
            return {
                isOpen: true,
                message: "Dentro do horário de funcionamento."
            };
        } else {
            // Se retornou um objeto, significa que está fechado.
            // Usamos a 'question' como uma mensagem amigável.
            // const message = statusResult.question.replace(" Deseja continuar?", ".");
            return {
                isOpen: false,
                message: 'Fora do horário de separação (10:00 às 17:00).'
            };
        }
    } catch (error) {
        logger.error("Erro ao verificar o status operacional para picker:", error);
        throw new HttpsError("internal", "Não foi possível verificar o status operacional.");
    }
});

/**
 * Valida uma imagem de documento (frente/verso de CNH/RG) usando a Vision API.
 */
export const validatePickerDocument = onCall({ memory: "512MiB" }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "A função precisa ser chamada por um usuário autenticado.");
    const { imageUrl, imageType } = request.data;
    if (!imageUrl || !imageType) throw new HttpsError("invalid-argument", "A URL e o tipo da imagem são obrigatórios.");
    try {
        if (imageType === 'selfieWithDoc') {
            return { success: true, message: "Validação de selfie pulada por enquanto." };
        }
        const [result] = await visionClient.textDetection(imageUrl);
        const text = result.fullTextAnnotation?.text?.toUpperCase() ?? "";
        let valid = false;
        if (imageType === 'documentFront' && (text.includes("REPUBLICA FEDERATIVA") || text.includes("CARTEIRA DE HABILITACAO") || text.includes("REGISTRO GERAL"))) {
            valid = true;
        }
        if (imageType === 'documentBack' && (text.includes("FILIACAO") || text.includes("ASSINATURA DO PORTADOR") || text.includes("DATA DE EMISSAO"))) {
            valid = true;
        }
        if (!valid) {
            throw new HttpsError("invalid-argument", "A imagem não parece ser um documento de identificação válido.");
        }
        return { success: true, message: "Documento validado com sucesso!" };
    } catch (error: any) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Não foi possível validar a imagem no momento.");
    }
});

// export const createPickerProfile = onCall({ memory: "512MiB" }, async (request) => {
//     if (!request.auth) throw new HttpsError("unauthenticated", "A função precisa ser chamada por um usuário autenticado.");
//     const uid = request.auth.uid;
//     const data = request.data;
//     if (!data || !data.pixKey || !data.documentFrontUrl || !data.pixKeyHolderName) {
//         throw new HttpsError("invalid-argument", "Dados para o perfil de picker estão incompletos.");
//     }

//     const userDocRef = db.collection("users").doc(uid);
//     const pickerData = {
//         registrationInfo: {
//             role: "pending_approval",
//             registeredAt: admin.firestore.FieldValue.serverTimestamp(),
//             documentFrontUrl: data.documentFrontUrl,
//             documentBackUrl: data.documentBackUrl,
//             selfieWithDocUrl: data.selfieWithDocUrl,
//         },
//         paymentInfo: {
//             pixKey: data.pixKey,
//             pixKeyHolderName: data.pixKeyHolderName,
//             pixKeyType: data.pixKeyType,
//         },
//         metrics: {
//             dietsCompleted: 0,
//             dietsCanceled: 0,
//             lifetimeEarnings: 0,
//             currentMonthEarnings: 0,
//             balance: 0,
//         },
//         // Você pode inicializar 'performance' aqui também, se desejar
//         // performance: { rating: 5, acceptanceRate: 1, onTimeRate: 1 }
//     };

//     try {
//         // Usamos .set({ picker: pickerData }, { merge: true }) para não sobrescrever outros dados do usuário
//         await userDocRef.set({ picker: pickerData }, { merge: true });

//         const userDoc = await userDocRef.get();
//         const userEmail = request.auth.token.email;
//         const userName = userDoc.data()?.fullName || 'Picker';

//         if (userEmail) {
//             await sendEmail(
//                 userEmail,
//                 '✅ Recebemos seu cadastro de Picker!',
//                 getPickerRegistrationReceivedHTML({ firstName: userName.split(' ')[0] })
//             );
//         }

//         return { success: true, message: "Perfil de picker criado com sucesso!" };
//     } catch (error: any) {
//         throw new HttpsError("internal", error.message || "Não foi possível criar o perfil de picker.");
//     }
// });


// =========================================================================
// FUNÇÕES DE AÇÕES DO PICKER DURANTE A DIETA
// =========================================================================
/**
 * Salva os dados de um novo candidato a picker no Firestore e envia um e-mail de confirmação.
 */
export const createPickerProfile = onCall({ memory: "512MiB" }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "A função precisa ser chamada por um usuário autenticado.");
    const uid = request.auth.uid;
    const data = request.data;
    if (!data || !data.pixKey || !data.documentFrontUrl || !data.pixKeyHolderName) {
        throw new HttpsError("invalid-argument", "Dados para o perfil de picker estão incompletos.");
    }
    const db = admin.firestore();
    const userDocRef = db.collection("users").doc(uid);

    const baseAddressObject: Address = {
        id: db.collection('users').doc().id,
        street: data.street,
        number: data.number || 'S/N',
        complement: data.complement || '',
        neighborhood: data.neighborhood,
        city: data.city,
        state: data.state,
        zipCode: data.zipCode,
        isDefault: true,
    };

    try {
        const coordinates = await _geocodeAddress(baseAddressObject);
        baseAddressObject.coordinates = coordinates; // Anexa as coordenadas ao objeto
    } catch (geoError) {
        logger.error("Falha ao geocodificar o endereço do picker:", geoError);
        // Decida como tratar o erro: pode lançar uma HttpsError ou salvar sem as coordenadas
        throw new HttpsError("internal", "Não foi possível validar as coordenadas do seu endereço.");
    }


    const pickerData = {
        registrationInfo: {
            role: "pending_approval",
            registeredAt: admin.firestore.FieldValue.serverTimestamp(),
            documentFrontUrl: data.documentFrontUrl,
            documentBackUrl: data.documentBackUrl,
            selfieWithDocUrl: data.selfieWithDocUrl,
        },
        paymentInfo: {
            pixKey: data.pixKey,
            pixKeyHolderName: data.pixKeyHolderName,
            pixKeyType: data.pixKeyType,
        },
        metrics: {
            dietsCompleted: 0,
            dietsCanceled: 0,
            lifetimeEarnings: 0,
            currentMonthEarnings: 0,
            balance: 0,
        },
        performance: {
            rating: 5,
            acceptanceRate: 1,
            onTimeRate: 1
        },
        baseAddress: baseAddressObject
    };

    try {
        await userDocRef.set({ picker: pickerData }, { merge: true });

        const userDoc = await userDocRef.get();
        const userEmail = request.auth.token.email;
        const userName = userDoc.data()?.fullName || 'Picker';

        // ✅ INÍCIO DA NOVA LÓGICA DE E-MAILS
        const emailPromises = [];

        // 1. E-mail para o usuário (como já existia)
        if (userEmail) {
            const userEmailPromise = sendEmail(
                userEmail,
                '✅ Recebemos seu cadastro de Picker!',
                getPickerRegistrationReceivedHTML({ firstName: userName.split(' ')[0] })
            );
            emailPromises.push(userEmailPromise);
        }

        // 2. Novo e-mail para o administrador
        const adminEmail = 'ronaldo.fortini.jr@gmail.com';
        // ATENÇÃO: Substitua 'https://seu-admin-panel.com' pelo link real do seu painel
        const adminPanelLink = `https://seu-admin-panel.com/users/${uid}`;

        const adminEmailHtml = getNewPickerForApprovalEmailHTML({
            pickerName: userName,
            pickerEmail: userEmail || 'E-mail não disponível',
            adminPanelLink: adminPanelLink
        });

        const adminEmailPromise = sendEmail(
            adminEmail,
            `[Aprovação Pendente] Novo Picker: ${userName}`,
            adminEmailHtml,
            "Sistema Picker" // Nome do remetente
        );
        emailPromises.push(adminEmailPromise);

        // Envia os dois e-mails em paralelo para otimizar
        await Promise.all(emailPromises);
        // ✅ FIM DA NOVA LÓGICA DE E-MAILS

        return { success: true, message: "Perfil de picker criado com sucesso!" };
    } catch (error: any) {
        logger.error("Erro ao criar perfil de picker ou enviar e-mails:", error);
        throw new HttpsError("internal", error.message || "Não foi possível criar o perfil de picker.");
    }
});


/**
 * Permite que um picker autenticado atualize suas próprias informações de pagamento.
 */
export const updatePickerPaymentInfo = onCall({ region: "southamerica-east1" }, async (request) => {
    // 1. Segurança: Garante que o usuário está logado
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Autenticação requerida.");
    }
    const uid = request.auth.uid;
    const data = request.data;

    // 2. Validação: Garante que todos os dados necessários foram enviados
    if (!data.pixKey || !data.pixKeyType || !data.pixKeyHolderName) {
        throw new HttpsError("invalid-argument", "Dados de pagamento incompletos.");
    }

    const userDocRef = db.collection("users").doc(uid);

    try {
        // 3. Atualização: Usa a notação de ponto para atualizar apenas os campos dentro de 'paymentInfo'
        await userDocRef.update({
            'picker.paymentInfo.pixKey': data.pixKey,
            'picker.paymentInfo.pixKeyType': data.pixKeyType,
            'picker.paymentInfo.pixKeyHolderName': data.pixKeyHolderName,
        });

        return { success: true, message: "Dados de pagamento atualizados com sucesso!" };

    } catch (error) {
        logger.error(`Erro ao atualizar dados de pagamento para o picker ${uid}:`, error);
        throw new HttpsError("internal", "Não foi possível atualizar seus dados de pagamento no momento.");
    }
});


/**
 * Um picker chama esta função para se atribuir a uma dieta, iniciando o processo de separação.
 */
export const startDietSeparation = onCall({ cpu: 1 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Você precisa estar logado.");
    const pickerUid = request.auth.uid;
    const { dietId } = request.data;
    if (!dietId) throw new HttpsError("invalid-argument", "O ID da dieta é obrigatório.");

    try {
        await db.runTransaction(async (transaction) => {
            const pickerDocRef = db.collection('users').doc(pickerUid);
            const pickerDoc = await transaction.get(pickerDocRef);

            // ✅ MUDANÇA: O caminho para a 'role' foi atualizado para o novo modelo.
            if (!pickerDoc.exists || pickerDoc.data()?.picker?.registrationInfo?.role !== 'picker') {
                throw new HttpsError("permission-denied", "Você não tem permissão de picker.");
            }

            const dietDocRef = db.collection('diets').doc(dietId);
            const dietDoc = await transaction.get(dietDocRef);
            if (!dietDoc.exists) throw new HttpsError("not-found", "A dieta não foi encontrada.");

            const dietData = dietDoc.data();
            if (dietData?.currentStatus.status !== 'confirmed') throw new HttpsError("failed-precondition", `Esta dieta não pode ser iniciada (status: ${dietData?.currentStatus.status}).`);
            if (dietData?.picker) throw new HttpsError("failed-precondition", "Esta dieta já foi atribuída a outro picker.");

            const pickerInfoForDiet = {
                id: pickerUid,
                fullName: pickerDoc.data()?.fullName || 'Picker',
                photoURL: pickerDoc.data()?.photoURL || '',
                email: pickerDoc.data()?.email || '',
                pickedAt: admin.firestore.Timestamp.now(),
                progress: [],
                currentView: 'details'
            };
            const newStatus = { status: 'in_separation_progress' as const, timestamp: admin.firestore.Timestamp.now() };
            transaction.update(dietDocRef, { picker: pickerInfoForDiet, currentStatus: newStatus, statusHistory: admin.firestore.FieldValue.arrayUnion(newStatus) });
        });

        return { success: true, message: "Separação iniciada!" };
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Erro ao iniciar a separação.");
    }
});


/**
 * Permite a um picker reportar um problema com um pedido, podendo opcionalmente iniciar seu cancelamento e estorno.
 */
// export const pickerProblemReport = onCall({ region: "southamerica-east1", cpu: 1 }, async (request) => {
//     if (!request.auth) throw new HttpsError("unauthenticated", "Você precisa estar logado.");

//     const pickerUid = request.auth.uid;
//     const { dietId, category, description, photoUrls, action } = request.data;

//     if (!dietId || !category || (description !== undefined && typeof description !== 'string') || !action) {
//         throw new HttpsError("invalid-argument", "Dados do problema estão incompletos.");
//     }

//     const dietDocRef = db.collection("diets").doc(dietId);
//     const dietDoc = await dietDocRef.get();
//     if (!dietDoc.exists) throw new HttpsError("not-found", "A dieta não foi encontrada.");

//     const dietData = dietDoc.data() as Diet;

//     try {
//         if (dietData.picker?.id !== pickerUid) throw new HttpsError("permission-denied", "Você não tem permissão para reportar um problema nesta dieta.");

//         const problemReportsRef = db.collection("problemReports");
//         const newReportRef = problemReportsRef.doc();

//         const pickerData = (await db.collection('users').doc(pickerUid).get()).data();
//         const reportData = {
//             id: newReportRef.id,
//             dietId,
//             userId: dietData.userId,
//             pickerId: pickerUid,
//             pickerName: pickerData?.fullName || 'Desconhecido',
//             timestamp: admin.firestore.Timestamp.now(),
//             status: "open",
//             category,
//             description: description || 'Nenhum detalhe fornecido.',
//             photos: photoUrls || [],
//             actionTakenByPicker: action,
//         };

//         const promises = [problemReportsRef.doc(newReportRef.id).set(reportData)];
//         if (action !== 'cancel_order') {
//             promises.push(dietDocRef.update({ "picker.status": "problem_reported" }));
//         }
//         await Promise.all(promises);

//         if (action === 'cancel_order') {
//             let cancellationReason = `Cancelado pelo picker. Motivo: ${category}.`;
//             if (description && description.trim()) {
//                 cancellationReason += ` Detalhes: ${description.trim()}`;
//             }

//             try {
//                 const txid = dietData.paymentDetails?.txid;
//                 if (!txid) throw new Error("txid não encontrado para processar o estorno.");

//                 const refundDetails = await _initiatePixRefundLogic(txid, dietData.totalPrice, cancellationReason);

//                 const newStatus = {
//                     status: 'in_refund_progress' as const,
//                     timestamp: admin.firestore.Timestamp.now(),
//                     reason: cancellationReason
//                 };
//                 await dietDocRef.update({
//                     currentStatus: newStatus,
//                     statusHistory: admin.firestore.FieldValue.arrayUnion(newStatus),
//                     refundDetails: refundDetails,
//                     picker: admin.firestore.FieldValue.delete()
//                 });
//             } catch (refundError) {
//                 logger.error(`Falha CRÍTICA ao processar estorno para o pedido [${dietId}].`, refundError);
//                 await dietDocRef.update({
//                     "internalError": `Cancelamento falhou. Erro no estorno: ${(refundError as Error).message}`
//                 });
//                 throw new HttpsError("internal", "O reporte foi salvo, mas o estorno falhou. Suporte notificado.");
//             }
//         }

//         // --- Etapa 3: Enviar e-mails de notificação ---
//         const adminEmailHtml = getNewProblemReportAlertEmailHTML({
//             dietId,
//             pickerName: pickerData?.fullName || 'Desconhecido',
//             reportId: newReportRef.id,
//             category,
//             description: description || 'N/A',
//             adminPanelLink: `https://admin-b5d5a.web.app/reports/${newReportRef.id}`
//         });

//         await sendEmail(
//             'ronaldo.fortini.jr@gmail.com',
//             `[ALERTA] Problema Reportado - Pedido #${dietId.slice(0, 6)}`,
//             adminEmailHtml,
//             "Alerta de Sistema"
//         );

//         if (action === 'cancel_order') {
//             const customerData = (await db.collection('users').doc(dietData.userId).get()).data();
//             if (customerData?.email) {
//                 const firstName = customerData.fullName ? customerData.fullName.split(' ')[0] : 'Cliente';

//                 const customerEmailHtml = getPickerProblemApologyEmailHTML({
//                     firstName: formatFirstName(firstName),
//                     orderId: dietId,
//                 });

//                 await sendEmail(
//                     customerData.email,
//                     `Um imprevisto sobre o seu pedido #${formatOrderIdForDisplay(dietId)}`,
//                     customerEmailHtml,
//                     "Atualização do Pedido"
//                 );
//             }
//         }

//         return { success: true, message: "Problema reportado com sucesso." };

//     } catch (error) {
//         logger.error(`Erro final na função pickerProblemReport para a dieta ${dietId}:`, error);
//         if (error instanceof HttpsError) throw error;
//         throw new HttpsError("internal", "Não foi possível registrar o problema.");
//     }
// });
export const pickerProblemReport = onCall({ region: "southamerica-east1", cpu: 1 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Você precisa estar logado.");

    const pickerUid = request.auth.uid;
    const { dietId, category, description, photoUrls, action } = request.data;

    if (!dietId || !category || (description !== undefined && typeof description !== 'string') || !action) {
        throw new HttpsError("invalid-argument", "Dados do problema estão incompletos.");
    }

    const dietDocRef = db.collection("diets").doc(dietId);
    const dietDoc = await dietDocRef.get();
    if (!dietDoc.exists) throw new HttpsError("not-found", "A dieta não foi encontrada.");

    const dietData = dietDoc.data() as Diet;

    try {
        if (dietData.picker?.id !== pickerUid) throw new HttpsError("permission-denied", "Você não tem permissão para reportar um problema nesta dieta.");

        const problemReportsRef = db.collection("problemReports");
        const newReportRef = problemReportsRef.doc();

        const pickerData = (await db.collection('users').doc(pickerUid).get()).data();
        const reportData = {
            id: newReportRef.id,
            dietId,
            userId: dietData.userId,
            pickerId: pickerUid,
            pickerName: pickerData?.fullName || 'Desconhecido',
            timestamp: admin.firestore.Timestamp.now(),
            status: "open",
            category,
            description: description || 'Nenhum detalhe fornecido.',
            photos: photoUrls || [],
            actionTakenByPicker: action,
        };

        // Cria o registro do problema
        await problemReportsRef.doc(newReportRef.id).set(reportData);

        // Se a ação NÃO for cancelar, apenas atualiza o status na dieta
        if (action !== 'cancel_order') {
            await dietDocRef.update({ "picker.status": "problem_reported" });
        }

        // Se a ação FOR cancelar, executa a lógica completa de cancelamento
        if (action === 'cancel_order') {
            let cancellationReason = `Cancelado pelo picker. Motivo: ${category}.`;
            if (description && description.trim()) {
                cancellationReason += ` Detalhes: ${description.trim()}`;
            }

            let refundDetails;
            try {
                const txid = dietData.paymentDetails?.txid;
                if (!txid) throw new Error("txid não encontrado para processar o estorno.");

                refundDetails = await _initiatePixRefundLogic(txid, dietData.totalPrice, cancellationReason);
            } catch (refundError) {
                logger.error(`Falha CRÍTICA ao processar estorno para o pedido [${dietId}].`, refundError);
                await dietDocRef.update({ "internalError": `Cancelamento falhou. Erro no estorno: ${(refundError as Error).message}` });
                throw new HttpsError("internal", "O reporte foi salvo, mas o estorno falhou. Suporte notificado.");
            }

            // ✅ INÍCIO DA NOVA LÓGICA
            // Referências para os documentos a serem atualizados
            const pickerDocRef = db.collection('users').doc(pickerUid);
            const pickerDietRecordRef = db.collection('pickerDiets').doc(); // Novo registro de dieta do picker

            // Dados para o novo registro na coleção 'pickerDiets'
            const dietRecordData = {
                recordId: pickerDietRecordRef.id,
                pickerId: pickerUid,
                dietId: dietId,
                status: 'canceled_by_picker',
                completedAt: admin.firestore.Timestamp.now(),
                earnings: 0, // Sem ganhos em cancelamento
            };

            // Dados para atualizar a dieta principal
            const newStatus = {
                status: 'in_refund_progress' as const,
                timestamp: admin.firestore.Timestamp.now(),
                reason: cancellationReason
            };

            // Agrupa todas as operações de escrita no banco de dados para serem executadas em paralelo
            await Promise.all([
                // 1. Atualiza a dieta principal (lógica que já existia)
                dietDocRef.update({
                    currentStatus: newStatus,
                    statusHistory: admin.firestore.FieldValue.arrayUnion(newStatus),
                    refundDetails: refundDetails,
                    picker: admin.firestore.FieldValue.delete()
                }),
                // 2. Incrementa o contador de cancelamentos no perfil do picker
                pickerDocRef.update({
                    'picker.metrics.dietsCanceled': admin.firestore.FieldValue.increment(1)
                }),
                // 3. Cria o novo registro de histórico na coleção 'pickerDiets'
                pickerDietRecordRef.set(dietRecordData)
            ]);
            // ✅ FIM DA NOVA LÓGICA
        }

        // --- Lógica de envio de e-mails (permanece a mesma) ---
        const adminEmailHtml = getNewProblemReportAlertEmailHTML({
            dietId,
            pickerName: pickerData?.fullName || 'Desconhecido',
            reportId: newReportRef.id,
            category,
            description: description || 'N/A',
            adminPanelLink: `https://admin-b5d5a.web.app/reports/${newReportRef.id}`
        });

        await sendEmail(
            'ronaldo.fortini.jr@gmail.com',
            `[ALERTA] Problema Reportado - Pedido #${dietId.slice(0, 6)}`,
            adminEmailHtml,
            "Alerta de Sistema"
        );

        if (action === 'cancel_order') {
            const customerData = (await db.collection('users').doc(dietData.userId).get()).data();
            if (customerData?.email) {
                const firstName = customerData.fullName ? customerData.fullName.split(' ')[0] : 'Cliente';
                const customerEmailHtml = getPickerProblemApologyEmailHTML({
                    firstName: formatFirstName(firstName),
                    orderId: dietId,
                });
                await sendEmail(
                    customerData.email,
                    `Um imprevisto sobre o seu pedido #${formatOrderIdForDisplay(dietId)}`,
                    customerEmailHtml,
                    "Atualização do Pedido"
                );
            }
        }

        return { success: true, message: "Problema reportado com sucesso." };

    } catch (error) {
        logger.error(`Erro final na função pickerProblemReport para a dieta ${dietId}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Não foi possível registrar o problema.");
    }
});


/**
 * Recebe uma mensagem de suporte de um picker, salva no Firestore e notifica o admin.
 */
/**
 * Recebe uma mensagem de suporte de um picker, salva no Firestore e notifica admin e picker.
 */
export const sendSupportMessageFromPicker = onCall({ region: "southamerica-east1" }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Autenticação requerida.");
    }
    const uid = request.auth.uid;
    const { subject, message } = request.data;

    if (!subject || !message) {
        throw new HttpsError("invalid-argument", "Assunto e mensagem são obrigatórios.");
    }

    const userDocRef = db.collection("users").doc(uid);
    const supportTicketsRef = db.collection("supportTickets");
    const newTicketRef = supportTicketsRef.doc();

    try {
        const userDoc = await userDocRef.get();
        if (!userDoc.exists) throw new HttpsError("not-found", "Perfil de usuário não encontrado.");

        const userData = userDoc.data();
        const pickerName = userData?.fullName || 'Nome não encontrado';
        const pickerEmail = userData?.email || 'E-mail não encontrado';
        const pickerFirstName = pickerName.split(' ')[0];

        const ticketData = {
            ticketId: newTicketRef.id,
            pickerId: uid,
            pickerName,
            pickerEmail,
            subject,
            message,
            status: 'open',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
        };
        await newTicketRef.set(ticketData);

        // ✅ INÍCIO DA NOVA LÓGICA DE E-MAILS
        const emailPromises = [];

        // 1. E-mail para o Administrador (como já existia)
        const adminEmail = 'ronaldo.fortini.jr@gmail.com';
        const adminPanelLink = `https://seu-admin-panel.com/support/${newTicketRef.id}`;
        const adminEmailHtml = getSupportTicketAlertEmailHTML({
            ticketId: newTicketRef.id,
            pickerName,
            pickerEmail,
            subject,
            message,
            adminPanelLink
        });
        const adminEmailPromise = sendEmail(
            adminEmail,
            `[Suporte Picker] Novo Ticket: ${subject}`,
            adminEmailHtml,
            "Sistema Picker"
        );
        emailPromises.push(adminEmailPromise);

        // 2. Novo e-mail de confirmação para o Picker
        if (pickerEmail) {
            const pickerEmailHtml = getPickerSupportConfirmationEmailHTML({
                firstName: pickerFirstName,
                subject: subject,
            });
            const pickerEmailPromise = sendEmail(
                pickerEmail,
                `Recebemos sua mensagem de suporte`,
                pickerEmailHtml,
                "Suporte Picker"
            );
            emailPromises.push(pickerEmailPromise);
        }

        // Envia todos os e-mails em paralelo
        await Promise.all(emailPromises);
        // ✅ FIM DA NOVA LÓGICA

        return { success: true, message: "Sua mensagem foi enviada com sucesso!" };

    } catch (error) {
        logger.error(`Erro ao enviar ticket de suporte para o picker ${uid}:`, error);
        throw new HttpsError("internal", "Não foi possível enviar sua mensagem no momento.");
    }
});

/**
 * Estima o custo da corrida de entrega para um pedido específico.
 */
export const getRidePriceEstimate = onCall({ region: "southamerica-east1", cpu: 1 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Você precisa estar logado.");
    const { dietId } = request.data;
    if (!dietId) throw new HttpsError("invalid-argument", "O ID da dieta é obrigatório.");
    try {
        const dietDoc = await db.collection("diets").doc(dietId).get();
        if (!dietDoc.exists) throw new HttpsError("not-found", "Dieta não encontrada.");
        const address = dietDoc.data()?.address;
        if (!address) throw new HttpsError("not-found", "Endereço de entrega não encontrado na dieta.");
        const pickupAddressString = "Avenida Edmeia Matos Lazaroti, 1655, Betim, MG";
        const dropoffAddressString = `${address.street}, ${address.number}, ${address.neighborhood}, ${address.city}, ${address.state}`;
        const rideEstimate = await _getRidePriceEstimateLogic(pickupAddressString, dropoffAddressString);
        return {
            success: true,
            lowEstimate: rideEstimate.lowEstimate,
            highEstimate: rideEstimate.highEstimate,
            estimateString: `R$ ${rideEstimate.lowEstimate.toFixed(2).replace('.', ',')} - R$ ${rideEstimate.highEstimate.toFixed(2).replace('.', ',')}`
        };
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Ocorreu um erro ao calcular a estimativa da corrida.");
    }
});

/**
 * Faz o upload da foto do recibo da compra para o Cloud Storage.
 */
export const uploadReceiptPhoto = onCall({ cpu: 1 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Você precisa estar logado.");
    const pickerUid = request.auth.uid;
    const { dietId, fileContent, fileName, fileType } = request.data;
    if (!dietId || !fileContent || !fileName || !fileType) throw new HttpsError("invalid-argument", "Dados da imagem estão incompletos.");
    const storage = admin.storage().bucket();
    try {
        const downloadUrl = await db.runTransaction(async (transaction) => {
            const dietDocRef = db.collection('diets').doc(dietId);
            const dietDoc = await transaction.get(dietDocRef);
            if (!dietDoc.exists) throw new HttpsError("not-found", "Dieta não encontrada.");
            if (dietDoc.data()?.picker?.id !== pickerUid) throw new HttpsError("permission-denied", "Você não está atribuído a esta dieta.");

            const base64Data = fileContent.split(';base64,').pop();
            if (!base64Data) throw new HttpsError("invalid-argument", "Conteúdo Base64 inválido.");

            const fileBuffer = Buffer.from(base64Data, 'base64');
            const filePath = `diets/${dietId}/receipts/receipt_${Date.now()}_${fileName}`;
            const file = storage.file(filePath);
            await file.save(fileBuffer, { metadata: { contentType: fileType } });

            const [url] = await file.getSignedUrl({ action: 'read', expires: '03-09-2491' });
            transaction.update(dietDocRef, { "purchaseDetails.receiptPhotoUrls": admin.firestore.FieldValue.arrayUnion(url) });
            return url;
        });
        return { success: true, downloadUrl };
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Ocorreu um erro durante o upload do recibo.");
    }
});



/**
 * Extrai informações do motorista (nome, placa, etc.) de uma imagem de screenshot de app de corrida.
 */
export const extractDeliveryInfoFromImage = onCall({ cpu: 1, memory: "512MiB", region: "southamerica-east1" }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Você precisa estar logado.");
    const { dietId, screenshotContent, correctionHint } = request.data;
    if (!dietId || !screenshotContent) throw new HttpsError("invalid-argument", "O ID da dieta e o conteúdo da imagem são obrigatórios.");

    const storage = admin.storage().bucket();
    const filePath = `diets/${dietId}/delivery_screenshots/screenshot_${Date.now()}.png`;
    const file = storage.file(filePath);
    try {
        const base64Data = screenshotContent.split(';base64,').pop();
        if (!base64Data) throw new HttpsError("invalid-argument", "Conteúdo Base64 inválido.");
        const imageBuffer = Buffer.from(base64Data, 'base64');
        await file.save(imageBuffer, { metadata: { contentType: 'image/png' } });
        await file.makePublic();
        const publicUrl = file.publicUrl();

        const [result] = await visionClient.textDetection(publicUrl);
        const fullText = result.fullTextAnnotation?.text;
        if (!fullText) throw new HttpsError("not-found", "Nenhum texto foi encontrado na imagem.");

        let extractedInfo;
        if (correctionHint && correctionHint.trim() !== '') {
            // VOLTAMOS a chamar a função local e específica deste arquivo
            extractedInfo = await callGenerativeAIForCorrection(fullText, correctionHint);
        } else {
            extractedInfo = extractInfoWithRegex(fullText);
        }
        return { ...extractedInfo, screenshotUrl: publicUrl };
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Ocorreu um erro ao analisar a imagem do print.");
    }
});

/**
 * Usa Expressões Regulares para tentar extrair os dados do motorista do texto da imagem.
 */
function extractInfoWithRegex(fullText: string): { driverName: string, vehicleInfo: string, licensePlate: string, eta: string } {
    const singleLineText = fullText.split('\n').join(' ');
    const plateMatch = singleLineText.match(/\b[A-Z]{3}[ -]?[0-9][A-Z0-9][0-9]{2}\b/i);
    const licensePlate = plateMatch ? plateMatch[0].toUpperCase().replace('-', '') : "Não identificada";

    let driverName = "Não identificado";
    const nameRegexes = [/(?:motorista|motorista é)\s+([A-ZÀ-Ú][a-zà-ú]+)/i, /encontre\s+([A-ZÀ-Ú][a-zà-ú]+)/i, /([A-ZÀ-Ú][a-zà-ú]+)\s+\(motorista\)/i, /([A-ZÀ-Ú][a-zà-ú]+)\s+está a caminho/i];
    for (const regex of nameRegexes) {
        const nameMatch = singleLineText.match(regex);
        if (nameMatch && nameMatch[1]) {
            driverName = nameMatch[1];
            break;
        }
    }

    let vehicleInfo = "Não identificado";
    const vehicleRegex = /((?:Fiat|VW|Chevrolet|Renault|Hyundai|Toyota|Jeep|Ford)\s+[A-Za-z\s]+)\s+([A-Z]{3,7})/i;
    const vehicleMatch = singleLineText.match(vehicleRegex);
    if (vehicleMatch && vehicleMatch[1]) {
        vehicleInfo = vehicleMatch[1].trim();
    }

    const etaMatch = singleLineText.match(/(?:em|chega em|chega)\s*~?\s*(\d{1,2}\s*min)|(chega\s*às\s*\d{1,2}:\d{2})/i);
    const eta = etaMatch ? (etaMatch[1] || etaMatch[2] || 'Não identificado') : 'Não identificado';

    return { driverName, vehicleInfo, licensePlate, eta };
}

/**
 * Usa IA Generativa para corrigir a extração de dados do motorista quando a tentativa inicial falha.
 */
async function callGenerativeAIForCorrection(fullText: string, hint: string): Promise<any> {
    const prompt = `Analise o texto de um print de app de corrida. A extração inicial falhou. Use a dica do usuário para corrigir. TEXTO: --- ${fullText} --- DICA: "${hint}" TAREFA: Extraia os dados e retorne APENAS um objeto JSON com: driverName, vehicleInfo, licensePlate, eta.`;

    try {
        const secrets = await getSecrets();
        const geminiApiKey = secrets.geminiApiKey;
        if (!geminiApiKey) {
            throw new HttpsError("internal", "A API Key do Gemini não foi encontrada no Secret Manager.");
        }

        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash-latest",
            // Forçamos a resposta JSON aqui, já que esta função sempre precisa disso
            generationConfig: { responseMimeType: "application/json" },
        });

        const result = await model.generateContent(prompt);
        const response = result.response;
        const responseText = response.text();

        if (!responseText) {
            throw new Error("A resposta da IA veio vazia.");
        }

        return JSON.parse(responseText);

    } catch (error) {
        logger.error("Erro na chamada da IA Generativa (GoogleAI) para correção:", error);
        throw new HttpsError("internal", "A IA não conseguiu processar a correção.");
    }
}

/**
 * Um picker chama esta função para iniciar oficialmente a etapa de entrega, mudando o status do pedido.
 */
export const startManualDelivery = onCall({ cpu: 1 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Você precisa estar logado.");
    const pickerUid = request.auth.uid;
    const { dietId, driverName, vehicleInfo, licensePlate, screenshotUrl, eta } = request.data;
    if (!dietId || !driverName || !vehicleInfo || !licensePlate || !screenshotUrl || !eta) {
        throw new HttpsError("invalid-argument", "Todos os campos da entrega são obrigatórios.");
    }
    const dietDocRef = db.collection("diets").doc(dietId);
    try {
        await db.runTransaction(async (transaction) => {
            const dietDoc = await transaction.get(dietDocRef);
            if (!dietDoc.exists) throw new HttpsError("not-found", "Dieta não encontrada.");
            const dietData = dietDoc.data();
            if (dietData?.picker?.id !== pickerUid) throw new HttpsError("permission-denied", "Você não está atribuído a esta dieta.");
            const deliveryDetails = {
                ...(dietData?.deliveryDetails || {}),
                provider: "manual",
                driver: { name: driverName, vehicle: vehicleInfo, licensePlate, eta },
                screenshotUrl,
                updatedAt: admin.firestore.Timestamp.now()
            };
            const newStatus = { status: 'in_delivery_progress' as const, timestamp: admin.firestore.Timestamp.now() };
            transaction.update(dietDocRef, { deliveryDetails, currentStatus: newStatus, statusHistory: admin.firestore.FieldValue.arrayUnion(newStatus) });
        });
        return { success: true, message: "Entrega iniciada e cliente notificado!" };
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Não foi possível iniciar a entrega.");
    }
});

/**
 * Um picker chama esta função para confirmar a finalização da entrega, mudando o status do pedido para 'delivered'.
 */
export const confirmDietDelivered = onCall({ region: "southamerica-east1", cpu: 1 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Você precisa estar logado.");

    const pickerUid = request.auth.uid;
    const { dietId } = request.data;
    if (!dietId) throw new HttpsError("invalid-argument", "O ID da dieta é obrigatório.");

    const dietDocRef = db.collection("diets").doc(dietId);
    const pickerDocRef = db.collection("users").doc(pickerUid);
    const newDietRecordRef = db.collection('pickerDiets').doc();
    const newTransactionRef = db.collection('pickerTransactions').doc();

    const EARNINGS_PER_DIET_IN_CENTS = 990; // R$ 9,90 em centavos

    try {
        await db.runTransaction(async (transaction) => {
            const dietDoc = await transaction.get(dietDocRef);
            if (!dietDoc.exists) throw new HttpsError("not-found", "Pedido não encontrado.");

            const dietData = dietDoc.data() as Diet;
            if (dietData?.picker?.id !== pickerUid) throw new HttpsError("permission-denied", "Você não tem permissão para confirmar a entrega deste pedido.");
            if (dietData?.currentStatus.status !== 'in_delivery_progress') throw new HttpsError("failed-precondition", `Este pedido não está em trânsito (status: ${dietData?.currentStatus.status}).`);

            // 1. Atualiza o status da dieta principal
            const newStatus = { status: "delivered" as const, timestamp: admin.firestore.Timestamp.now() };
            transaction.update(dietDocRef, {
                currentStatus: newStatus,
                statusHistory: admin.firestore.FieldValue.arrayUnion(newStatus)
            });

            // 2. Atualiza as métricas do picker
            transaction.update(pickerDocRef, {
                'picker.metrics.dietsCompleted': admin.firestore.FieldValue.increment(1),
                'picker.metrics.balance': admin.firestore.FieldValue.increment(EARNINGS_PER_DIET_IN_CENTS),
                'picker.metrics.lifetimeEarnings': admin.firestore.FieldValue.increment(EARNINGS_PER_DIET_IN_CENTS),
                'picker.metrics.currentMonthEarnings': admin.firestore.FieldValue.increment(EARNINGS_PER_DIET_IN_CENTS),
            });

            // 3. Cria o registro na coleção de dietas do picker
            const dietRecordData = {
                recordId: newDietRecordRef.id,
                pickerId: pickerUid,
                dietId: dietId,
                status: 'completed',
                completedAt: admin.firestore.Timestamp.now(),
                earnings: EARNINGS_PER_DIET_IN_CENTS,
            };
            transaction.set(newDietRecordRef, dietRecordData);

            // 4. Cria a transação de crédito para o picker
            const transactionData = {
                transactionId: newTransactionRef.id,
                pickerId: pickerUid,
                type: 'credit',
                amount: EARNINGS_PER_DIET_IN_CENTS,
                description: `Crédito Dieta #${dietId.slice(0, 6)}`,
                timestamp: admin.firestore.Timestamp.now(),
                relatedDietId: dietId,
            };
            transaction.set(newTransactionRef, transactionData);
        });

        return { success: true, message: "Entrega confirmada e pagamento creditado!" };

    } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Não foi possível confirmar a entrega.");
    }
});








/**
 * Reverte uma substituição, restaurando o item original na lista de compras.
 */
// export const revertSubstitution = onCall({ region: "southamerica-east1" }, async (request) => {
//     if (!request.auth) throw new HttpsError("unauthenticated", "Usuário não autenticado.");

//     const { dietId, orderItemId } = request.data as { dietId: string; orderItemId: string; };
//     if (!dietId || !orderItemId) throw new HttpsError("invalid-argument", "Dados insuficientes.");

//     const dietDocRef = db.collection("diets").doc(dietId);

//     const dietDoc = await dietDocRef.get();
//     if (!dietDoc.exists) throw new HttpsError("not-found", "O pedido não foi encontrado.");

//     const dietData = dietDoc.data() as Diet;
//     if (dietData.picker?.id !== request.auth.uid) throw new HttpsError("permission-denied", "Acesso negado.");

//     const currentFoods = dietData.selectedFoods || [];
//     const itemIndex = currentFoods.findIndex(item => item.orderItemId === orderItemId && item.isSubstituted);
//     if (itemIndex === -1) throw new HttpsError("not-found", "O item substituído não foi encontrado.");

//     const itemToRevert = currentFoods[itemIndex];
//     if (!itemToRevert.originalFood) throw new HttpsError("failed-precondition", "Não há um alimento original para restaurar.");

//     const revertedItem: FoodItem = {
//         ...itemToRevert,
//         food: itemToRevert.originalFood,
//         quantity: itemToRevert.originalFood.quantity,
//         isSubstituted: false,
//     };
//     delete revertedItem.originalFood;

//     currentFoods[itemIndex] = revertedItem;
//     await dietDocRef.update({ selectedFoods: currentFoods });

//     return { success: true, message: "Substituição revertida!" };
// });


type TotalNutrientsProfile = {
    totalEnergy: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
};

// As funções e interfaces que já existiam e são usadas pela função principal
// =========================================================================

interface SubstituteRequestData {
    dietId: string;
    originalFood: Food;
    originalFoodQuantity: number;
    triedSubstituteIds: string[];
    orderItemId: string;
}

let allFoodsCache: Food[] | null = null;
let cacheTimestamp: number | null = null;
const CACHE_DURATION_MS = 15 * 60 * 1000;

async function fetchAllFoodsCached(): Promise<Food[]> {
    const now = Date.now();
    if (allFoodsCache && cacheTimestamp && (now - cacheTimestamp < CACHE_DURATION_MS)) {
        logger.info("Retornando a lista de alimentos do cache.");
        return allFoodsCache;
    }
    logger.info("Cache de alimentos expirado ou inexistente. Buscando no Firestore.");
    const foodsSnapshot = await db.collection("foods").get();
    allFoodsCache = foodsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Food));
    cacheTimestamp = now;
    return allFoodsCache;
}

const allowedFoodsCache = new Map<string, string[]>();

async function filterFoodListWithAICached(allFoods: Food[], healthProfile: HealthProfile, provider: 'GEMINI'): Promise<string[]> {
    const profileKey = JSON.stringify(healthProfile);
    if (allowedFoodsCache.has(profileKey)) {
        logger.info("Retornando lista de alimentos permitidos pela IA do cache.");
        return allowedFoodsCache.get(profileKey)!;
    }
    logger.info("Cache de IA não encontrado para este perfil. Chamando a IA.");
    const allowedFoodNames = await filterFoodListWithAI(allFoods, healthProfile, provider);
    allowedFoodsCache.set(profileKey, allowedFoodNames);
    return allowedFoodNames;
}

function calculateEquivalentQuantity(originalTotalEnergy: number, substituteFood: Food): { equivalentQuantity: number } {
    if (substituteFood.variableWeight === false) {
        return { equivalentQuantity: substituteFood.quantity };
    }
    const substituteEnergyPerGram = (substituteFood.nutritional_info_per_100g.energy || 1) / 100;
    const quantity = substituteEnergyPerGram > 0 ? Math.round(originalTotalEnergy / substituteEnergyPerGram) : 0;
    return { equivalentQuantity: quantity };
}


function calculateSimilarityScore(originalTotals: TotalNutrientsProfile, substituteTotals: TotalNutrientsProfile): number {
    const WEIGHTS = {
        energy: 1.5,
        protein: 1.5,
        carbs: 1.0,
        fat: 0.8
    };
    const energyDifference = Math.abs(originalTotals.totalEnergy - substituteTotals.totalEnergy) / (originalTotals.totalEnergy || 1);
    const proteinDifference = Math.abs(originalTotals.totalProtein - substituteTotals.totalProtein) / (originalTotals.totalProtein || 1);
    const carbsDifference = Math.abs(originalTotals.totalCarbs - substituteTotals.totalCarbs) / (originalTotals.totalCarbs || 1);
    const fatDifference = Math.abs(originalTotals.totalFat - substituteTotals.totalFat) / (originalTotals.totalFat || 1);
    const score =
        (energyDifference * WEIGHTS.energy) +
        (proteinDifference * WEIGHTS.protein) +
        (carbsDifference * WEIGHTS.carbs) +
        (fatDifference * WEIGHTS.fat);
    return score;
}

// =========================================================================
// ✅ NOVA FUNÇÃO AUXILIAR PARA CENTRALIZAR A LÓGICA DE PONTUAÇÃO E VALIDAÇÃO
// =========================================================================

/**
 * Calcula a pontuação de um candidato, validando e ajustando sua quantidade
 * de acordo com o limite semanal e a quantidade mínima prática.
 * @returns Um objeto com o candidato, sua pontuação e quantidade efetiva.
 * Retorna score: Infinity se o candidato for inválido.
 */
function scoreCandidate(
    candidate: Food,
    originalTotals: TotalNutrientsProfile,
    currentQuantitiesMap: Map<string, number>,
    config: { minPracticalQuantity: number; scoreMethod: 'similarity' | 'caloric' }
): { food: Food; score: number; effectiveQuantity: number; } {

    // 1. Calcula o espaço real disponível para o candidato na dieta
    const alreadyInDietAmount = currentQuantitiesMap.get(candidate.id) || 0;
    const remainingAllowed = candidate.max_weekly_g_per_person
        ? candidate.max_weekly_g_per_person - alreadyInDietAmount
        : Infinity; // Se não houver limite, o espaço é "infinito"

    // 2. Invalida o candidato se não houver espaço para a quantidade mínima
    if (remainingAllowed < config.minPracticalQuantity) {
        return { food: candidate, score: Infinity, effectiveQuantity: 0 };
    }

    // 3. Calcula a quantidade ideal baseada nas calorias do item original
    const { equivalentQuantity: calorieEquivalentQuantity } = calculateEquivalentQuantity(originalTotals.totalEnergy, candidate);

    // 4. APLICA A CORREÇÃO: A quantidade final é o MENOR valor entre a ideal e a permitida
    const finalQuantity = Math.min(calorieEquivalentQuantity, remainingAllowed);

    // 5. Invalida se a quantidade final, após o ajuste, se tornou impraticável
    if (finalQuantity < config.minPracticalQuantity) {
        return { food: candidate, score: Infinity, effectiveQuantity: 0 };
    }

    // 6. Calcula a pontuação com base na quantidade final e correta
    const substituteTotals = calculateTotalNutrients(candidate, finalQuantity);
    let score: number;

    if (config.scoreMethod === 'similarity') {
        score = calculateSimilarityScore(originalTotals, substituteTotals);
    } else { // 'caloric'
        score = Math.abs(originalTotals.totalEnergy - substituteTotals.totalEnergy);
    }

    return { food: candidate, score, effectiveQuantity: finalQuantity };
}


// ========================================================================================
// ✅ FUNÇÃO findAndReplaceSubstitute REFATORADA COM INTELIGÊNCIA ARTIFICIAL
// ========================================================================================

export const findAndReplaceSubstitute = onCall({ region: "southamerica-east1", memory: "1GiB", timeoutSeconds: 120 }, async (request) => {
    // 1. Validação e Segurança (sem alterações)
    if (!request.auth) throw new HttpsError("unauthenticated", "Usuário não autenticado.");
    const { dietId, originalFood, originalFoodQuantity, triedSubstituteIds, orderItemId } = request.data as SubstituteRequestData;
    if (!dietId || !originalFood || !orderItemId || !originalFoodQuantity) throw new HttpsError("invalid-argument", "Dados insuficientes.");
    const dietDocRef = db.collection("diets").doc(dietId);
    const dietDoc = await dietDocRef.get();
    if (!dietDoc.exists) throw new HttpsError("not-found", "Dieta não encontrada.");
    const dietData = dietDoc.data() as Diet;
    if (dietData.picker?.id !== request.auth.uid) throw new HttpsError("permission-denied", "Acesso negado.");

    // 2. Preparação e Constantes (sem alterações)
    const healthProfile = dietData.healthProfile;
    const allFoods = await fetchAllFoodsCached();
    const allowedFoodNames = await filterFoodListWithAICached(allFoods, healthProfile, 'GEMINI');
    const originalItemTotalNutrients = calculateTotalNutrients(originalFood, originalFoodQuantity);

    const MINIMUM_PRACTICAL_QUANTITY = 30;
    const TOP_N_FOR_AI = 4; // Número de candidatos a enviar para a IA

    const currentQuantitiesMap = new Map<string, number>();
    (dietData.selectedFoods || []).forEach(item => {
        const currentAmount = currentQuantitiesMap.get(item.food.id) || 0;
        currentQuantitiesMap.set(item.food.id, currentAmount + item.quantity);
    });

    // 3. Filtragem de Candidatos Base (sem alterações)
    const baseCandidates = allFoods.filter(candidate => {
        return allowedFoodNames.includes(candidate.standard_name) &&
            candidate.id !== originalFood.id &&
            !triedSubstituteIds.includes(candidate.id);
    });
    if (baseCandidates.length === 0) throw new HttpsError("not-found", "Nenhum substituto foi encontrado após a filtragem inicial.");

    // 4. LÓGICA DE BUSCA: Coleta e pontuação de todos os candidatos viáveis
    const foodIdsInDiet = (dietData.selectedFoods || []).map(item => item.food.id);
    const allScoredCandidates: { food: Food; score: number; effectiveQuantity: number; }[] = [];
    const originalMacro = getMainMacronutrient(originalFood);

    const candidatesLvl1And2 = baseCandidates.filter(c => c.category === originalFood.category && !foodIdsInDiet.includes(c.id));
    const candidatesLvl3 = baseCandidates.filter(c => c.variableWeight === true && !foodIdsInDiet.includes(c.id) && getMainMacronutrient(c) === originalMacro);
    const candidatesLvl4 = baseCandidates.filter(c => c.variableWeight === true && getMainMacronutrient(c) === originalMacro);

    // Pontua e adiciona todos os candidatos de todos os níveis a uma única lista
    allScoredCandidates.push(...candidatesLvl1And2.map(c => scoreCandidate(c, originalItemTotalNutrients, currentQuantitiesMap, { minPracticalQuantity: MINIMUM_PRACTICAL_QUANTITY, scoreMethod: 'similarity' })));
    allScoredCandidates.push(...candidatesLvl3.map(c => scoreCandidate(c, originalItemTotalNutrients, currentQuantitiesMap, { minPracticalQuantity: MINIMUM_PRACTICAL_QUANTITY, scoreMethod: 'caloric' })));
    allScoredCandidates.push(...candidatesLvl4.map(c => scoreCandidate(c, originalItemTotalNutrients, currentQuantitiesMap, { minPracticalQuantity: MINIMUM_PRACTICAL_QUANTITY, scoreMethod: 'caloric' })));

    // Deduplicar a lista, mantendo apenas a melhor pontuação para cada alimento
    const candidatesMap = new Map<string, { food: Food; score: number; effectiveQuantity: number; }>();
    for (const candidate of allScoredCandidates) {
        if (candidate.score === Infinity) continue;
        const existing = candidatesMap.get(candidate.food.id);
        if (!existing || candidate.score < existing.score) {
            candidatesMap.set(candidate.food.id, candidate);
        }
    }

    const uniqueBestCandidates = Array.from(candidatesMap.values()).sort((a, b) => a.score - b.score);

    if (uniqueBestCandidates.length === 0) {
        throw new HttpsError("not-found", "Nenhum substituto compatível foi encontrado que respeite todos os limites.");
    }

    // 5. REFINAMENTO COM IA: Seleciona o melhor candidato da lista
    let bestCandidate = uniqueBestCandidates[0]; // Define o melhor candidato do algoritmo como fallback
    const topCandidatesForAI = uniqueBestCandidates.slice(0, TOP_N_FOR_AI);

    // Otimização: se só houver 1 candidato, não gasta uma chamada de IA
    if (topCandidatesForAI.length > 1) {
        const originalFoodDescription = `${originalFood.standard_name} (categoria: ${originalFood.category}, principal macronutriente: ${getMainMacronutrient(originalFood)})`;
        const candidatesJSON = topCandidatesForAI.map(c => ({
            id: c.food.id,
            nome: c.food.standard_name,
            quantidade: `${c.effectiveQuantity}g`,
            descricao: `categoria: ${c.food.category}, principal macronutriente: ${getMainMacronutrient(c.food)}`
        }));

        const prompt = `
            Você é um assistente de nutrição e culinária. Sua tarefa é escolher o substituto mais coerente para um alimento indisponível.
            O alimento original é: "${originalFoodDescription}", na quantidade de ${originalFoodQuantity}g.
            Abaixo estão ${candidatesJSON.length} candidatos pré-selecionados. A quantidade deles já foi ajustada para equivalência nutricional.
            Escolha o melhor substituto com base na coerência culinária, tipo de uso, textura e sabor, para além dos nutrientes. Por exemplo, um grão deve ser substituído por outro grão ou leguminosa, não por um vegetal.

            Candidatos:
            ${JSON.stringify(candidatesJSON, null, 2)}

            Analise as opções e retorne APENAS um objeto JSON com o ID do candidato escolhido. Não inclua nenhuma outra palavra, explicação ou markdown.
            O formato da resposta deve ser exatamente: {"best_candidate_id": "id_do_alimento_escolhido"}
        `;

        try {
            logger.info(`Chamando IA para refinar a escolha entre ${topCandidatesForAI.length} candidatos.`);
            const aiResponseString = await callAI(prompt, 'GEMINI', true);
            const aiResponse = JSON.parse(aiResponseString);
            const chosenId = aiResponse.best_candidate_id;

            const aiChoice = topCandidatesForAI.find(c => c.food.id === chosenId);

            if (aiChoice) {
                bestCandidate = aiChoice;
                logger.info(`IA escolheu: ${aiChoice.food.standard_name}. (Escolha do algoritmo era: ${uniqueBestCandidates[0].food.standard_name})`);
            } else {
                logger.warn(`IA retornou um ID inválido ('${chosenId}'). Usando o melhor candidato do algoritmo como fallback.`);
            }
        } catch (error) {
            logger.error("Erro ao chamar a IA para refinar a substituição. Usando o melhor candidato do algoritmo como fallback.", error);
        }
    }

    // 6. Finalização (usa o 'bestCandidate' escolhido pela IA ou pelo fallback)
    const { food: substituteFood, effectiveQuantity } = bestCandidate;
    logger.info(`Substituto final escolhido: ${substituteFood.standard_name}. Quantidade: ${effectiveQuantity}g`);

    let newExplanation = '';
    try {
        newExplanation = await generateExplanationForSingleFood(substituteFood, dietData.interpretedPrompt.explanation || "para uma alimentação balanceada.", 'GEMINI');
    } catch (error) {
        logger.error("Falha ao gerar nova explicação para o alimento substituto.", error);
    }

    const currentFoods = dietData.selectedFoods || [];
    const itemIndex = currentFoods.findIndex(item => item.orderItemId === orderItemId);
    if (itemIndex === -1) throw new HttpsError("not-found", "Item a ser substituído não encontrado.");

    const itemToSubstitute = currentFoods[itemIndex];
    const updatedItem: FoodItem = {
        ...itemToSubstitute,
        food: substituteFood,
        quantity: effectiveQuantity,
        isSubstituted: true,
        originalFood: itemToSubstitute.originalFood || itemToSubstitute.food,
        originalQuantity: itemToSubstitute.originalQuantity || itemToSubstitute.quantity,
        explanationInDiet: newExplanation || itemToSubstitute.explanationInDiet,
    };
    currentFoods[itemIndex] = updatedItem;

    await dietDocRef.update({ selectedFoods: currentFoods });

    logger.info(`Substituição realizada com sucesso para o item ${orderItemId} na dieta ${dietId}.`);
    return { success: true, message: "Substituição realizada com sucesso.", substitute: updatedItem };
});


// A função de reverter permanece a mesma
// =========================================================================

export const revertSubstitution = onCall({ region: "southamerica-east1" }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Usuário não autenticado.");

    const { dietId, orderItemId } = request.data as { dietId: string; orderItemId: string; };
    if (!dietId || !orderItemId) throw new HttpsError("invalid-argument", "Dados insuficientes.");

    const dietDocRef = db.collection("diets").doc(dietId);

    const dietDoc = await dietDocRef.get();
    if (!dietDoc.exists) throw new HttpsError("not-found", "O pedido não foi encontrado.");

    const dietData = dietDoc.data() as Diet;
    if (dietData.picker?.id !== request.auth.uid) throw new HttpsError("permission-denied", "Acesso negado.");

    const currentFoods = dietData.selectedFoods || [];
    const itemIndex = currentFoods.findIndex(item => item.orderItemId === orderItemId && item.isSubstituted);
    if (itemIndex === -1) throw new HttpsError("not-found", "O item substituído não foi encontrado.");

    const itemToRevert = currentFoods[itemIndex];
    if (!itemToRevert.originalFood) throw new HttpsError("failed-precondition", "Não há um alimento original para restaurar.");

    const revertedItem: FoodItem = {
        ...itemToRevert,
        food: itemToRevert.originalFood,
        quantity: itemToRevert.originalFood.quantity,
        isSubstituted: false,
    };
    delete revertedItem.originalFood;

    currentFoods[itemIndex] = revertedItem;
    await dietDocRef.update({ selectedFoods: currentFoods });

    return { success: true, message: "Substituição revertida!" };
});