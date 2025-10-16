import { Timestamp } from "firebase-admin/firestore";
export { Timestamp } from "firebase-admin/firestore";


export interface JobDiet {
    status: string;
    processedStep: string | null;
    progressLog: string[];
    createdAt: Timestamp;
    userId: string;
    error: boolean;
    finished: boolean;
    isCancelled: boolean;
    inputData: {
        healthProfile: HealthProfile;
        address: Address;
        selectedGoals: string[];
        // ✨ TIPO CORRIGIDO: de 'string' para um tipo mais específico ✨
        aiProvider: 'GEMINI' | 'OPENAI';
    };

    // ✨ PROPRIEDADE ADICIONADA: Campo para dados temporários ✨
    // Usamos 'any' porque a estrutura deste campo muda a cada passo do processo.
    intermediateData?: any;

    errorMessage?: string;
    dietId?: string;
}

// NOVA INTERFACE ADICIONADA: Armazena o resultado da interpretação do prompt do usuário.
export interface InterpretedPrompt {
    applicableGoalKeys: string[];
    prioritizedNutrients: (keyof NutritionalInfo)[];
    foodsToInclude: string[];
    foodsToAvoid: string[];
    explanation: string;
    originalPrompt: string;
    isBudgetFriendly?: boolean;
}

export interface Diet {
    id: string;
    userId: string;

    userEmail: string;
    userFullName: string;
    userPhone: string;
    userAvatarUrl?: string;
    healthProfile: HealthProfile;

    nutritionalValuesTarget: NutritionalInfo;
    nutritionalValuesGetted: NutritionalInfo;

    // A MUDANÇA PRINCIPAL ACONTECE AQUI
    interpretedPrompt: InterpretedPrompt; // ANTES: selectedGoals: string[];
    aiProvider: string;

    selectedFoods?: FoodItem[];
    foodItemsCount?: number;
    address: Address;

    totalPrice: number;
    totalEstimatedFoodsPrice: number;
    totalEstimatedDeliveryPrice: number;

    totalEstimatedWeightInGrams: number;

    currentStatus: StatusHistoryEntry;
    statusHistory: StatusHistoryEntry[];
    timestamp: Timestamp | Date;

    problemReport?: ProblemReport;
    dietExplanation?: string;

    picker?: {
        id: string;
        fullName: string;
        photoURL: string;
        email: string;
        progress?: FoodItem[];
        pickedAt: Timestamp | Date;
        currentView?: 'details' | 'payment' | 'receipt' | 'delivery';
    }

    purchaseDetails?: {
        pixCode?: string;
        isPaid?: boolean;
        paymentConfirmedAt?: Timestamp | Date;
        totalAmount?: number;
        currency?: string;
        storeName?: string;
        receiptPhotoUrls?: string[];
        // CAMPOS ADICIONADOS PARA O FLUXO DE PAYOUT
        status?: string;
        txid?: string;
        endToEndId?: string;
        paymentInitiatedAt?: Timestamp | Date;
    };

    deliveryDetails?: {
        driver?: {
            eta?: string,
            licensePlate?: string,
            name?: string,
            vehicle?: string
        }
        ridePayment?: {
            endToEndId?: string,
            isPaid?: boolean,
            paymentConfirmedAt?: Timestamp,
            pixCode?: string,
            recipientName?: string,
            totalAmount?: number,
            txid?: string
        }
        provider?: string,
        updatedAt?: Timestamp,
        screenshotUrl?: string
    },

    returnRequest?: {
        reason: string;
        requestedAt: Timestamp;
        status: string;
        actionTaken: 'cancel_order' | 'contact_support';
    };

    support?: SupportInfo;
    paymentDetails?: PaymentDetails;
    shippingAdjustmentPaymentDetails?: PaymentDetails;
    refundDetails?: RefundDetails;
    deliveryScheduledFor?: Timestamp;

    recalculatedForCost?: boolean
    pendingReminderSent?: boolean
}


// O restante do arquivo permanece o mesmo...
export type DietStatusType = "pending" | "confirmed" | "in_separation_progress" | "in_delivery_progress" | "delivered" | "in_refund_progress" | "cancelled";

export interface RefundDetails {
    refundId: string;
    rtrId: string;
    status: string;
    amount: number;
    requestedAt: Timestamp;
    reason: string;
}

