/**
 * CODE SNIPPETS - SEGMENT 4
 * Webhook Integration for Document Processing
 *
 * @version 4.0
 * @description
 *   Shows exactly how to integrate document processing into the webhook handler.
 *   Detect media → Process → Fast-forward session → Respond to user
 */

// ============================================
// SNIPPET #1: IMPORTS (Add to top of server-v3.ts)
// ============================================

import {
  processCandidateDocument,
  detectMediaInMessage,
  CVExtractionResult,
} from "./document-processor";

// ============================================
// SNIPPET #2: FAST-FORWARD SESSION LOGIC
// ============================================
// Add this function after existing session functions

/**
 * Fast-forward session after successful CV extraction
 *
 * LOGIC:
 * - If education extracted: skip education phase
 * - If experience extracted: skip experience phase
 * - If skills extracted: skip skills phase
 * - Only ask for missing fields
 *
 * @param session - User session to fast-forward
 * @param extracted - Data extracted from CV
 * @param clientConfig - Client configuration
 * @returns Confirmation message to send to user
 *
 * @example
 * const extraction = await processCandidateDocument(...);
 * if (extraction) {
 *   mergeExtractedData(session, extraction);
 *   const reply = await fastForwardSession(session, extraction, clientConfig);
 *   // User sees confirmation, moves to next stage
 * }
 */
async function fastForwardSession(
  session: UserSession,
  extracted: CVExtractionResult,
  clientConfig: ClientConfig
): Promise<string> {
  // Step 1: Merge extracted data into session
  mergeExtractedData(session, extracted);

  // Step 2: Determine what we have and what's missing
  const hasEducation = !!session.education;
  const hasExperience = !!session.experience_summary;
  const hasSkills = !!session.hard_skills && session.hard_skills.length > 0;
  const hasLanguage = !!session.language_level;

  // Step 3: Update session stage based on what's missing
  // If we have most data, jump to language_validation
  if (hasEducation && hasExperience && hasSkills && !hasLanguage) {
    session.stage = "language_validation";
  } else if (hasEducation && hasExperience && hasSkills && hasLanguage) {
    // All data collected, jump to job matching
    session.stage = "offered_job";
    saveSessions(sessions);

    // Immediately find job match
    const jobResult = await gasesteJobDinGoogle(session, clientConfig);
    return jobResult.raspuns;
  } else {
    // Partial extraction, stay in collecting_data but with updated fields
    session.stage = "collecting_data";
  }

  saveSessions(sessions);

  // Step 4: Generate confirmation message with dynamic prompt
  // This will show what we extracted and ask for what's missing
  const systemPrompt = generateSystemPrompt(clientConfig, session);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: `Am citit CV-ul candidatului. Iată ce am extras:

${buildExtractionSummary(extracted, clientConfig.systemLanguage)}

Acum generează un mesaj prietenos care:
1. Confirm what you found in the CV
2. Lists what's still missing
3. Ask for the next missing field

Format: Natural conversation, one question at a time. Friendly tone.`,
      },
    ],
    temperature: 0,
  });

  const confirmationMessage =
    response.choices[0].message.content ||
    "Am citit CV-ul tău! Te rog să confirmi datele.";

  return confirmationMessage;
}

/**
 * Build extraction summary for display to user
 *
 * @param extracted - Extracted data
 * @param language - System language
 * @returns Formatted summary text
 */
function buildExtractionSummary(
  extracted: CVExtractionResult,
  language: "ro" | "nl" | "en" | "de"
): string {
  const summaries = {
    ro: `📄 EXTRACTED FROM CV:
${extracted.education ? `✅ Education: ${extracted.education}` : "❌ Education: not found"}
${extracted.experience_summary ? `✅ Experience: ${extracted.experience_summary}` : "❌ Experience: not found"}
${extracted.hard_skills?.length ? `✅ Skills: ${extracted.hard_skills.join(", ")}` : "❌ Skills: not found"}
${extracted.language_level ? `✅ Language: ${extracted.language_level}` : "❌ Language: not specified"}

Extraction Confidence: ${extracted.extraction_confidence || "N/A"}%
${extracted.extraction_notes ? `Notes: ${extracted.extraction_notes}` : ""}`,

    nl: `📄 UIT CV GEËXTRAHEERD:
${extracted.education ? `✅ Onderwijs: ${extracted.education}` : "❌ Onderwijs: niet gevonden"}
${extracted.experience_summary ? `✅ Ervaring: ${extracted.experience_summary}` : "❌ Ervaring: niet gevonden"}
${extracted.hard_skills?.length ? `✅ Vaardigheden: ${extracted.hard_skills.join(", ")}` : "❌ Vaardigheden: niet gevonden"}
${extracted.language_level ? `✅ Taal: ${extracted.language_level}` : "❌ Taal: niet opgegeven"}`,

    en: `📄 EXTRACTED FROM CV:
${extracted.education ? `✅ Education: ${extracted.education}` : "❌ Education: not found"}
${extracted.experience_summary ? `✅ Experience: ${extracted.experience_summary}` : "❌ Experience: not found"}
${extracted.hard_skills?.length ? `✅ Skills: ${extracted.hard_skills.join(", ")}` : "❌ Skills: not found"}
${extracted.language_level ? `✅ Language: ${extracted.language_level}` : "❌ Language: not specified"}`,

    de: `📄 AUS CV EXTRAHIERT:
${extracted.education ? `✅ Ausbildung: ${extracted.education}` : "❌ Ausbildung: nicht gefunden"}
${extracted.experience_summary ? `✅ Erfahrung: ${extracted.experience_summary}` : "❌ Erfahrung: nicht gefunden"}
${extracted.hard_skills?.length ? `✅ Fähigkeiten: ${extracted.hard_skills.join(", ")}` : "❌ Fähigkeiten: nicht gefunden"}
${extracted.language_level ? `✅ Sprache: ${extracted.language_level}` : "❌ Sprache: nicht angegeben"}`,
  };

  return summaries[language] || summaries.en;
}

