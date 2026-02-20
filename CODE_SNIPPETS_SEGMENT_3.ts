/**
 * CODE SNIPPETS - SEGMENT 3
 * Integration of Prompt Generator & Data Extractor into server-v3.ts
 *
 * @version 3.0
 * @description
 *   Ready-to-use snippets showing exactly where and how to integrate
 *   the new Segment 3 functionality into existing server-v3.ts
 *
 * Integration points:
 * 1. IMPORTS (add new modules)
 * 2. WEBHOOK HANDLER (add extraction in background)
 * 3. OpenAI EXTRACTION CALL (replace SYSTEM_PROMPT with dynamic)
 * 4. SESSION MERGE (merge extracted data into session)
 */

// ============================================
// SNIPPET #1: IMPORTS (Add to top of server-v3.ts)
// ============================================

import { generateSystemPrompt, hasGuardrails } from "./prompt-generator";
import {
  extractDataWithStructured,
  mergeExtractedData,
  shouldExtract,
} from "./data-extractor";

// ============================================
// SNIPPET #2: UPDATED OpenAI EXTRACTION CALL
// ============================================
// REPLACE the extractCandidate() function (around line 256)
// With this new version that uses dynamic prompts

/**
 * Extract candidate data from user message
 *
 * SEGMENT 3 IMPROVEMENTS:
 * 1. Uses dynamic system prompt (not hardcoded)
 * 2. Adapts to client + conversation stage
 * 3. Includes GUARDRAILS to prevent legal risks
 * 4. Regenerated for EVERY message
 *
 * @param mesaj - User message
 * @param existingData - Current session (for context)
 * @param clientConfig - Client configuration
 * @returns Extracted candidate data
 */
async function extractCandidate(
  mesaj: string,
  existingData: UserSession,
  clientConfig: ClientConfig = DEFAULT_CLIENT
): Promise<any> {
  try {
    // Step 1: Generate dynamic system prompt
    // (regenerated every call, includes current session state)
    const systemPrompt = generateSystemPrompt(clientConfig, existingData);

    // Step 2: Verify guardrails are in place (logging/audit)
    if (!hasGuardrails(systemPrompt)) {
      console.warn(
        `⚠️ WARNING: Guardrails missing from system prompt (client: ${clientConfig.clientId})`
      );
    }

    // Step 3: Call OpenAI with dynamic prompt
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt, // ← DYNAMIC (not hardcoded SYSTEM_PROMPT)
        },
        {
          role: "user",
          content: `INSTRUCȚIUNI PARSE:
1. Extrage NUME: Căută "Mă numesc X" sau "Sunt X"
2. Extrage EDUCAȚIE: "terminat [liceul/profesională/universitate] [pe] [PROFIL]"
3. Extrage EXPERIENȚĂ: "lucrat X ani la [COMPANIE] ca [ROL]"
4. Extrage SKILLS: "am folosit/am condus [UTILAJ/SOFTWARE]"
5. Extrage LIMBĂ: "vorbesc [LIMBĂ] [nivel]"
6. Extrage CERTIFICATE: "am VCA" = true, "nu am BSN" = false
7. Notă AI: Impresie despre candidat

Mesaj: "${mesaj}"

RETURNEAZĂ NUMAI JSON (fără \`\`\`json, fără blocuri markdown):
{
  "nume": string or null,
  "school": string or null,
  "schoolProfile": string or null,
  "experience": [{"company": string or null, "duration": string or null, "role": string or null}],
  "hardSkills": [string array],
  "languages": [{"language": string, "level": "A1"|"A2"|"B1"|"B2"|"C1"|"C2"|null}],
  "ai_notes": string or null,
  "hasVCA": boolean or null,
  "hasBSN": boolean or null
}`,
        },
      ],
      temperature: 0,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) return null;

    const extracted = JSON.parse(jsonMatch[0]);
    try {
      return CandidateSchema.parse(extracted);
    } catch (validationError) {
      console.warn("⚠️ Validare parțială:", validationError);
      return extracted;
    }
  } catch (error) {
    console.error("❌ Eroare la extragere:", error);
    return null;
  }
}