export interface PaymentDetails {
    method: string;
    status: string;
    txid: string;
    copiaECola: string;
    qrCodeImage?: string;
    qrCodeImageUrl: string;
    createdAt: Timestamp;
    paymentConfirmedAt?: Timestamp;
    lastManualCheckAt?: Timestamp;
    endToEndId?: string;
}

export interface ProblemReport {
    reportedAt: Timestamp | Date;
    pickerId: string;
    description: string;
    actionTaken: 'cancel_order' | 'contact_support';
}

export interface ReturnRequest {
    requestedAt: Timestamp | Date;
    reason: string;
    status: 'pending_review' | 'approved' | 'rejected';
}

export interface SupportInfo {
    chatStatus: 'open' | 'resolved';
    userUnreadCount: number;
    supportUnreadCount: number;
    lastChatMessage: {
        text: string;
        timestamp: Timestamp;
        senderType: 'user' | 'support';
        senderId?: string;
    };
    adminIsTyping?: boolean;
}

export interface ChatMessage {
    id: string;
    senderId: string;
    senderType: 'user' | 'support';
    text: string;
    timestamp: any;
    isRead?: boolean;
}

export interface DateSeparator {
    type: 'dateSeparator';
    date: string;
}

export interface MessageItem {
    type: 'message';
    message: ChatMessage;
    status?: 'pending';
}

export type ChatItem = MessageItem | DateSeparator;

export interface HelpOption {
    id: string;
    title: string;
    description: string;
    action: 'call_function' | 'show_info' | 'show_form';
    functionName?: 'requestOrderCancellation' | 'requestOrderReturn';
    formType?: 'cancel_form' | 'problem_form';
}

export interface DateGroupedMessages {
    date: string;
    messages: ChatMessage[];
}

export interface StatusHistoryEntry {
    status: DietStatusType;
    timestamp: Timestamp | Date;
    reason?: string
}

export const dietGoalDictionary: { [key: string]: string } = {
    'general': 'General',
    'muscle_gain': 'Muscle Gain',
    'fat_loss': 'Fat Loss',
    'skin_health': 'Skin Health',
    'energy_boost': 'Energy Boost',
    'gut_health': 'Gut Health',
    'hair_and_nails': 'Hair & Nails',
    'cognitive_function': 'Cognitive Function',
    'reduce_bloating': 'Reduce Bloating',
    'physical_performance': 'Physical Performance'
};

export const dietGoalDictionaryPT: { [key: string]: string } = {
    'general': 'Saúde em Geral',
    'muscle_gain': 'Ganho de Massa Muscular 💪',
    'fat_loss': 'Perda de Gordura',
    'skin_health': 'Saúde da Pele',
    'energy_boost': 'Aumento de Energia 🔋',
    'gut_health': 'Saúde Intestinal',
    'hair_and_nails': 'Cabelo e Unhas 💅',
    'cognitive_function': 'Função Cognitiva 🧠',
    'reduce_bloating': 'Reduzir Inchaço',
    'physical_performance': 'Performance Física'
} as const;

export type CategoryKey = keyof typeof dietGoalDictionaryPT;

export const priorityConceptDictionary: { [key: string]: string } = {
    'vitamins': 'Vitaminas',
    'antioxidants': 'Antioxidantes',
    'minerals': 'Minerais',
    'omega-3': 'Ômega 3', // Adicionado para cobrir a variação com hífen
    'omega-6': 'Ômega 6',
    // Adicione outros termos gerais que possam aparecer
};

export interface SubstituteItem {
    food: Food;
    quantity: number;
    shopping_units: number;
}

// export interface FoodItem {
//     food: Food;
//     quantity: number;
//     isSubstituted: boolean;
//     originalFood?: Food;
//     orderItemId: string;
// }

export interface FoodItem {
    food: Food; // Objeto completo do alimento (standard_name, category, etc.)
    quantity: number; // Quantidade sugerida
    isSubstituted?: boolean; // Se foi uma substituição
    originalFood?: Food; // Alimento original (se substituído)
    orderItemId: string;
    // ✨ NOVO CAMPO ✨
    explanationInDiet?: string; // Ex: 'O Salmão é rico em Ômega-3, essencial para o seu objetivo de saúde cardiovascular.'
    originalQuantity?: number;

}

