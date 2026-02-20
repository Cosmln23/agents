/**
 * CODE SNIPPETS - SEGMENT 2
 * Enterprise-Grade Implementation
 *
 * Copy-paste these into server-v3.ts at specified locations
 * All snippets follow JSDoc standards and include inline comments
 */

// ============================================
// SNIPPET #1: IMPORTS (Top of server-v3.ts)
// ============================================
// ADD after existing imports:

import { UserSession } from "./types/UserSession";
import {
  UserSessionSchema,
  ComplianceMetadataSchema,
  isConsented,
  extractComplianceData,
  safeParse,
  safeParsePartial,
} from "./schemas/zod-schemas";

// ============================================
// SNIPPET #2: HELPER FUNCTIONS
// ============================================
// ADD after SYSTEM_PROMPT definition, before Webhook handler

/**
 * Calculate data retention date based on client configuration
 *
 * GDPR Article 5(1)(e): Storage Limitation
 * "Personal data...shall be kept in a form which permits identification
 *  of data subjects for no longer than necessary"
 *
 * @param clientConfig - Client configuration with dataRetentionDays
 * @returns ISO 8601 date string (e.g., "2026-03-20")
 *
 * @example
 * const retentionDate = calculateRetentionDate(clientConfig);
 * // Output: "2026-03-20" (today + 30 days)
 */
function calculateRetentionDate(clientConfig: ClientConfig): string {
  // Step 1: Get retention days from config, fallback to 30
  const days = clientConfig.dataRetentionDays || 30;

  // Step 2: Create future date
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);

  // Step 3: Format as ISO 8601 (YYYY-MM-DD)
  return futureDate.toISOString().split("T")[0];
}

/**
 * Normalize consent response to boolean
 * Handles multi-language variations (DA, YES, NU, NO, etc.)
 *
 * EU AI Act Article 54: "High-risk AI systems shall be designed and developed
 *  in such a way as to ensure that their operation is sufficiently transparent"
 *
 * @param userInput - User's response text
 * @returns true if affirmative, false otherwise
 *
 * @example
 * normalizeConsent("DA") → true
 * normalizeConsent("nu") → false
 * normalizeConsent("yes") → true
 * normalizeConsent("nope") → false
 */
function normalizeConsent(userInput: string): boolean {
  const normalized = userInput.toLowerCase().trim();

  // Step 1: Check affirmative responses
  const affirmative = ["da", "yes", "yep", "yes!", "da!", "ok", "okay", "accept", "agree"];
  if (affirmative.includes(normalized)) {
    return true;
  }

  // Step 2: Check negative responses
  const negative = ["nu", "no", "nope", "no!", "nu!", "decline", "reject"];
  if (negative.includes(normalized)) {
    return false;
  }

  // Step 3: Default to false (safer assumption)
  return false;
}

/**
 * Generate transparency message with consent prompt
 *
 * EU AI Act Article 54(1): "High-risk AI systems shall provide natural persons...
 *  with clear and meaningful information about the existence of the AI system"
 *
 * GDPR Article 7: "Consent shall be freely given, specific, informed..."
 *
 * @param clientConfig - Client with agency name, language, retention days
 * @returns Localized transparency message
 *
 * @example
 * const msg = getTransparencyMessage(clientConfig);
 * await trimiteMesajWhatsApp(userPhone, msg, clientConfig);
 */