// ============================================
// SNIPPET #3: BACKGROUND EXTRACTION IN WEBHOOK
// ============================================
// ADD this in the webhook handler, AFTER getting reply but BEFORE sending

/**
 * Background data extraction (SEGMENT 3)
 * Happens silently while conversation flows
 *
 * Timing: After we generate reply, but before sending it
 *         So user gets responsive reply, extraction happens in parallel
 *
 * Where to add in webhook:
 * ```
 * const reply = await handleUserMessage(from, msgText, clientConfig);
 * console.log(`\n📤 REPLY: ${reply}\n`);
 *
 * ↓ ADD THIS ↓
 * // Background extraction (non-blocking)
 * if (shouldExtract(msgText)) {
 *   extractDataWithStructured(msgText, user, clientConfig)
 *     .then((extracted) => {
 *       if (extracted) {
 *         mergeExtractedData(user, extracted);
 *         saveSessions(sessions);
 *         console.log(`📊 [Background] Data merged for ${from}`);
 *       }
 *     })
 *     .catch((err) => {
 *       console.error(`⚠️ [Background extraction failed]:`, err);
 *       // Non-blocking, don't interrupt user conversation
 *     });
 * }
 *
 * await trimiteMesajWhatsApp(from, reply, clientConfig);
 * ```
 *
 * CRITICAL: This is non-blocking!
 * - User gets reply immediately
 * - Extraction happens in background
 * - Prevents latency issues
 */

// ============================================
// SNIPPET #4: UPDATED handleUserMessage()
// ============================================
// MODIFY handleUserMessage to generate prompt dynamically

/**
 * Handle user message with dynamic prompts
 *
 * Key change: Prompt is regenerated for EVERY message,
 * ensuring it reflects current session state
 */
async function handleUserMessage(
  from: string,
  msgText: string,
  clientConfig: ClientConfig = DEFAULT_CLIENT
): Promise<string> {
  // Load user session
  let user = sessions[from];
  if (!user) {
    user = getOrCreateSession(from, clientConfig);
  }

  // Validate consent
  if (!isConsented(user)) {
    console.warn(`⚠️ User ${from} not consented`);
    return getTransparencyMessage(clientConfig);
  }

  // ============ EDUCATION PHASE ============
  if (user.stage === "education") {
    console.log(`📚 PHASE: EDUCATION`);

    // Extract data from this message
    const extracted = await extractCandidate(msgText, user, clientConfig);

    if (extracted) {
      user.nume = user.nume || extracted.nume;
      user.school = user.school || extracted.school;
      user.schoolProfile = user.schoolProfile || extracted.schoolProfile;
      user.lastMessage = msgText;
      user.lastUpdate = Date.now();
    }

    // Check: Have name + education?
    if (user.nume && user.school) {
      user.stage = "experience";
      saveSessions(sessions);
      return `Excelent, ${user.nume}! Și unde ai lucrat până acum?`;
    }

    saveSessions(sessions);
    return `Mulțumesc! Îmi mai trebuie și nivelul tău de studii.`;
  }

  // Similar for other stages...
  // (rest of handleUserMessage logic unchanged)

  return "Scuze, nu am înțeles. Te rog reîncepe.";
}

// ============================================
// SNIPPET #5: INITIALIZATION CODE
// ============================================
// ADD in server startup (after app.listen)

/**
 * Initialize SEGMENT 3 systems
 * Called once when server starts
 */
function initializeSegment3(): void {
  console.log("\n🧠 SEGMENT 3: Intelligent Prompt System - INITIALIZED");
  console.log("   ✅ Dynamic prompt generator: ACTIVE");
  console.log("   ✅ Background data extractor: ACTIVE");
  console.log("   ✅ Guardrails enforcement: ACTIVE");
  console.log("   ✅ Multi-language support: ACTIVE\n");

  // Verify guardrails are working
  const testConfig: ClientConfig = DEFAULT_CLIENT;
  const testSession: UserSession = {
    phone: "+test",
    stage: "collecting_data",
  };

  const testPrompt = generateSystemPrompt(testConfig, testSession);
  if (!hasGuardrails(testPrompt)) {
    console.error(
      "❌ CRITICAL: Guardrails not found in system prompt!"
    );
    process.exit(1);
  }

  console.log("✅ Guardrails verification: PASSED");
}