export interface Food {
    id: string;
    standard_name: string;
    synonyms: string[];
    category: FoodCategory;
    tags: FoodTag[];
    processing: ProcessingType;
    seasonality: string[];
    glycemic_index?: number;
    nutritional_info_per_100g: NutritionalInfo;
    estimatedPrice: number;
    variableWeight?: boolean;
    quantity: number;
    default_unit: string;
    weight_per_unit_in_g?: string;
    imageUrl?: string;
    pickingInstructions?: string;
    max_weekly_g_per_person?: number;
}

export type FoodCategory = keyof typeof categoryDictionary;
export type DefaultUnit = keyof typeof defaultUnitDictionary;
export type ProcessingType = keyof typeof processingDictionary;
export type FoodTag = keyof typeof tagDictionary;

export interface NutritionalInfo {
    energy: number; carbohydrates: number; sugars: number; fiber: number;
    starch: number; proteins: number; total_fat: number; saturated_fat: number;
    trans_fat: number; monounsaturated_fat: number; polyunsaturated_fat: number;
    cholesterol: number; water: number; vitamin_a: number; vitamin_b1: number;
    vitamin_b2: number; vitamin_b3: number; vitamin_b5: number; vitamin_b6: number;
    vitamin_b7: number; vitamin_b9: number; vitamin_b12: number; vitamin_c: number;
    vitamin_d: number; vitamin_e: number; vitamin_k: number; calcium: number;
    iron: number; magnesium: number; phosphorus: number; potassium: number;
    zinc: number; sodium: number; copper: number; manganese: number;
    selenium: number; iodine: number; chromium: number; molybdenum: number;
    silicon: number; vanadium: number; omega_3: number; omega_6: number;
}

// NOVO DICIONÁRIO PARA NUTRIENTES
export const nutritionalInfoDictionary: { [key in keyof NutritionalInfo]: string } = {
    energy: "Energia",
    carbohydrates: "Carboidratos",
    sugars: "Açúcares",
    fiber: "Fibras",
    starch: "Amido",
    proteins: "Proteínas",
    total_fat: "Gordura Total",
    saturated_fat: "Gordura Saturada",
    trans_fat: "Gordura Trans",
    monounsaturated_fat: "Gordura Monoinsaturada",
    polyunsaturated_fat: "Gordura Poliinsaturada",
    cholesterol: "Colesterol",
    water: "Água",
    vitamin_a: "Vitamina A",
    vitamin_b1: "Vitamina B1 (Tiamina)",
    vitamin_b2: "Vitamina B2 (Riboflavina)",
    vitamin_b3: "Vitamina B3 (Niacina)",
    vitamin_b5: "Vitamina B5 (Ác. Pantotênico)",
    vitamin_b6: "Vitamina B6 (Piridoxina)",
    vitamin_b7: "Vitamina B7 (Biotina)",
    vitamin_b9: "Vitamina B9 (Folato)",
    vitamin_b12: "Vitamina B12 (Cobalamina)",
    vitamin_c: "Vitamina C",
    vitamin_d: "Vitamina D",
    vitamin_e: "Vitamina E",
    vitamin_k: "Vitamina K",
    calcium: "Cálcio",
    iron: "Ferro",
    magnesium: "Magnésio",
    phosphorus: "Fósforo",
    potassium: "Potássio",
    zinc: "Zinco",
    sodium: "Sódio",
    copper: "Cobre",
    manganese: "Manganês",
    selenium: "Selênio",
    iodine: "Iodo",
    chromium: "Cromo",
    molybdenum: "Molibdênio",
    silicon: "Silício",
    vanadium: "Vanádio",
    omega_3: "Ômega 3",
    omega_6: "Ômega 6",
};

export const categoryDictionary: { [key: string]: string } = {
    cereal: "cereal", legume: "legume", fruit: "fruit", vegetable: "vegetable",
    animal_protein: "animal_protein", dairy: "dairy", nut: "nut", seed: "seed",
    fat: "fat", sweetener: "sweetener", beverage: "beverage", coffee_tea: "coffee_tea",
    condiment: "condiment", spice: "spice", sauce: "sauce", bakery: "bakery",
    dessert: "dessert", canned_goods: "canned_goods",
};

export const defaultUnitDictionary: { [key: string]: string } = {
    g: "g", ml: "ml", unit: "unit(s)", kg: "kg", l: "l",
};

export const processingDictionary: { [key: string]: string } = {
    unprocessed: "unprocessed", minimally_processed: "minimally_processed",
    processed: "processed", ultra_processed: "ultra_processed",
};

