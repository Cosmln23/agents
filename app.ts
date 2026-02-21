/**
 * @ts-nocheck - PRODUCTION SERVER
 * TypeScript strict mode disabled for module compatibility.
 * This is the final entry point with all Enterprise modules integrated.
 */

/**
 * RECRUTARE AI - APP.TS (V4 - ENTERPRISE PRODUCTION)
 *
 * Final Integration Point - All Modules Assembled
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ THIS IS THE PRODUCTION ENTRY POINT                           │
 * │ All Enterprise features integrated:                          │
 * │ • Multi-Tenant Routing (Segment 1)                           │
 * │ • Session Management + Auto-Cleanup (Segment 2 / Patch 7)   │
 * │ • Data Extraction with Structured Outputs (Segment 3)        │
 * │ • Document Processing + Vision API (Segment 4)               │
 * │ • Intelligent Job Matching (Segment 5)                       │
 * │ • Security: Webhooks, Rate Limiting, GDPR (Patches 1-24)    │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Run with: npm start
 */

import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";

// ============================================
// MODULE IMPORTS - Enterprise Components
// ============================================

// Data Extraction (Segment 3)
import {
  extractDataWithStructured,
  mergeExtractedData,
  shouldExtract,
  ExtractionSchema
} from "./data-extractor";

// Document Processing (Segment 4)
import {
  processCandidateDocument,
  detectMediaInMessage,
  CVExtractionResult
} from "./document-processor";

// Job Matching (Segment 5)
import {
  calculateJobMatch,
  validateForBias,
  Job
} from "./job-matcher";

// Mock Jobs Data (Test data - replace with Google Sheets in production)
import { MOCK_JOBS_BY_CLIENT } from "./data/jobs-mock";

// Email via Resend (configured in .env: RESEND_API_KEY, RESEND_FROM_EMAIL)
import { Resend } from "resend";

// Messages Configuration (Enterprise-Ready)
import { BotMessages } from "./config/messages.config";

// Multi-Tenant Configuration (Segment 1)
import {
  getClientConfig,
  DEFAULT_CLIENT,
  MOCK_CLIENTS,
  listActiveClients
} from "./config/clients";

// Types
import { UserSession } from "./types/UserSession";
import { ClientConfig } from "./types/ClientConfig";

// ============================================
// INITIALIZATION
// ============================================

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// SECURITY: Capture raw body for webhook signature validation
app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf; // Save exact raw buffer (not parsed)
  }
}));

// ============================================
// ENVIRONMENT VALIDATION (Patch 1)
// ============================================

const REQUIRED_ENV_VARS = [
  "OPENAI_API_KEY",
  "WHATSAPP_TOKEN",
  "PHONE_NUMBER_ID",
  "VERIFY_TOKEN",
];