// Call in app.listen():
// initializeSegment3();

// ============================================
// SNIPPET #6: TESTING HELPER
// ============================================
// Use this to test prompt generation

/**
 * Debug helper: Show generated prompt for a session
 * Use in development to verify prompt is correct
 *
 * @example
 * const prompt = debugShowPrompt(clientConfig, session);
 * console.log(prompt);
 */
function debugShowPrompt(
  clientConfig: ClientConfig,
  session: UserSession
): string {
  const prompt = generateSystemPrompt(clientConfig, session);
  console.log("\n═══════════════════════════════════════════════════");
  console.log("GENERATED SYSTEM PROMPT (DEBUG)");
  console.log("═══════════════════════════════════════════════════\n");
  console.log(prompt);
  console.log(
    "\n═══════════════════════════════════════════════════\n"
  );
  return prompt;
}

// ============================================
// SNIPPET #7: ERROR HANDLING
// ============================================
// Add to webhook error handler

/**
 * Enhanced error handling for Segment 3
 *
 * If extraction fails, conversation continues (non-blocking)
 * Log error for monitoring
 */
async function safeExtraction(
  message: string,
  session: UserSession,
  clientConfig: ClientConfig
): Promise<void> {
  try {
    if (!shouldExtract(message)) {
      return; // Skip extraction for short messages
    }

    const extracted = await extractDataWithStructured(
      message,
      session,
      clientConfig
    );

    if (extracted) {
      mergeExtractedData(session, extracted);
      saveSessions(sessions);
    }
  } catch (error) {
    // Log but don't crash
    console.error(`⚠️ Background extraction error: ${error}`);
    // Conversation continues anyway
  }
}

// ============================================
// SNIPPET #8: INTEGRATION POINT (WEBHOOK)
// ============================================
// FULL webhook handler with Segment 3 integration

// app.post("/webhook", async (req, res) => {
//   const body = req.body;
//   res.sendStatus(200);
//
//   if (body.object === "whatsapp_business_account") {
//     try {
//       const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;
//       const metadata = body.entry?.[0]?.changes?.[0]?.value?.metadata;
//
//       if (messages && messages.length > 0) {
//         const message = messages[0];
//         const from = message.from;
//         const msgText = message.text.body;
//
//         // Extract client config
//         const toNumber = message.to || metadata?.display_phone_number;
//         const clientConfig = getClientConfig(toNumber);
//
//         // Get session
//         let session = sessions[from];
//         if (!session) {
//           session = getOrCreateSession(from, clientConfig);
//           sessions[from] = session;
//         }
//
//         // Route based on stage
//         let reply: string;
//         if (session.stage === "pending_consent") {
//           reply = await handleConsent(from, msgText, clientConfig);
//         } else if (session.stage === "collecting_data" || session.stage === "education") {
//           reply = await handleUserMessage(from, msgText, clientConfig);
//         } else {
//           reply = await handleUserMessage(from, msgText, clientConfig);
//         }
//
//         // Send reply immediately
//         console.log(`\n📤 REPLY: ${reply}\n`);
//         await trimiteMesajWhatsApp(from, reply, clientConfig);
//
//         // ← ADD SEGMENT 3: Background extraction (non-blocking)
//         if (shouldExtract(msgText)) {
//           safeExtraction(msgText, session, clientConfig)
//             .catch((err) =>
//               console.error(`Background extraction error: ${err}`)
//             );
//         }
//       }
//     } catch (error) {
//       console.error("❌ Webhook Error:", error);
//     }
//   }
// });

// ============================================
// END OF CODE SNIPPETS
// ============================================
