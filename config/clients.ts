/**
 * MOCK CLIENTS - 2 Agenții de HR fictive pentru testing
 * În producție, acestea vor veni din database
 */

import { ClientConfig } from "../types/ClientConfig";

// ============================================
// MOCK DATA - 2 CLIENȚI FICTIVI
// ============================================

export const MOCK_CLIENTS: Record<string, ClientConfig> = {
  // CLIENT 1: Logistics Staffing (Olanda)
  logistics_nl_001: {
    clientId: "logistics_nl_001",
    agencyName: "Logistics Staffing NL",
    twilioWhatsappNumber: "+31612345678", // Olanda
    googleSheetId: "2PACX-1vR3FVLbOc0qgViEyDeU4i4-UoDxN9syRXBCY8fCsqdlquPnLDxkWYHYrOhi2XzUNf0TMvQ3dcMQ7ljh", // V3 actual
    systemLanguage: "nl",
    notificationEmail: "hr-logistics@logistics-nl.com",
    dataRetentionDays: 30, // GDPR compliance - 30 zile
    country: "Netherlands",
    timezone: "Europe/Amsterdam",
    jobCategories: ["logistics", "warehouse", "driver"],
    isActive: true,
  },

  // CLIENT 2: Health Staffing (România)
  health_ro_001: {
    clientId: "health_ro_001",
    agencyName: "Health Staffing Romania",
    twilioWhatsappNumber: "+40712345678", // România
    googleSheetId: "1EXAMPLE-HEALTH-GOOGLE-SHEET-ID-PLACEHOLDER", // Placeholder
    systemLanguage: "ro",
    notificationEmail: "hr-health@health-ro.com",
    dataRetentionDays: 90, // GDPR compliance - 90 zile pentru sector medical
    country: "Romania",
    timezone: "Europe/Bucharest",
    jobCategories: ["healthcare", "nursing", "medical"],
    isActive: true,
  },
};

// ============================================
// DEFAULT CLIENT (fallback)
// ============================================

export const DEFAULT_CLIENT: ClientConfig = {
  clientId: "default_001",
  agencyName: "Default Staffing Agency",
  twilioWhatsappNumber: "555099999", // Twilio sandbox
  googleSheetId: "2PACX-1vR3FVLbOc0qgViEyDeU4i4-UoDxN9syRXBCY8fCsqdlquPnLDxkWYHYrOhi2XzUNf0TMvQ3dcMQ7ljh",
  systemLanguage: "ro",
  notificationEmail: "trade.nimsoc09@gmail.com",
  dataRetentionDays: 30, // GDPR default - 30 zile
  country: "Default",
  timezone: "UTC",
  jobCategories: ["general"],
  isActive: true,
};

// ============================================
// FUNCȚIE DE LOOKUP - Căuta client după "To" number
// ============================================

/**
 * Găsește ClientConfig pe bază de numărul de WhatsApp primit
 * @param toNumber - Numărul pe care s-a primit mesajul (din metadata.display_phone_number sau message.to)
 * @returns ClientConfig sau DEFAULT_CLIENT dacă nu se găsește
 */
export function getClientConfig(toNumber: string | undefined): ClientConfig {
  if (!toNumber) {
    console.warn("⚠️ Niciun 'To' number găsit, folosesc DEFAULT_CLIENT");
    return DEFAULT_CLIENT;
  }

  // Normalizare: scoate spații și caractere speciale
  const normalizedNumber = toNumber.replace(/\D/g, "");

  // Caută în MOCK_CLIENTS
  for (const client of Object.values(MOCK_CLIENTS)) {
    const clientNumber = client.twilioWhatsappNumber.replace(/\D/g, "");
    if (normalizedNumber.endsWith(clientNumber) || clientNumber.endsWith(normalizedNumber)) {
      console.log(`✅ Client găsit: ${client.agencyName} (${client.clientId})`);
      return client;
    }
  }

  console.warn(`⚠️ Client nu găsit pentru number "${toNumber}", folosesc DEFAULT_CLIENT`);
  return DEFAULT_CLIENT;
}

// ============================================
// EXPORT - LISTA CLIENȚI ACTIVI (pentru debug)
// ============================================

export function listActiveClients(): ClientConfig[] {
  return Object.values(MOCK_CLIENTS).filter(client => client.isActive);
}