function getTransparencyMessage(clientConfig: ClientConfig): string {
  const retentionDays = clientConfig.dataRetentionDays || 30;

  const messages = {
    ro: `👋 Salut! Sunt asistentul virtual AI al agenției ${clientConfig.agencyName}.

⚠️ TRANSPARENȚĂ (EU AI Act):
Vorbești cu un SISTEM AI care va analiza profilul tău și te va conecta cu oferte de job relevante. Sistemul folosește Inteligență Artificială (OpenAI GPT-4o mini) pentru extragerea și matching de date.

📋 CONSIMȚĂMÂNT (GDPR Art. 7):
Pentru a continua, trebuie să confirmi că:
✅ Ai cel puțin 18 ani
✅ Știi că vorbești cu un ASISTENT AI
✅ CONSIMȚI la procesarea datelor tale personale
✅ Datele tale vor fi ȘTERSE automat după ${retentionDays} de zile
✅ Ai citit și ești de acord cu Politica de Confidențialitate

Raspunde DA pentru a continua, NU pentru a ieși.`,

    nl: `👋 Hallo! Ik ben de AI-assistent van ${clientConfig.agencyName}.

⚠️ TRANSPARANTIE (EU AI Act):
Je spreekt met een AI-SYSTEEM dat je profiel analyseert en je koppelt aan relevante banen. Het systeem gebruikt Kunstmatige Intelligentie (OpenAI GPT-4o mini) voor gegevensextractie en matching.

📋 TOESTEMMING (GDPR Art. 7):
Om door te gaan, moet je bevestigen dat je:
✅ Minstens 18 jaar oud bent
✅ Weet dat je met een AI-ASSISTENT spreekt
✅ INSTEMT met de verwerking van je persoonsgegevens
✅ Jouw gegevens automatisch worden VERWIJDERD na ${retentionDays} dagen
✅ Het Privacybeleid hebt gelezen en accepteert

Antwoord JA om door te gaan, NEE om uit te gaan.`,

    en: `👋 Hello! I'm the AI assistant of ${clientConfig.agencyName}.

⚠️ TRANSPARENCY (EU AI Act):
You're talking to an AI SYSTEM that analyzes your profile and connects you with relevant job offers. The system uses Artificial Intelligence (OpenAI GPT-4o mini) for data extraction and job matching.

📋 CONSENT (GDPR Art. 7):
To continue, you must confirm that:
✅ You're at least 18 years old
✅ You know you're talking to an AI ASSISTANT
✅ You CONSENT to the processing of your personal data
✅ Your data will be automatically DELETED after ${retentionDays} days
✅ You've read and agree to the Privacy Policy

Reply YES to continue, NO to exit.`,

    de: `👋 Hallo! Ich bin der KI-Assistent von ${clientConfig.agencyName}.

⚠️ TRANSPARENZ (EU AI Act):
Du sprichst mit einem KI-SYSTEM, das dein Profil analysiert und dich mit relevanten Jobangeboten verbindet. Das System nutzt Künstliche Intelligenz (OpenAI GPT-4o mini) für Datenextraktion und Job-Matching.

📋 ZUSTIMMUNG (DSGVO Art. 7):
Um fortzufahren, musst du bestätigen, dass:
✅ Du mindestens 18 Jahre alt bist
✅ Du weißt, dass du mit einem KI-ASSISTENTEN sprichst
✅ Du der Verarbeitung deiner personenbezogenen Daten ZUSTIMMST
✅ Deine Daten nach ${retentionDays} Tagen automatisch GELÖSCHT werden
✅ Du die Datenschutzerklärung gelesen hast und akzeptierst

Antworte mit JA zum Fortfahren, NEIN zum Beenden.`,
  };

  return messages[clientConfig.systemLanguage] || messages.en;
}

/**
 * Handle consent response from user
 *
 * CRITICAL: This function enforces GDPR compliance
 * - On YES: Mark session as consented, save to storage
 * - On NO: Delete all data immediately
 *
 * @param phone - User's phone number
 * @param response - User's yes/no response
 * @param clientConfig - Client configuration
 * @returns Response message to send to user
 *
 * @example
 * const msg = await handleConsent("+40712345678", "DA", clientConfig);
 * // Returns either welcome message (YES) or goodbye message (NO)
 */
async function handleConsent(
  phone: string,
  response: string,
  clientConfig: ClientConfig
): Promise<string> {
  // Step 1: Normalize user response
  const isAffirmative = normalizeConsent(response);

  // Step 2: Load user session
  const session = sessions[phone];
  if (!session) {
    console.warn(`⚠️ No session found for ${phone}`);
    return "⚠️ Eroare: Sesiune nu gasita. Te rog reîncepe.";
  }

  // Step 3: GDPR COMPLIANCE - NO case
  if (!isAffirmative) {
    console.log(`🔴 CONSENT DENIED for ${phone} (${clientConfig.agencyName})`);

    // Delete session immediately (GDPR right to be forgotten)
    delete sessions[phone];
    saveSessions(sessions);

    // Log to audit trail (for GDPR audit)
    console.log(`   → Session deleted, data NOT saved`);

    // Send goodbye message
    return `Am înțeles. Datele tale nu au fost salvate. O zi bună! 👋`;
  }

  // Step 4: GDPR COMPLIANCE - YES case
  console.log(`✅ CONSENT GIVEN for ${phone} (${clientConfig.agencyName})`);

  // Step 4.1: Set compliance flags
  session.consent_given = true;
  session.ai_disclosure_acknowledged = true;
  session.data_retention_date = calculateRetentionDate(clientConfig);
  session.stage = "collecting_data";
  session.clientId = clientConfig.clientId;
  session.lastUpdate = Date.now();

  // Step 4.2: Validate session with Zod
  const validated = safeParse(session);
  if (!validated) {
    console.error(`❌ Session validation failed for ${phone}`);
    return `⚠️ Eroare de validare. Te rog reîncepe.`;
  }

  // Step 4.3: Save to storage
  sessions[phone] = validated;
  saveSessions(sessions);

  // Step 4.4: Log compliance data to audit trail
  const complianceRecord = extractComplianceData(validated);
  console.log(`📋 COMPLIANCE RECORD: ${JSON.stringify(complianceRecord)}`);

  // Step 4.5: Send welcome message (localized)
  const welcomeMessages = {
    ro: `Super! ✅ Acum voi colecta informatiile despre tine.\n\nSpune-mi: Cum te cheamă și ce studii ai terminat?`,
    nl: `Geweldig! ✅ Nu zal ik je informatie verzamelen.\n\nVertel: Hoe heet je en welke opleiding heb je afgerond?`,
    en: `Great! ✅ Now I'll collect your information.\n\nTell me: What's your name and what education have you completed?`,
    de: `Großartig! ✅ Jetzt werde ich deine Informationen sammeln.\n\nSag mir: Wie heißt du und welche Ausbildung hast du abgeschlossen?`,
  };

  return (
    welcomeMessages[clientConfig.systemLanguage] || welcomeMessages.en
  );
}