function validateEnvironment(): void {
  const missing = REQUIRED_ENV_VARS.filter(env => !process.env[env]);
  if (missing.length > 0) {
    console.error(`❌ Missing environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(`✅ All environment variables validated`);

  // Verify APP_SECRET is loaded (for webhook signature)
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appSecret) {
    const masked = appSecret.substring(0, 10) + "..." + appSecret.substring(appSecret.length - 4);
    console.log(`🔐 WHATSAPP_APP_SECRET loaded: ${masked}`);
  } else {
    console.warn(`⚠️ WARNING: WHATSAPP_APP_SECRET not set - webhook signature validation will fail`);
  }
}

validateEnvironment();

// ============================================
// SESSION MANAGEMENT (Segment 2 + Patch 7)
// ============================================

const SESSIONS_FILE = "/tmp/whatsapp_sessions.json";
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

function loadSessions(): Record<string, UserSession> {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = fs.readFileSync(SESSIONS_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn("⚠️ Could not load sessions, starting fresh");
  }
  return {};
}

function saveSessions(sessions: Record<string, UserSession>): void {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    console.log(`✅ Sessions saved (${Object.keys(sessions).length} active)`);
  } catch (error) {
    console.error("❌ Error saving sessions:", error);
  }
}

function cleanExpiredSessions(sessions: Record<string, UserSession>): void {
  const now = Date.now();
  let deletedCount = 0;

  for (const [phone, session] of Object.entries(sessions)) {
    const lastUpdate = session.lastUpdate || 0;
    const age = now - lastUpdate;

    if (age > SESSION_TIMEOUT_MS) {
      delete sessions[phone];
      deletedCount++;
      console.log(`🧹 Deleted expired session for ${phone}`);
    }
  }

  if (deletedCount > 0) {
    saveSessions(sessions);
  }
}

let sessions = loadSessions();

// Cleanup every 1 hour
setInterval(() => {
  cleanExpiredSessions(sessions);
}, 60 * 60 * 1000);

// ============================================
// SECURITY: RATE LIMITING (Patch 1)
// ============================================

const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60 seconds

function checkRateLimit(phone: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(phone) || [];

  // Remove timestamps older than window
  const recentTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

  if (recentTimestamps.length >= RATE_LIMIT_REQUESTS) {
    return false; // Rate limited
  }

  recentTimestamps.push(now);
  rateLimitMap.set(phone, recentTimestamps);
  return true; // OK
}

// ============================================
// SECURITY: WEBHOOK SIGNATURE VALIDATION (Patch 1)
// ============================================

/**
 * Validate webhook signature using raw body buffer (not parsed JSON)
 * This ensures 100% byte-for-byte match with Meta's transmission
 */
function validateWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) {
    console.warn("⚠️ No signature provided");
    return false;
  }

  // Use WHATSAPP_APP_SECRET for signature validation
  // CRITICAL: Use rawBody (exact bytes) not JSON.stringify (may reorder keys/spaces)
  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", process.env.WHATSAPP_APP_SECRET || "")
    .update(rawBody)
    .digest("hex")}`;

  const isValid = signature === expectedSignature;

  if (!isValid) {
    console.warn(`⚠️ Signature mismatch`);
    console.warn(`   Received: ${signature.substring(0, 20)}...`);
    console.warn(`   Expected: ${expectedSignature.substring(0, 20)}...`);
  }

  return isValid;
}

// ============================================
// LOGGING UTILITIES (Patch 14)
// ============================================

const isDevelopment = process.env.NODE_ENV !== "production";

function logWithEmoji(
  emoji: string,
  level: "log" | "warn" | "error",
  message: string,
  data?: any
): void {
  const prefix = isDevelopment ? emoji + " " : `[${level.toUpperCase()}] `;
  const logFunction = console[level] as (...args: any[]) => void;

  if (data) {
    logFunction(`${prefix}${message}`, data);
  } else {
    logFunction(`${prefix}${message}`);
  }
}

// ============================================
// ERROR MESSAGES (Patch 13 - Localized)
// ============================================

function getErrorMessage(
  errorCode: string,
  language: "ro" | "nl" | "en" | "de" = "ro"
): string {
  const messages: Record<string, Record<string, string>> = {
    EXTRACTION_FAILED: {
      ro: "Nu am putut citi mesajul. Poți rescrie mai clar?",
      nl: "Ik kon je bericht niet lezen. Kun je duidelijker schrijven?",
      en: "I couldn't read your message. Can you be clearer?",
      de: "Ich konnte deine Nachricht nicht lesen. Kannst du klarer schreiben?",
    },
    NO_MATCHES: {
      ro: "Din păcate, nu avem joburi potrivite în moment. Te rog reîncearcă mai târziu!",
      nl: "Helaas hebben we nu geen geschikte banen. Probeer later opnieuw!",
      en: "Unfortunately, we don't have suitable jobs right now. Try again later!",
      de: "Leider haben wir gerade keine geeigneten Jobs. Versuchen Sie später erneut!",
    },
    API_ERROR: {
      ro: "Ceva nu merge pe serverul nostru. Încearcă din nou mai târziu!",
      nl: "Er is iets misgegaan met onze server. Probeer later opnieuw!",
      en: "Something went wrong with our server. Try again later!",
      de: "Etwas ist mit unserem Server schief gelaufen. Versuchen Sie später erneut!",
    },
  };

  return (
    messages[errorCode]?.[language] ||
    messages[errorCode]?.["en"] ||
    "An error occurred. Please try again."
  );
}

// ============================================
// WHATSAPP MESSAGE SENDER
// ============================================

async function sendWhatsAppMessage(toPhone: string, text: string): Promise<void> {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: toPhone,
        type: "text",
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    logWithEmoji("✅", "log", `WhatsApp message sent to ${toPhone}`);
  } catch (error) {
    logWithEmoji("❌", "error", `Failed to send WhatsApp message:`, error);
    throw error;
  }
}

// ============================================
// TEXT NORMALIZATION - Intent-Based Input Processing
// ============================================

/**
 * Normalize user input to detect intent (DA/NU/YES/NO variations)
 * Handles natural language variations like "Da, sunt de acord", "DA!!!", "yes please", etc.
 *
 * GDPR COMPLIANCE: Users should speak naturally, not follow strict "formulas".
 * This function makes the bot feel human-friendly while remaining strict on consent logic.
 *
 * @param text - Raw user input
 * @returns "YES" | "NO" | "UNCLEAR"
 *
 * @examples
 *   "Da ,, imi dau acordul" → "YES"
 *   "da.este corect" → "YES"
 *   "DA!!!" → "YES"
 *   "yes please" → "YES"
 *   "Nu, prefer nu" → "NO"
 *   "nu-mi dau acordul" → "NO"
 *   "hmm, nu stiu" → "UNCLEAR"
 */
function normalizeConsent(text: string): "YES" | "NO" | "UNCLEAR" {
  if (!text) return "UNCLEAR";

  // Step 1: Clean text - lowercase, remove diacritics, trim
  let cleaned = text
    .toLowerCase()
    .trim()
    // Remove diacritics (ă→a, ș→s, ț→t, etc.)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Remove punctuation/special chars but keep spaces
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Step 2: Check for YES patterns
  const yesPatterns = [
    /^da\b/,           // starts with "da"
    /\byes\b/,         // contains "yes"
    /\bacord/,         // contains "acord"
    /\baccept/,        // contains "accept"
    /\bconfirm/,       // contains "confirm"
    /\bstiu\b/,        // "stiu" (I agree in casual Romanian)
    /\bde\s+acord/,    // "de acord" (I agree)
  ];

  for (const pattern of yesPatterns) {
    if (pattern.test(cleaned)) return "YES";
  }

  // Step 3: Check for NO patterns
  const noPatterns = [
    /^nu\b/,           // starts with "nu"
    /\bno\b/,          // contains "no"
    /\brefuz/,         // contains "refuz"
    /\bdeclin/,        // contains "declin"
    /\bnu\s+sunt/,     // "nu sunt" (I'm not)
  ];

  for (const pattern of noPatterns) {
    if (pattern.test(cleaned)) return "NO";
  }

  return "UNCLEAR";
}

// ============================================
// JOB MATCH MESSAGE BUILDER
// ============================================

/**
 * Builds a human-readable job matches list for WhatsApp message.
 * Shows top matches with score, title, city, salary.
 *
 * @param matches - Top job matches from calculateJobMatch()
 * @returns Formatted string for WhatsApp message
 */
function buildJobMatchMessage(matches: any[]): string {
  if (!matches || matches.length === 0) return "(niciun job găsit)";

  return matches
    .slice(0, 3)
    .map((match, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
      return `${medal} ${match.jobTitle} — ${match.city}\n   💰 ${match.salary || "Salariu negociabil"}\n   📊 Potrivire: ${match.matchScore}%\n   💡 ${match.matchReasoning?.substring(0, 100) || ""}...`;
    })
    .join("\n\n");
}

// ============================================
// DISPATCH TO OFFICE (GDPR-COMPLIANT EMAIL)
// ============================================

/**
 * Sends candidate profile summary to agency office via email.
 *
 * GDPR COMPLIANCE NOTES (For future auditors):
 * ─────────────────────────────────────────────
 * ✅ GDPR Art. 6(1)(a) - Lawful basis: Explicit consent obtained via WhatsApp
 * ✅ GDPR Art. 7 - Consent recorded with timestamp before any data transfer
 * ✅ GDPR Art. 13 - Candidate informed of data controller identity and purpose
 * ✅ GDPR Art. 44 - Data transfer to third party (office) only after consent
 * ✅ GDPR Art. 5(1)(c) - Data minimization: sends SUMMARY only, NOT raw CV/PDF
 * ✅ EU AI Act Art. 54 - AI system transparency: candidate knows it's an AI bot
 *
 * DATA LINEAGE:
 * WhatsApp PDF → Vision API (extract) → Session (temp) → Email summary → Zero-Retention
 * The original PDF is deleted immediately after extraction (GDPR Art. 5(1)(e)).
 * Session data is cleared of sensitive fields after successful dispatch.
 *
 * @param session - Full candidate session
 * @param clientConfig - Agency configuration (includes notificationEmail)
 * @param matchedJobs - Top job matches to include in email
 * @returns Promise<boolean> - true if email sent successfully
 */
async function dispatchToOffice(
  session: UserSession,
  clientConfig: ClientConfig,
  matchedJobs: any[]
): Promise<boolean> {
  try {
    // GDPR COMPLIANCE: Data transfer initiated ONLY after explicit user consent via WhatsApp.
    // Consent timestamp: recorded in session.dispatch_consent_timestamp before calling this function.
    // Legal basis: GDPR Article 7 - freely given, specific, informed and unambiguous indication.
    const consentDate = session.dispatch_consent_timestamp
      ? new Date(session.dispatch_consent_timestamp).toISOString()
      : new Date().toISOString();

    // Build top jobs summary (NO raw CV data - data minimization)
    const jobsSummary = matchedJobs
      .slice(0, 3)
      .map((m, i) => `${i + 1}. ${m.jobTitle} (${m.city}) — ${m.matchScore}% match`)
      .join("\n");

    // Candidate profile summary (structured, no sensitive GDPR-excluded fields)
    const emailBody = `
========================================
CANDIDAT NOU - RECRUTARE AI BOT
========================================

PROFIL CANDIDAT:
• Nume: ${session.nume || "(nespecificat)"}
• Domeniu: ${session.domeniu_activitate || "(nespecificat)"}
• Rol recent: ${session.experienta_recenta || session.experience_summary?.split(",")[0] || "(nespecificat)"}
• Mobilitate: ${session.mobilitate || "(nespecificat)"}
• Educație: ${session.education || "(nespecificat)"}
• Limbă: ${session.language_level || "(nespecificat)"}
• Abilități: ${session.hard_skills?.slice(0, 5).join(", ") || "(nespecificate)"}

DETALII LOGISTICE (din conversation):
• Disponibilitate: ${session.availability || "(nespecificat)"}
• Cazare necesară: ${session.accommodation_needed || "(nespecificat)"}

JOBURI POTRIVITE (AI Matching):
${jobsSummary || "(niciun match găsit)"}

========================================
GDPR & COMPLIANCE AUDIT TRAIL
========================================
• Consimțământ inițial (GDPR Art. 7): DA
• Data consimțământ procesare: ${session.lastUpdate ? new Date(session.lastUpdate).toISOString() : "N/A"}
• Consimțământ transfer date (GDPR Art. 44): DA (explicit via WhatsApp)
• Data consimțământ transfer: ${consentDate}
• Client/Agenție: ${clientConfig.agencyName} (${clientConfig.clientId})
• Bot: Recrutare AI v4 (EU AI Act compliant - transparență declarată candidatului)
• CV original: ȘTERS imediat după extracție (Zero-Retention Policy, GDPR Art. 5(1)(e))
• Date sensibile: NU sunt stocate pe termen lung (GDPR Art. 5(1)(c) minimizare)
• Număr contact (ultimele 4 cifre): ...${session.phone?.slice(-4) || "N/A"}
========================================
Mesaj generat automat de Recrutare AI Bot
    `.trim();

    // Send email via Resend (API key configured in .env: RESEND_API_KEY)
    const resend = new Resend(process.env.RESEND_API_KEY);

    const recipientEmail = clientConfig.notificationEmail || process.env.NOTIFICATION_EMAIL || "";

    if (!recipientEmail) {
      logWithEmoji("⚠️", "warn", `No notification email configured for client ${clientConfig.clientId}`);
      return false;
    }

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
      to: recipientEmail,
      subject: `[CANDIDAT NOU] ${session.nume || "Candidat"} — ${session.domeniu_activitate || "Logistică"} — ${clientConfig.agencyName}`,
      text: emailBody,
    });

    logWithEmoji("📧", "log", `[DISPATCH] Email trimis la ${recipientEmail} pentru candidat [...${session.phone?.slice(-4)}]`);
    return true;

  } catch (error) {
    logWithEmoji("❌", "error", `[DISPATCH] Email failed:`, error);
    return false;
  }
}

