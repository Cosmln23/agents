/**
 * MULTI-TENANT CLIENT CONFIG
 * Definiție interfață pentru configurație client (agenție de recrutare)
 */

export interface ClientConfig {
  // IDENTIFICARE CLIENT
  clientId: string;                    // Ex: "logistics_nl_001"
  agencyName: string;                  // Ex: "Logistics Staffing NL"

  // CONTACT WHATSAPP
  twilioWhatsappNumber: string;        // Numărul care PRIMEȘTE mesajele
                                       // Ex: "+31612345678" (Olanda)
                                       // SAU: "555099999" (Twilio sandbox)

  // DATABASE JOBURI
  googleSheetId: string;               // ID Google Sheet CSV

  // CONFIGURARE LIMBĂ
  systemLanguage: "nl" | "ro" | "en" | "de"; // Limba promptului AI

  // EMAIL NOTIFICĂRI
  notificationEmail: string;           // Email HR care primește match-uri

  // COMPLIANCE & DATA RETENTION (Segment 2 - GDPR/EU AI Act)
  dataRetentionDays?: number;          // Ex: 30, 90. Default fallback: 30 zile
                                       // Calculat: today + dataRetentionDays = data_retention_date

  // METADATE OPTIONAL
  country?: string;                    // Ex: "Netherlands"
  timezone?: string;                   // Ex: "Europe/Amsterdam"
  jobCategories?: string[];            // Ex: ["logistics", "healthcare"]

  // FLAG ENABLE/DISABLE
  isActive: boolean;                   // True = client activ
}