// ============================================
// SNIPPET #3: UPDATED WEBHOOK HANDLER
// ============================================
// REPLACE the existing app.post("/webhook") with this version

/**
 * Webhook handler with document processing support
 *
 * Flow:
 * 1. Check if message contains media (CV, image)
 * 2. If YES: Process document → Fast-forward session
 * 3. If NO: Handle as regular text message
 */
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
        const msgText = message.text?.body;

        // Step 1: Extract client config
        const toNumber = message.to || metadata?.display_phone_number;
        const clientConfig = getClientConfig(toNumber);

        // Step 2: Get or create session
        let session = sessions[from];
        if (!session) {
          session = getOrCreateSession(from, clientConfig);
          sessions[from] = session;
        }

        let reply: string;

        // ← SEGMENT 4: CHECK FOR MEDIA (CV, IMAGE)
        const mediaData = detectMediaInMessage(message);

        if (mediaData) {
          // ✅ DOCUMENT DETECTED
          console.log(`\n📄 [MEDIA] CV/Document received from ${from}`);
          console.log(`   Type: ${mediaData.mediaType}`);
          console.log(`   File: ${mediaData.fileName}`);

          // Step 3: Process document (download, extract, delete)
          const extraction = await processCandidateDocument(
            mediaData.mediaUrl,
            mediaData.mimeType,
            session,
            clientConfig
          );

          if (extraction) {
            // ✅ Extraction successful
            console.log(`✅ CV extraction successful`);

            // Step 4: Fast-forward session
            reply = await fastForwardSession(session, extraction, clientConfig);

            console.log(`\n📬 FAST-FORWARD: Skipped to next stage`);
            console.log(`   Stage now: ${session.stage}`);
          } else {
            // ❌ Extraction failed
            console.log(`❌ CV extraction failed`);

            // Fallback: Ask user to continue with text
            reply =
              clientConfig.systemLanguage === "nl"
                ? "Sorry, ik kon het CV niet lezen. Vertel me alsjeblieft over jezelf."
                : "Scuze, nu am putut citi CV-ul. Te rog spune-mi despre tine.";
          }
        } else if (msgText) {
          // ✅ NO MEDIA - Regular text message
          console.log(`\n💬 [TEXT] Message from ${from}`);

          // Route based on stage
          if (session.stage === "pending_consent") {
            reply = await handleConsent(from, msgText, clientConfig);
          } else if (
            session.stage === "collecting_data" ||
            session.stage === "education"
          ) {
            reply = await handleUserMessage(from, msgText, clientConfig);
          } else {
            reply = await handleUserMessage(from, msgText, clientConfig);
          }

          console.log(`\n📤 REPLY: ${reply}\n`);

          // Background extraction (non-blocking)
          if (shouldExtract(msgText)) {
            extractDataWithStructured(msgText, session, clientConfig)
              .then((extracted) => {
                if (extracted) {
                  mergeExtractedData(session, extracted);
                  saveSessions(sessions);
                  console.log(
                    `📊 [Background] Data merged for ${from}`
                  );
                }
              })
              .catch((err) =>
                console.error(`⚠️ [Background extraction]:`, err)
              );
          }
        } else {
          // No text and no media
          console.log(`⚠️ [UNKNOWN] Message with no text or media`);
          reply = "Te rog trimite un mesaj text sau un CV în PDF/imagine.";
        }

        // Step 5: Send reply to user
        console.log(`\n📤 SENDING REPLY`);
        await trimiteMesajWhatsApp(from, reply, clientConfig);
      }
    } catch (error) {
      console.error("❌ Webhook Error:", error);
    }
  }
});

// ============================================
// SNIPPET #4: ERROR HANDLING FOR DOCUMENTS
// ============================================
// Add this error handler for file-related issues