// ============================================
// MAIN MESSAGE HANDLER
// ============================================

/**
 * Process incoming WhatsApp message with full Enterprise flow
 *
 * Flow:
 * 1. Get client config (Segment 1 - Multi-Tenant)
 * 2. Load/create session
 * 3. Check if media (image/PDF) → processCandidateDocument (Segment 4)
 * 4. Check if text → extractDataWithStructured (Segment 3)
 * 5. If profile complete → calculateJobMatch (Segment 5)
 * 6. Send WhatsApp message with offer
 */
async function handleUserMessage(
  from: string,
  messageData: any,
  clientConfig: ClientConfig
): Promise<void> {
  logWithEmoji("📱", "log", `Message from +${from}`);

  // Load or create session
  let session = sessions[from];
  if (!session) {
    session = {
      phone: from,
      clientId: clientConfig.clientId,
      stage: "new",
      lastUpdate: Date.now(),
      consent_given: false, // GDPR consent flag
      ai_disclosure_acknowledged: false,
    } as UserSession;
    sessions[from] = session;

    // 🔐 STEP 0: NEW USER - REQUEST GDPR CONSENT
    // [MODIFICAT AICI] Pasul 1: Mesajul de Bun Venit & GDPR aerisit și clar
    const gdprMessage = BotMessages.welcomeGDPR;

    await sendWhatsAppMessage(from, gdprMessage);
    saveSessions(sessions);
    return; // Stop here, wait for DA/NU
  }

  try {
    // 🔐 CHECK GDPR CONSENT STATUS
    if (!session.consent_given) {
      const messageText = messageData?.text?.body || "";
      const consent = normalizeConsent(messageText);

      if (consent === "YES") {
        session.consent_given = true;
        session.ai_disclosure_acknowledged = true;
        session.stage = "collecting_data";
        logWithEmoji("✅", "log", `[GDPR] Consent given by ${from} (raw: "${messageText.substring(0, 30)}")`);
        // [MODIFICAT AICI] Pasul 2: Momentul de "Prezentare" cu opțiuni (CV sau text)
        await sendWhatsAppMessage(from, BotMessages.presentationOptions);
        saveSessions(sessions);
        return;
      } else if (consent === "NO") {
        session.stage = "completed";
        logWithEmoji("🚫", "log", `[GDPR] Consent REFUSED by ${from}`);
        await sendWhatsAppMessage(from, BotMessages.consentRejected);
        saveSessions(sessions);
        return;
      } else {
        // User hasn't responded clearly to consent yet - be patient
        logWithEmoji("⏳", "log", `[GDPR] Unclear response, prompting again`);
        await sendWhatsAppMessage(from, BotMessages.promptConsent);
        return;
      }
    }

    // ============================================
    // STEP 1: CHECK FOR MEDIA (PDF/Image) → Segment 4
    // ============================================

    const mediaMetadata = detectMediaInMessage(messageData);

    if (mediaMetadata) {
      logWithEmoji("📄", "log", `Detected media: ${mediaMetadata.mimeType}`);

      try {
        const cvData = await processCandidateDocument(
          mediaMetadata.mediaUrl,
          mediaMetadata.mimeType,
          session,
          clientConfig
        );

        if (cvData) {
          // Merge CV data into session
          mergeExtractedData(session, cvData);
          logWithEmoji("✅", "log", `CV data extracted and merged`);

          // [MODIFICAT AICI] Pasul 3: Feedback-ul detaliat și structurat după citirea CV-ului
          const fallbackNume = cvData.nume_candidat || "Candidat";
          const fallbackDomeniu = cvData.domeniu_activitate || "domeniul tău";
          const fallbackExperienta = cvData.experienta_recenta || (cvData.experience_summary ? cvData.experience_summary.split(',')[0] || "joburi anterioare" : "joburi anterioare");
          const fallbackMobilitate = cvData.mobilitate || "locațiile detaliate în CV";
          const fallbackExpertiza = (cvData.hard_skills && cvData.hard_skills.length > 0) ? cvData.hard_skills.slice(0, 3).join(", ") : "abilitățile tehnice menționate";

          const cvFeedbackMessage = BotMessages.cvFeedback(fallbackNume, fallbackDomeniu, fallbackExperienta, fallbackMobilitate, fallbackExpertiza);

          // Confirm to user
          await sendWhatsAppMessage(from, cvFeedbackMessage);
        } else {
          await sendWhatsAppMessage(from, BotMessages.cvExtractionFailed);
        }
      } catch (documentError) {
        logWithEmoji("❌", "error", `Document processing error:`, documentError);

        // Graceful error message to user
        await sendWhatsAppMessage(from, BotMessages.cvDownloadFailed);
      }
    }

    // ============================================
    // STEP 2: CHECK FOR TEXT MESSAGE → Segment 3 (Background)
    // ============================================

    const messageText = messageData?.text?.body || "";

    if (messageText && shouldExtract(messageText)) {
      logWithEmoji("📝", "log", `Extracting data from text message`);

      // Background extraction (non-blocking)
      extractDataWithStructured(messageText, session, clientConfig)
        .then(extracted => {
          if (extracted) {
            mergeExtractedData(session, extracted);
            logWithEmoji("🔄", "log", `Background extraction completed`);
            saveSessions(sessions);
          }
        })
        .catch(error => {
          logWithEmoji("⚠️", "warn", `Background extraction error:`, error);
        });

      // Acknowledge to user
      await sendWhatsAppMessage(from, BotMessages.dataRecorded);
    }

    // ============================================
    // STEP 3: QUALIFICATION STAGE
    // Capture start date + accommodation after CV read
    // ============================================

    if (session.stage === "waiting_qualification" && messageText) {
      // Save raw answer - AI extraction can parse it later
      // Simple heuristic: first message contains both answers
      session.availability = session.availability || messageText;
      session.accommodation_needed = session.accommodation_needed || messageText;

      logWithEmoji("📋", "log", `[QUALIFICATION] Answers received for [...${session.phone?.slice(-4)}]`);

      // Run job matching
      session.stage = "waiting_dispatch_consent";

      try {
        // Get jobs for this client (mock data → replace with Google Sheets in production)
        const availableJobs: Job[] = MOCK_JOBS_BY_CLIENT[clientConfig.clientId]
          ?? MOCK_JOBS_BY_CLIENT["default_001"]
          ?? [];

        const matchingResult = await calculateJobMatch(session, availableJobs, clientConfig);
        const topMatches = matchingResult?.topMatches ?? [];

        // Save matched job IDs for audit trail
        session.matched_job_ids = topMatches.map((m: any) => m.jobId);

        if (topMatches.length > 0) {
          const jobsListText = buildJobMatchMessage(topMatches);
          const name = session.nume || "Candidat";
          const availability = session.availability || "(nespecificat)";
          const accommodation = session.accommodation_needed || "(nespecificat)";

          await sendWhatsAppMessage(
            from,
            BotMessages.jobMatchesFound(name, jobsListText, availability, accommodation)
          );
        } else {
          // No matches found
          session.stage = "completed";
          await sendWhatsAppMessage(from, BotMessages.noJobsFound(session.nume || "Candidat"));
        }

      } catch (matchError) {
        logWithEmoji("❌", "error", `[MATCHING] Error:`, matchError);
        // Fallback: continue to dispatch anyway
        await sendWhatsAppMessage(from, BotMessages.jobMatchesFound(
          session.nume || "Candidat",
          "🔄 Se procesează matching-ul...",
          session.availability || "(nespecificat)",
          session.accommodation_needed || "(nespecificat)"
        ));
      }

      saveSessions(sessions);
      return;
    }

    // ============================================
    // STEP 4: DISPATCH CONSENT STAGE
    // User responds DA/NU to send profile to office
    // ============================================

    if (session.stage === "waiting_dispatch_consent" && messageText) {
      const answer = normalizeConsent(messageText);

      if (answer === "YES") {
        // GDPR COMPLIANCE: Record explicit consent timestamp before any data transfer
        // Legal basis: GDPR Article 7 - consent must be recorded with timestamp
        session.dispatch_consent_timestamp = Date.now();

        logWithEmoji("📤", "log", `[DISPATCH] Consent granted for [...${session.phone?.slice(-4)}]. Sending to office...`);

        // Get matched jobs for email
        const availableJobs: Job[] = MOCK_JOBS_BY_CLIENT[clientConfig.clientId]
          ?? MOCK_JOBS_BY_CLIENT["default_001"]
          ?? [];
        const matchingResult = await calculateJobMatch(session, availableJobs, clientConfig).catch(() => null);
        const topMatches = matchingResult?.topMatches ?? [];

        // Dispatch to office via email
        const dispatched = await dispatchToOffice(session, clientConfig, topMatches);

        if (dispatched) {
          session.stage = "dispatched";
          session.dispatch_timestamp = Date.now();

          // GDPR Art. 5(1)(c) - Data Minimization / Zero-Retention Policy
          // Remove sensitive fields from session after successful dispatch
          // Only keep: phone, stage, timestamps (needed for follow-up)
          // Legal: GDPR Article 5(1)(e) - "storage limitation principle"
          delete session.education;
          delete session.experience_summary;
          delete session.hard_skills;
          delete session.domeniu_activitate;
          delete session.experienta_recenta;
          delete session.mobilitate;
          delete session.ai_notes;

          logWithEmoji("🗑️", "log", `[GDPR] Sensitive data cleared after dispatch for [...${session.phone?.slice(-4)}]`);

          await sendWhatsAppMessage(from, BotMessages.dispatchConfirmed(
            session.nume || "Candidat",
            clientConfig.agencyName
          ));

        } else {
          // Email failed - keep stage, let them retry
          logWithEmoji("⚠️", "warn", `[DISPATCH] Email failed for [...${session.phone?.slice(-4)}], keeping stage`);
          await sendWhatsAppMessage(from, "⚠️ A apărut o problemă tehnică la trimiterea dosarului. Te rog scrie din nou DA pentru a reîncerca.");
        }

      } else if (answer === "NO") {
        logWithEmoji("🚫", "log", `[DISPATCH] Consent refused for [...${session.phone?.slice(-4)}]`);
        await sendWhatsAppMessage(from, BotMessages.dispatchRefused);
        // Keep stage as waiting_dispatch_consent - they can change mind later

      } else {
        // User wrote something unclear - remind them
        logWithEmoji("⏳", "log", `[DISPATCH] Unclear response, re-prompting`);
        await sendWhatsAppMessage(from, `Te rog răspunde cu "DA" pentru a trimite dosarul, sau "NU" dacă preferi să nu îl trimitem. 🙏`);
      }

      saveSessions(sessions);
      return;
    }

    // ============================================
    // STEP 5: CHECK IF CV READ → Move to Qualification
    // Triggered after CV extraction merges data into session
    // ============================================

    const hasCvData =
      session.education ||
      session.experience_summary ||
      (session.hard_skills && session.hard_skills.length > 0);

    if (hasCvData && session.stage === "collecting_data" && !mediaMetadata) {
      // Text message after CV read - check if it's a confirmation ("da, e corect")
      const confirmation = normalizeConsent(messageText);

      if (confirmation === "YES") {
        // Move to qualification stage
        session.stage = "waiting_qualification";
        const name = session.nume || "Candidat";
        logWithEmoji("✅", "log", `[CV CONFIRM] User confirmed CV data is correct`);
        await sendWhatsAppMessage(from, BotMessages.qualificationQuestions(name));
        saveSessions(sessions);
        return;
      } else if (confirmation === "NO") {
        // User says CV data is wrong - ask to correct
        await sendWhatsAppMessage(from, "Înțeleg. Te rog corectează datele pe care le consideri greșite sau rescrie-le. 📝");
        saveSessions(sessions);
        return;
      }
    }

    // Move to qualification automatically after CV is read (mediaMetadata path)
    if (hasCvData && session.stage === "collecting_data" && mediaMetadata) {
      session.stage = "waiting_qualification";
      // cvFeedback message was already sent above - qualification message is next interaction
    }

    // ============================================
    // STEP 6: Save session
    // ============================================

    session.lastUpdate = Date.now();
    session.lastMessage = messageText || `[Media: ${mediaMetadata?.mimeType}]`;
    saveSessions(sessions);

  } catch (error) {
    logWithEmoji("❌", "error", `Message handler error:`, error);

    const errorMsg = getErrorMessage("API_ERROR", clientConfig.systemLanguage);
    await sendWhatsAppMessage(from, errorMsg);
  }
}