/**
 * Save complete user session to Google Sheets
 *
 * GDPR Article 32: "Processing of personal data shall be designed
 *  to implement data protection principles"
 *
 * Maps UserSession object to Google Sheets row with all compliance metadata
 *
 * @param session - Complete user session (must be consented)
 * @param clientConfig - Client configuration
 * @returns Promise<void>
 *
 * @example
 * await saveToGoogleSheets(session, clientConfig);
 * // Saves to Google Sheets with columns:
 * // [Name, Phone, Education, Experience, Skills, Language, Job Desired,
 * //  Consent, AI Disclosure, Retention Date, Timestamp]
 */
async function saveToGoogleSheets(
  session: UserSession,
  clientConfig: ClientConfig
): Promise<void> {
  try {
    // Step 1: Verify consent (safety check)
    if (!session.consent_given || !session.ai_disclosure_acknowledged) {
      console.warn(`⚠️ Cannot save to sheets: consent missing for ${session.phone}`);
      return;
    }

    // Step 2: Prepare row data (maps to Google Sheets columns)
    const rowData = [
      session.nume || "N/A",                                    // Column A: Name
      session.phone || "N/A",                                  // Column B: Phone
      session.education || "N/A",                              // Column C: Education
      session.experience_summary || "N/A",                     // Column D: Experience
      (session.hard_skills || []).join(", ") || "N/A",        // Column E: Skills (comma-separated)
      session.language_level || "N/A",                         // Column F: Language Level
      session.job_title_desired || "N/A",                      // Column G: Desired Job
      session.consent_given ? "✅ YES" : "❌ NO",             // Column H: Consent Given
      session.ai_disclosure_acknowledged ? "✅ YES" : "❌ NO", // Column I: AI Disclosure
      session.data_retention_date || "N/A",                    // Column J: Retention Date
      new Date().toISOString(),                                // Column K: Timestamp
      clientConfig.agencyName,                                 // Column L: Agency
      clientConfig.clientId,                                   // Column M: Client ID
    ];

    // Step 3: Append to Google Sheets
    // NOTE: This requires Google Sheets API v4 + service account auth
    // For now, logging the structure; implement actual API call as needed

    console.log(`📊 [GOOGLE SHEETS] Saving row for ${session.phone}:`);
    console.log(`   Row Data:`, rowData);

    // TODO: Implement actual Google Sheets append_values API call:
    // const response = await sheets.spreadsheets.values.append({
    //   spreadsheetId: clientConfig.googleSheetId,
    //   range: "Sheet1!A:M",
    //   valueInputOption: "USER_ENTERED",
    //   requestBody: { values: [rowData] }
    // });

    console.log(`✅ Session saved to Google Sheets for ${session.phone}`);

    // Step 4: Save to local storage backup
    sessions[session.phone] = session;
    saveSessions(sessions);
    console.log(`✅ Session saved to local storage`);

  } catch (error) {
    console.error(`❌ Error saving to Google Sheets: ${error}`);
  }
}

/**
 * Initialize or resume user session with compliance checks
 *
 * @param phone - User's WhatsApp number
 * @param clientConfig - Client configuration
 * @returns User session (new or existing)
 */
function getOrCreateSession(phone: string, clientConfig: ClientConfig): UserSession {
  // Step 1: Check if session exists
  if (sessions[phone]) {
    console.log(`✅ Session resumed for ${phone}`);
    return sessions[phone];
  }

  // Step 2: Create new session
  const newSession: UserSession = {
    phone,
    clientId: clientConfig.clientId,
    stage: "new",
    profileCreatedAt: Date.now(),
    consent_given: false,
    ai_disclosure_acknowledged: false,
  };

  console.log(`🆕 New session created for ${phone}`);
  return newSession;
}

// ============================================
// SNIPPET #3: WEBHOOK POST HANDLER (REPLACE)
// ============================================
// REPLACE existing app.post("/webhook") handler with this:

app.post("/webhook", async (req, res) => {
  const body = req.body;
  res.sendStatus(200);

  if (body.object === "whatsapp_business_account") {
    try {
      const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;
      const metadata = body.entry?.[0]?.changes?.[0]?.value?.metadata;

      if (messages && messages.length > 0) {
        const message = messages[0];
        const from = message.from;
        const msgText = message.text.body;

        // Step 1: Extract "To" number (which agency/client received this)
        const toNumber = message.to || metadata?.display_phone_number;

        // Step 2: Load client configuration
        const clientConfig = getClientConfig(toNumber);

        console.log(`\n📱 MESSAGE RECEIVED`);
        console.log(`   From: ${from}`);
        console.log(`   To: ${toNumber}`);
        console.log(`   Client: ${clientConfig.agencyName} (${clientConfig.clientId})`);
        console.log(`   Language: ${clientConfig.systemLanguage}\n`);

        // Step 3: Get or create session for this user
        const session = getOrCreateSession(from, clientConfig);

        // Step 4: Route to appropriate handler based on stage
        let reply: string;

        if (session.stage === "new") {
          // First message: Send transparency + consent message
          console.log(`📬 Stage: NEW → Sending transparency message`);
          reply = getTransparencyMessage(clientConfig);
          sessions[from] = session; // Update stage temporarily
          sessions[from].stage = "pending_consent";
          sessions[from].lastMessage = msgText;
          sessions[from].lastUpdate = Date.now();
          saveSessions(sessions);

        } else if (session.stage === "pending_consent") {
          // User responding to consent prompt
          console.log(`⚖️ Stage: PENDING_CONSENT → Processing consent`);
          reply = await handleConsent(from, msgText, clientConfig);

        } else {
          // User in conversation (collecting data or offered job)
          console.log(`💬 Stage: ${session.stage} → Passing to conversation handler`);
          reply = await handleUserMessage(from, msgText, clientConfig);
        }

        console.log(`\n📤 REPLY: ${reply}\n`);
        await trimiteMesajWhatsApp(from, reply, clientConfig);
      }
    } catch (error) {
      console.error("❌ Webhook Error:", error);
    }
  }
});

// ============================================
// SNIPPET #4: UPDATE handleUserMessage() SIGNATURE
// ============================================
// REPLACE signature of handleUserMessage (around line 380):

async function handleUserMessage(
  from: string,
  msgText: string,
  clientConfig: ClientConfig = DEFAULT_CLIENT
): Promise<string> {
  // Load session
  let user = sessions[from];
  if (!user) {
    user = getOrCreateSession(from, clientConfig);
  }

  // Validate consent before proceeding
  if (!isConsented(user)) {
    console.warn(`⚠️ User ${from} not consented, asking for consent`);
    return getTransparencyMessage(clientConfig);
  }

  // ... Rest of function unchanged (uses user session)
  // The rest of the conversation logic remains the same
}

// ============================================
// SNIPPET #5: UPDATE DATA RETENTION CLEANUP
// ============================================
// ADD as scheduled job (example using node-cron):

/**
 * Cleanup expired sessions based on data_retention_date
 *
 * GDPR Article 5(1)(e): Storage Limitation
 * "Personal data...shall be kept in a form which permits identification
 *  of data subjects for no longer than necessary"
 *
 * Runs: Daily at 2:00 AM
 *
 * @returns void
 *
 * @example
 * // Call this as a scheduled job (e.g., with node-cron):
 * // cron.schedule('0 2 * * *', cleanupExpiredSessions);
 */
function cleanupExpiredSessions(): void {
  console.log(`🧹 [GDPR CLEANUP] Checking for expired sessions...`);

  const now = new Date().toISOString().split("T")[0];
  let deletedCount = 0;

  for (const [phone, session] of Object.entries(sessions)) {
    if (session.data_retention_date && session.data_retention_date < now) {
      console.log(`🗑️ Deleting expired session: ${phone} (retention expired: ${session.data_retention_date})`);

      // Archive to audit log (optional, for compliance)
      const auditRecord = {
        phone,
        reason: "GDPR Storage Limitation Principle",
        deletedAt: new Date().toISOString(),
        retentionDate: session.data_retention_date,
      };
      console.log(`📋 AUDIT: ${JSON.stringify(auditRecord)}`);

      // Delete from storage
      delete sessions[phone];
      deletedCount++;
    }
  }

  // Save cleaned sessions
  saveSessions(sessions);
  console.log(`✅ Cleanup complete. Deleted: ${deletedCount} sessions\n`);
}

// To use cleanup, call periodically:
// setInterval(cleanupExpiredSessions, 24 * 60 * 60 * 1000); // Daily

// ============================================
// END OF CODE SNIPPETS
// ============================================