export const tagDictionary: { [key: string]: string } = {
    vegan: "vegan", vegetarian: "vegetarian", pescatarian: "pescatarian", gluten_free: "gluten_free",
    dairy_free: "dairy_free", low_sugar: "low_sugar", high_fiber: "high_fiber", low_fat: "low_fat",
    high_protein: "high_protein", low_sodium: "low_sodium", low_calorie: "low_calorie", low_carbs: "low_carbs",
    high_iron: "high_iron", high_calcium: "high_calcium", antioxidants: "antioxidants", keto: "keto",
    paleo: "paleo", organic: "organic", non_gmo: "non_gmo", whole_grain: "whole_grain",
    fermented: "fermented", nut_free: "nut_free", soy_free: "soy_free", refined: "refined",
    processed: "processed", ultra_processed: "ultra_processed",
};

export interface Address {
    id: string;
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
    isDefault?: boolean;
}

export interface HealthProfile {
    healthConditions: string[];
    allergies: string[];
    currentMedications: string[];
    dietaryRestrictions: string[];
    favoriteFoods?: string[];
    activityLevel: string;
    isActivityLevelDetailed: boolean;
    activityLevelDetail: string;
    bodyFatLevel: string; // 1. Magro(a) | 2. Atlético(a) | 3. Em Forma | 4. Acima do Peso;
    bodyFatPercentage: number;
    metabolism?: string;
    sex: string;
    height: number;
    weight: number;
    dateOfBirth: string;
}

export interface UserProfile {
    isProfileComplete?: boolean,
    email: string;
    password: string;
    fullName: string;
    photoURL: string;
    nationalId: string;
    phone: string;
    addresses?: Address[];
    healthProfile: HealthProfile;
    timestamp: Timestamp | Date;
    uid: string;
    pendingEmail?: string;
    emailChangeToken?: string;
    emailChangeTokenExpires?: any;
    personalDataEditedAt?: Timestamp | Date;
    picker?: {
        // --- INFORMAÇÕES DE CADASTRO ---
        // (Agrupadas para melhor organização)
        registrationInfo: {
            role: 'pending_approval' | 'picker' | 'rejected' | 'customer'; // Adicione 'rejected' e 'customer' se ainda não tiver
            registeredAt: Timestamp | Date;
            documentBackUrl: string;
            documentFrontUrl: string;
            selfieWithDocUrl: string;
        };

        // --- INFORMAÇÕES DE PAGAMENTO ---
        paymentInfo: {
            pixKey: string;
            pixKeyHolderName: string;
            pixKeyType: string;
        };

        // --- MÉTRICAS E ESTATÍSTICAS AGREGADAS ---
        // (Dados numéricos para carregar rapidamente no modal)
        metrics: {
            dietsCompleted: number;
            dietsCanceled: number;
            lifetimeEarnings: number; // Ganhos totais (em centavos para evitar problemas com ponto flutuante)
            currentMonthEarnings: number; // Ganhos no mês (em centavos)
            balance: number; // Saldo atual a ser pago (em centavos)
        };

        // --- DADOS DE PERFORMANCE ---
        performance?: {
            rating: number; // Média de 0 a 5
            acceptanceRate: number; // Taxa de aceitação de pedidos (0 a 1)
            onTimeRate: number; // Taxa de entrega no prazo (0 a 1)
        };
        baseAddress?: Address; 
    }
    themePreference?: 'dark' | 'light' | 'system';
    dietCount?: number;
}

export interface PickerDietRecord {
    recordId: string; // ID do próprio registro
    pickerId: string; // UID do picker (para consultas)
    dietId: string;   // ID da dieta original
    status: 'completed' | 'canceled_by_picker' | 'canceled_by_system';
    completedAt: Timestamp | Date;
    earnings: number; // Ganhos com esta dieta (em centavos)
}

export interface PickerTransaction {
    transactionId: string;
    pickerId: string; // UID do picker (para consultas)
    type: 'credit' | 'debit' | 'payout'; // Crédito (dieta), Débito (taxa), Saque (pagamento)
    amount: number; // Valor (em centavos)
    description: string; // Ex: "Crédito Dieta #A4B1C2", "Pagamento Semanal"
    timestamp: Timestamp | Date;
    relatedDietId?: string; // Opcional, para ligar a uma dieta específica
}