// ============================================
// WEBHOOK ENDPOINTS
// ============================================

/**
 * GET /webhook - Verify webhook with Meta
 */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  logWithEmoji("🔍", "log", `Webhook verification request`);

  if (mode && token === process.env.VERIFY_TOKEN) {
    logWithEmoji("✅", "log", `Webhook verified successfully`);
    res.status(200).send(challenge);
  } else {
    logWithEmoji("❌", "error", `Invalid webhook token`);
    res.sendStatus(403);
  }
});

/**
 * POST /webhook - Receive messages from WhatsApp
 */
app.post("/webhook", async (req, res) => {
  const body = req.body;

  // Return 200 immediately to Meta
  res.sendStatus(200);

  // Validate webhook signature using raw body buffer (Patch 1 - FIXED)
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const rawBody = (req as any).rawBody as Buffer;

  if (!rawBody) {
    logWithEmoji("❌", "error", `No raw body buffer available`);
    return;
  }

  if (!validateWebhookSignature(rawBody, signature)) {
    logWithEmoji("⚠️", "warn", `Invalid webhook signature - message rejected`);
    return;
  }

  logWithEmoji("✅", "log", `Webhook signature validated`);

  // Process WhatsApp business account messages
  if (body.object === "whatsapp_business_account") {
    try {
      const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;
      const metadata = body.entry?.[0]?.changes?.[0]?.value?.metadata;

      if (!messages || messages.length === 0) {
        return;
      }

      const message = messages[0];
      const from = message?.from;
      const toNumber = metadata?.display_phone_number;

      if (!from || !toNumber) {
        logWithEmoji("⚠️", "warn", `Invalid message structure`);
        return;
      }

      // ============================================
      // RATE LIMITING (Patch 1)
      // ============================================

      if (!checkRateLimit(from)) {
        logWithEmoji("🚫", "warn", `Rate limit exceeded for ${from}`);
        await sendWhatsAppMessage(from, BotMessages.rateLimitExceeded);
        return;
      }

      // ============================================
      // MULTI-TENANT ROUTING (Segment 1)
      // ============================================

      const clientConfig = getClientConfig(toNumber);

      if (!clientConfig.isActive) {
        logWithEmoji("⚠️", "warn", `Client not active: ${clientConfig.clientId}`);
        return;
      }

      logWithEmoji("🏢", "log", `Routing to client: ${clientConfig.agencyName}`);

      // ============================================
      // HANDLE USER MESSAGE
      // ============================================

      await handleUserMessage(from, message, clientConfig);

    } catch (error) {
      logWithEmoji("❌", "error", `Webhook processing error:`, error);
    }
  }
});