/**
 * Safe document processing with error messages
 *
 * Wraps processCandidateDocument with user-friendly error handling
 *
 * @param mediaUrl - Media URL from webhook
 * @param mimeType - MIME type
 * @param session - User session
 * @param clientConfig - Client config
 * @returns Extraction result or error message
 */
async function safeProcessDocument(
  mediaUrl: string,
  mimeType: string,
  session: UserSession,
  clientConfig: ClientConfig
): Promise<{ success: boolean; data?: CVExtractionResult; error?: string }> {
  try {
    const extraction = await processCandidateDocument(
      mediaUrl,
      mimeType,
      session,
      clientConfig
    );

    if (extraction) {
      return { success: true, data: extraction };
    } else {
      return {
        success: false,
        error: "extraction_failed",
      };
    }
  } catch (error: any) {
    // Map specific errors to user-friendly messages
    const errorMsg = error.message || "";

    if (errorMsg.includes("too large")) {
      return {
        success: false,
        error: "file_too_large",
      };
    }

    if (errorMsg.includes("timeout")) {
      return {
        success: false,
        error: "download_timeout",
      };
    }

    if (errorMsg.includes("HTTP")) {
      return {
        success: false,
        error: "download_failed",
      };
    }

    return {
      success: false,
      error: "unknown_error",
    };
  }
}

/**
 * Generate user message for document processing errors
 *
 * @param errorCode - Error code from safeProcessDocument
 * @param language - System language
 * @returns User-friendly error message
 */
function getDocumentErrorMessage(
  errorCode: string,
  language: "ro" | "nl" | "en" | "de"
): string {
  const messages = {
    ro: {
      file_too_large: `Fișierul este prea mare (max 5MB). Te rog trimite un CV mai mic sau continuă prin mesaje text.`,
      download_timeout: `Descărcarea a expirat (prea lent). Te rog incearcă din nou sau trimite prin mesaj.`,
      download_failed: `Nu am putut descărca fișierul. Verific dacă URL-ul e valid...`,
      extraction_failed: `Nu am putut citi CV-ul din imagine/PDF. Poți continua prin mesaje text? Te rog spune-mi: Ce studii ai?`,
      unknown_error: `Ceva a mers greșit. Încarcă din nou sau continuă prin mesaje text.`,
    },
    nl: {
      file_too_large: `Bestand te groot (max 5MB). Stuur een kleiner CV of ga door via berichten.`,
      download_timeout: `Download verlopen. Probeer opnieuw of stuur via bericht.`,
      download_failed: `Kan bestand niet downloaden. Controleer of de link geldig is.`,
      extraction_failed: `Kan CV niet uit afbeelding/PDF lezen. Wil je doorgaan via berichten?`,
      unknown_error: `Iets ging fout. Probeer opnieuw of ga door via berichten.`,
    },
    en: {
      file_too_large: `File too large (max 5MB). Send a smaller CV or continue via messages.`,
      download_timeout: `Download timed out. Try again or send via message.`,
      download_failed: `Couldn't download file. Check if the link is valid.`,
      extraction_failed: `Couldn't read CV from image/PDF. Continue via messages?`,
      unknown_error: `Something went wrong. Try again or continue via messages.`,
    },
    de: {
      file_too_large: `Datei zu groß (max 5MB). Sende ein kleineres CV oder fahre per Nachricht fort.`,
      download_timeout: `Download abgelaufen. Versuche es erneut oder sende eine Nachricht.`,
      download_failed: `Kann Datei nicht herunterladen. Überprüfe den Link.`,
      extraction_failed: `Kann CV aus Bild/PDF nicht lesen. Per Nachricht fortfahren?`,
      unknown_error: `Etwas ist schief gelaufen. Versuche es erneut oder fahre per Nachricht fort.`,
    },
  };

  const langMessages = messages[language] || messages.en;
  return langMessages[errorCode as keyof typeof langMessages] || langMessages.unknown_error;
}

// ============================================
// SNIPPET #5: LOGGING & MONITORING
// ============================================
// Add to track document processing stats

/**
 * Log document processing event for monitoring
 *
 * @param event - Event object
 */
function logDocumentEvent(event: {
  type: "download_start" | "download_success" | "download_fail" | "extraction_success" | "extraction_fail" | "cleanup";
  phone: string;
  clientId: string;
  mediaType?: string;
  fileSize?: number;
  duration?: number;
  error?: string;
}): void {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${event.type.toUpperCase()}: ${event.phone} (${event.clientId}) ${
    event.mediaType || ""
  } ${event.fileSize ? `(${(event.fileSize / 1024).toFixed(2)}KB)` : ""} ${
    event.duration ? `(${event.duration}ms)` : ""
  } ${event.error ? `ERROR: ${event.error}` : ""}`;

  console.log(logEntry);

  // Optionally send to external logging service
  // await sendToLoggingService(event);
}

// ============================================
// END OF CODE SNIPPETS
// ============================================
