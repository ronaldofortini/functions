import { https } from "firebase-functions";
import { HealthProfile, NutritionalInfo } from "../models/models";

interface Modifier {
  multipliers?: Partial<NutritionalInfo>;
  additions?: Partial<NutritionalInfo>;
  set?: Partial<NutritionalInfo>;
}

export interface CalculationResult {
  targets: NutritionalInfo;
}

function createEmptyNutritionalInfo(): NutritionalInfo {
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

function calculateAge(dateString: string): number {
  const parts = dateString.split('/');
  if (parts.length !== 3) return 0;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);
  const birthDate = new Date(year, month, day);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

const baseMicronutrientTargets: Partial<NutritionalInfo> = {
  // --- Macronutrientes (já definidos, mas listados para clareza) ---
  fiber: 30, // g

  // --- Minerais Principais ---
  sodium: 2300,      // mg
  potassium: 3500,     // mg
  calcium: 1000,       // mg
  phosphorus: 700,     // mg (ADICIONADO)
  magnesium: 400,      // mg
  
  // --- Minerais Traço ---
  iron: 18,          // mg
  zinc: 11,          // mg
  copper: 0.9,       // mg (ADICIONADO)
  manganese: 2.3,      // mg (ADICIONADO)
  selenium: 55,        // mcg (ADICIONADO)
  iodine: 150,         // mcg (ADICIONADO)
  chromium: 35,        // mcg (ADICIONADO)
  molybdenum: 45,      // mcg (ADICIONADO)

  // --- Vitaminas Lipossolúveis ---
  vitamin_a: 900,      // mcg
  vitamin_c: 90,       // mg
  vitamin_d: 15,       // mcg
  vitamin_e: 15,       // mg
  vitamin_k: 120,      // mcg

  // --- Vitaminas do Complexo B ---
  vitamin_b1: 1.2,       // mg (Tiamina) (ADICIONADO)
  vitamin_b2: 1.3,       // mg (Riboflavina) (ADICIONADO)
  vitamin_b3: 16,        // mg (Niacina) (ADICIONADO)
  vitamin_b5: 5,         // mg (Ácido Pantotênico) (ADICIONADO)
  vitamin_b6: 1.7,       // mg (Piridoxina)
  vitamin_b7: 30,        // mcg (Biotina) (ADICIONADO)
  vitamin_b9: 400,       // mcg (Folato)
  vitamin_b12: 2.4,      // mcg (Cobalamina)

  // --- Ácidos Graxos Essenciais ---
  omega_3: 1.5,        // g (ADICIONADO)
  omega_6: 15,         // g (ADICIONADO)
};


const goalModifiers: { [key: string]: Modifier } = {
  'general': {},
  'muscle_gain': { multipliers: { energy: 1.10, proteins: 1.3, carbohydrates: 1.1 } },
  'fat_loss': { multipliers: { energy: 0.82, proteins: 1.2, fiber: 1.2 } },
  'skin_health': { multipliers: { vitamin_c: 1.8, vitamin_a: 1.2, vitamin_e: 1.3, zinc: 1.3, selenium: 1.5, total_fat: 0.9 } },
  'energy_boost': { multipliers: { iron: 1.25, vitamin_b12: 1.6, vitamin_b6: 1.4, magnesium: 1.2 } },
  'gut_health': { additions: { fiber: 15 } },
  'hair_and_nails': { multipliers: { proteins: 1.15, zinc: 1.4, iron: 1.1, vitamin_b7: 2.0, selenium: 1.3 } },
  'cognitive_function': { multipliers: { vitamin_b12: 1.3, vitamin_e: 1.3, zinc: 1.1 }, additions: { omega_3: 1.5 } },
  'reduce_bloating': { multipliers: { sodium: 0.65, potassium: 1.3 }, additions: { fiber: 5 } },
  'physical_performance': { multipliers: { carbohydrates: 1.20, potassium: 1.3, sodium: 1.2, magnesium: 1.2 } }
};

const restrictionModifiers: { [key: string]: Modifier } = {
  'diabetes': { multipliers: { sugars: 0.5, fiber: 1.25, carbohydrates: 0.8 } },
  'hipertensao': { set: { sodium: 1500 }, multipliers: { potassium: 1.2 } },
  'vegano': { multipliers: { iron: 1.8, vitamin_b12: 1.5, calcium: 1.2 } },
  'vegetariano': { multipliers: { iron: 1.5, vitamin_b12: 1.2 } }
};


function estimateBodyFatPercentageFromLevel(level: string, sex: 'male' | 'female'): number {
    const levelNum = parseInt(level, 10);
    if (sex === 'male') {
        switch (levelNum) {
            case 1: return 12; // Magro
            case 2: return 15; // Atlético
            case 3: return 21; // Em Forma
            case 4: return 28; // Acima do Peso
            default: return 0;
        }
    } else { // female
        switch (levelNum) {
            case 1: return 19; // Magra
            case 2: return 21; // Atlética
            case 3: return 30; // Em Forma
            case 4: return 35; // Acima do Peso
            default: return 0;
        }
    }
}


/**
 * Calcula as metas nutricionais diárias com base no perfil de saúde e nas chaves de objetivo.
 * @param profile O perfil de saúde do usuário.
 * @param goalKeys Um array de chaves de objetivo (ex: 'muscle_gain') extraídas pela IA.
 * @returns Um objeto `CalculationResult` com as metas nutricionais.
 */
export async function calculateNutritionalTargets(profile: HealthProfile, goalKeys: string[]): Promise<CalculationResult> {
  if (!profile.weight || !profile.height || !profile.dateOfBirth || !profile.sex) {
    throw new https.HttpsError("invalid-argument", "Peso, altura, data de nascimento e sexo são obrigatórios.");
  }
  const age = calculateAge(profile.dateOfBirth);

  let effectiveBodyFatPercentage = profile.bodyFatPercentage;

  if (!effectiveBodyFatPercentage || effectiveBodyFatPercentage <= 0) {
      if (profile.bodyFatLevel) {
          effectiveBodyFatPercentage = estimateBodyFatPercentageFromLevel(profile.bodyFatLevel, profile.sex as 'male' | 'female');
      }
  }

  let tdee: number;

  if (effectiveBodyFatPercentage && effectiveBodyFatPercentage > 0) {
    const leanBodyMass = profile.weight * (1 - (effectiveBodyFatPercentage / 100));
    const bmr = 370 + (21.6 * leanBodyMass);
    
    const activityMultipliers: { [key: string]: number } = {
        '1': 1.2, '2': 1.375, '3': 1.55, '4': 1.725, '5': 1.9
    };
    tdee = bmr * (activityMultipliers[profile.activityLevel] || 1.55);

  } else {
    let bmr: number;
    if (profile.sex.toLowerCase() === 'male') {
      bmr = (10 * profile.weight) + (6.25 * profile.height) - (5 * age) + 5;
    } else {
      bmr = (10 * profile.weight) + (6.25 * profile.height) - (5 * age) - 161;
    }
    
    const activityMultipliers: { [key: string]: number } = {
        '1': 1.2, '2': 1.375, '3': 1.55, '4': 1.725, '5': 1.9
    };
    tdee = bmr * (activityMultipliers[profile.activityLevel] || 1.55);
  }

  const targets = {
    ...createEmptyNutritionalInfo(),
    ...baseMicronutrientTargets,
    energy: tdee
  };

  const baseProteinGrams = profile.weight * 1.6;
  const baseFatGrams = (targets.energy * 0.25) / 9;
  const baseCarbGrams = (targets.energy - (baseProteinGrams * 4) - (baseFatGrams * 9)) / 4;

  targets.proteins = baseProteinGrams;
  targets.total_fat = baseFatGrams;
  targets.carbohydrates = baseCarbGrams;
  
  (goalKeys || []).forEach(goalKey => {
    const modifier = goalModifiers[goalKey];
    if (modifier) {
      if (modifier.multipliers) {
        for (const key in modifier.multipliers) {
          const nutrientKey = key as keyof NutritionalInfo;
          const factor = modifier.multipliers[nutrientKey];
          if (typeof targets[nutrientKey] === 'number' && factor) {
            (targets[nutrientKey] as number) *= factor;
          }
        }
      }
      if (modifier.additions) {
        for (const key in modifier.additions) {
          const nutrientKey = key as keyof NutritionalInfo;
          const value = modifier.additions[nutrientKey];
          if (typeof targets[nutrientKey] === 'number' && value) {
            (targets[nutrientKey] as number) += value;
          }
        }
      }
    }
  });

  const allRestrictions = [...(profile.healthConditions || []), ...(profile.dietaryRestrictions || [])].map(r => r.toLowerCase());

  allRestrictions.forEach(restrictionKey => {
    const modifier = restrictionModifiers[restrictionKey];
    if (modifier) {
      if (modifier.multipliers) {
        for (const key in modifier.multipliers) {
          const nutrientKey = key as keyof NutritionalInfo;
          const factor = modifier.multipliers[nutrientKey];
          if (typeof targets[nutrientKey] === 'number' && factor) {
            (targets[nutrientKey] as number) *= factor;
          }
        }
      }
      if (modifier.additions) {
        for (const key in modifier.additions) {
          const nutrientKey = key as keyof NutritionalInfo;
          const value = modifier.additions[nutrientKey];
          if (typeof targets[nutrientKey] === 'number' && value) {
            (targets[nutrientKey] as number) += value;
          }
        }
      }
      if (modifier.set) {
        for (const key in modifier.set) {
          const nutrientKey = key as keyof NutritionalInfo;
          const value = modifier.set[nutrientKey];
          if (value !== undefined) {
            targets[nutrientKey] = value;
          }
        }
      }
    }
  });

  for (const key in targets) {
    const nutrientKey = key as keyof NutritionalInfo;
    if (typeof targets[nutrientKey] === 'number') {
      (targets[nutrientKey] as number) = parseFloat((targets[nutrientKey] as number).toFixed(2));
    }
  }

  if (targets.proteins < 0 || targets.total_fat < 0 || targets.carbohydrates < 0) {
    throw new https.HttpsError("failed-precondition", "O cálculo resultou em macronutrientes negativos. Verifique os dados do perfil.");
  }
  
  return {
    targets
  };
}