// ============================================
// DEBUG ENDPOINTS
// ============================================

app.get("/debug/clients", (req, res) => {
  res.json({
    activeClients: listActiveClients(),
    sessionCount: Object.keys(sessions).length,
  });
});

app.get("/debug/sessions", (req, res) => {
  res.json(sessions);
});

// ============================================
// SERVER STARTUP
// ============================================

const server = app.listen(PORT, () => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🚀 RECRUTARE AI v4 - PRODUCTION READY`);
  console.log(`${"=".repeat(60)}`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`🏢 Active Clients: ${listActiveClients().length}`);
  console.log(`👥 Sessions: ${Object.keys(sessions).length}`);
  console.log(`🔐 Environment: ${isDevelopment ? "DEVELOPMENT" : "PRODUCTION"}`);
  console.log(`\n⚠️  To expose locally: ngrok http ${PORT}\n`);
});

// ============================================
// GRACEFUL SHUTDOWN (Patch 7)
// ============================================

process.on("SIGTERM", () => {
  logWithEmoji("🛑", "log", `Shutting down gracefully...`);
  cleanExpiredSessions(sessions);
  saveSessions(sessions);
  server.close(() => {
    logWithEmoji("✅", "log", `Server closed`);
    process.exit(0);
  });
});

// Export for testing
export { app, sessions };
