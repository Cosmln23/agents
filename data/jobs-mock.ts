/**
 * JOBS MOCK DATA - Date de Test pentru Job Matching
 *
 * @description
 *   Listă de joburi fictive pentru testarea fluxului de matching.
 *   În producție, acestea vor fi înlocuite cu date reale din:
 *   - Google Sheets (via googleSheetId din ClientConfig)
 *   - CRM / ATS (Applicant Tracking System)
 *   - Database proprie
 *
 * @usage
 *   import { MOCK_JOBS_BY_CLIENT } from "./data/jobs-mock";
 *   const jobs = MOCK_JOBS_BY_CLIENT["default_001"];
 *   const result = await calculateJobMatch(session, jobs, clientConfig);
 *
 * @format
 *   Fiecare job urmează interfața Job din job-matcher.ts:
 *   { jobId, jobTitle, city, salary, requiredSkills, requiredExperience,
 *     requiredLanguageLevel, niceToHaveSkills, description }
 */

import { Job } from "../job-matcher";

// ============================================
// JOBURI LOGISTICĂ - OLANDA (Default Client + Logistics NL)
// ============================================

const JOBS_LOGISTICS_NL: Job[] = [
  {
    jobId: "NL-LOG-001",
    jobTitle: "Reach Truck Driver",
    city: "Den Haag",
    salary: "€13.50/h + 25% tură noapte",
    requiredSkills: ["Reach Truck", "EPT", "Scanner RF"],
    requiredExperience: 1, // minim 1 an
    requiredLanguageLevel: "A2", // Baza de engleză sau olandeză
    niceToHaveSkills: ["VCA", "Forklift", "SAP"],
    description: "Operare stivuitor Reach Truck în depozit modern Rotterdam/Den Haag. Tură fixă 06:00-14:00 sau 14:00-22:00. Pachet de relocare disponibil.",
  },
  {
    jobId: "NL-LOG-002",
    jobTitle: "Transport Coordinator",
    city: "Rotterdam",
    salary: "€2.800 - €3.200/lună",
    requiredSkills: ["Transport coordination", "Microsoft Office", "Planificare logistică"],
    requiredExperience: 2, // minim 2 ani
    requiredLanguageLevel: "B1", // Engleză sau olandeză nivel mediu
    niceToHaveSkills: ["SAP", "TMS software", "Permis categoria B"],
    description: "Coordonare transport internațional și domestic. Office Rotterdam, program 09:00-17:00. Posibilitate lucru hibrid după perioada de probă.",
  },
  {
    jobId: "NL-LOG-003",
    jobTitle: "Logistics Worker / Order Picker",
    city: "Amsterdam",
    salary: "€12.50/h + bonusuri productivitate",
    requiredSkills: ["Order picking", "Scanare coduri de bare"],
    requiredExperience: 0, // fără experiență minimă
    requiredLanguageLevel: "A1", // Minim limbaj de bază
    niceToHaveSkills: ["Scanner RF", "Cunoștințe depozit", "EPT"],
    description: "Picking și packing comenzi în centru logistic Amsterdam. Training complet la angajare. Potrivit și pentru candidați fără experiență.",
  },
  {
    jobId: "NL-LOG-004",
    jobTitle: "Warehouse Supervisor",
    city: "Eindhoven",
    salary: "€3.500 - €4.000/lună",
    requiredSkills: ["Supervizare echipă", "Microsoft Office", "Raportare", "Coordonare depozit"],
    requiredExperience: 4, // minim 4 ani
    requiredLanguageLevel: "B2", // Engleză sau olandeză nivel mediu-avansat
    niceToHaveSkills: ["SAP WMS", "Lean/5S", "Certificare manager"],
    description: "Supervizare echipă de 15-20 persoane în depozit Eindhoven. Responsabilitate operațională completă pe tură. Pachet salarial atractiv + bonus anual.",
  },
  {
    jobId: "NL-LOG-005",
    jobTitle: "International Driver (Cat. CE)",
    city: "Rotterdam - Rute Europa",
    salary: "€3.000 - €3.800/lună + diurnă",
    requiredSkills: ["Permis categoria CE", "Tahograf digital", "Transport internațional"],
    requiredExperience: 2,
    requiredLanguageLevel: "A2",
    niceToHaveSkills: ["Certificat CPC", "ADR (mărfuri periculoase)", "Cunoștințe rutiere Europa"],
    description: "Șofer TIR rute Europa (RO-NL-DE-BE). Plecare din Rotterdam. Diurnă + cazare asigurată pe traseu. Camion nou (2024), GPS, telefon de serviciu.",
  },
];

// ============================================
// JOBURI SĂNĂTATE - ROMÂNIA (Health Client)
// ============================================

const JOBS_HEALTH_RO: Job[] = [
  {
    jobId: "RO-MED-001",
    jobTitle: "Asistent Medical Generalist",
    city: "București",
    salary: "5.000 - 6.500 RON/lună",
    requiredSkills: ["Asistență medicală", "Îngrijire pacienți", "Administrare medicamente"],
    requiredExperience: 1,
    requiredLanguageLevel: "A1",
    niceToHaveSkills: ["BLS/CPR", "EKG", "Experiență ATI"],
    description: "Asistent medical în spital privat București. Program 12/24h. Echipamente moderne, colectiv tânăr.",
  },
  {
    jobId: "RO-MED-002",
    jobTitle: "Îngrijitor Bătrâni la Domiciliu",
    city: "Cluj-Napoca",
    salary: "4.500 RON/lună",
    requiredSkills: ["Îngrijire vârstnici", "Răbdare", "Empatie"],
    requiredExperience: 0,
    requiredLanguageLevel: "A1",
    niceToHaveSkills: ["Certificat îngrijitor", "Permis B", "Experiență voluntariat"],
    description: "Îngrijire personalizată la domiciliu Cluj. Program flexibil. Training inclus. Candidații fără experiență sunt bineveniți.",
  },
];

// ============================================
// INDEX PRINCIPAL: JOBS PE CLIENT
// ============================================

/**
 * Map de joburi indexate după clientId
 * Folosit în app.ts pentru a obține joburile clientului curent
 *
 * @example
 *   const jobs = MOCK_JOBS_BY_CLIENT[clientConfig.clientId]
 *               ?? MOCK_JOBS_BY_CLIENT["default_001"];
 */
export const MOCK_JOBS_BY_CLIENT: Record<string, Job[]> = {
  // Default client → joburi logistică NL (cel mai comun caz de test)
  "default_001": JOBS_LOGISTICS_NL,

  // Logistics NL client
  "logistics_nl_001": JOBS_LOGISTICS_NL,

  // Health Romania client
  "health_ro_001": JOBS_HEALTH_RO,
};
