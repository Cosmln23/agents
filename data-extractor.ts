/**
 * DATA EXTRACTOR - SEGMENT 3
 * Structured Data Extraction using OpenAI Beta API + Zod
 *
 * @version 3.0
 * @author Recrutare AI - Enterprise Team
 * @description
 *   Extracts structured data from user messages using OpenAI's
 *   beta.chat.completions.parse() API with Zod schemas.
 *
 *   Key Feature: BACKGROUND EXTRACTION
 *   - Happens silently while conversing
 *   - Merges only into EMPTY fields (preserves confirmed data)
 *   - User never sees "extraction" happening
 *   - Prevents repetition of questions
 *
 * Architecture:
 *   User Message
 *     ↓
 *   generateSystemPrompt() [adds context: what we already know]
 *     ↓
 *   extractDataWithStructured() [OpenAI.beta.chat.completions.parse()]
 *     ↓
 *   Zod Validation [guaranteed valid output]
 *     ↓
 *   Merge with session [only into empty fields]
 *     ↓
 *   Silent update (user doesn't see)
 */

import OpenAI from "openai";
import { z } from "zod";
import { UserSession } from "./types/UserSession";
import { ClientConfig } from "./types/ClientConfig";
import {
  UserSessionSchema,
  safeParsePartial,
} from "./schemas/zod-schemas";
import { OpenAIExtended } from "./types/OpenAIExtended";

// ============================================
// EXTRACTION SCHEMA (Minimal)
// ============================================

/**
 * Extraction schema - Only fields we want to extract from user input
 *
 * IMPORTANT: Not all UserSession fields go here.
 * Only the ones we actively collect during conversation.
 *
 * @note
 * All fields are optional/nullable to handle partial extraction
 * Example: If user mentions experience but not education,
 * we extract experience and skip education (leaving it null)
 */
const ExtractionSchema = z.object({
  // Core profile fields for extraction
  nume: z
    .string()
    .nullable()
    .optional()
    .describe("Candidate's full name (e.g., 'John Smith', 'Cosmin Suciu')"),

  education: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Education level and specialization (e.g., 'Liceu Tehnic - Mecanică', 'High School - Mechanics')"
    ),

  experience_summary: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Summary of professional experience (e.g., '5 years warehouse, 2 years driver')"
    ),

  hard_skills: z
    .array(z.string())
    .optional()
    .describe(
      "Technical skills mentioned (e.g., ['Scanner RF', 'SAP', 'Forklift', 'Pallet Jack'])"
    ),

  language_level: z
    .enum(["A1", "A2", "B1", "B2", "C1", "C2"])
    .nullable()
    .optional()
    .describe("Language proficiency level (CEFR: A1-C2)"),

  job_title_desired: z
    .string()
    .nullable()
    .optional()
    .describe("Job title or type user is interested in"),

  // Context notes from conversation
  conversation_notes: z
    .string()
    .nullable()
    .optional()
    .describe("Internal notes: sentiment, tone, engagement level"),
});

/**
 * Inferred TypeScript type for extraction results
 */
export type ExtractionResult = z.infer<typeof ExtractionSchema>;

// ============================================
// MAIN EXTRACTION FUNCTION
// ============================================

/**
 * Extract structured data from user message using OpenAI Beta API
 *
 * CRITICAL FLOW:
 * 1. Send user message + system context to OpenAI
 * 2. Use beta.chat.completions.parse() for guaranteed structured output
 * 3. Zod validates response before returning
 * 4. Return parsed data (null on validation failure)
 * 5. Caller merges this into session (only empty fields)
 *
 * @param userMessage - The message user just sent
 * @param session - Current session (for context: what we already know)
 * @param clientConfig - Client config (for language/agency context)
 * @returns Promise<ExtractionResult | null>
 *
 * @example
 * // User sends: "Mă numesc Cosmin, am lucrat 3 ani la Emag ca Order Picker"
 * const extracted = await extractDataWithStructured(
 *   userMessage,
 *   session,
 *   clientConfig
 * );
 * // Result:
 * // {
 * //   nume: "Cosmin",
 * //   experience_summary: "3 years at Emag as Order Picker",
 * //   hard_skills: ["Depozit handling", "Warehouse systems"]
 * // }
 *
 * @note
 * This happens SILENTLY in background while user is having conversation.
 * No acknowledgment or "extracting data" message shown to user.
 *
 * @note
 * MERGE STRATEGY: Only populate EMPTY fields in session
 * Example:
 *   - Session has education: "Liceu" (from earlier message)
 *   - User message mentions education again
 *   - We extract it BUT don't overwrite session.education
 *   - Prevents data corruption from misunderstandings
 */
async function extractDataWithStructured(
  userMessage: string,
  session: UserSession,
  clientConfig: ClientConfig
): Promise<ExtractionResult | null> {
  try {
    // Step 1: Initialize OpenAI client with type-safe extended API
    const openai = new OpenAIExtended(process.env.OPENAI_API_KEY);

    // Step 2: Build extraction prompt
    // This tells the model: "Here's context about what we already know"
    const extractionPrompt = buildExtractionPrompt(
      userMessage,
      session,
      clientConfig
    );

    console.log(
      `📊 [EXTRACTION] Processing message for ${session.phone} (${clientConfig.clientId})`
    );

    // Step 3: Call OpenAI Beta API with structured output (Type-safe, no `as any`)
    // parseStructured() guarantees response matches schema
    const response = await openai.parseStructured<ExtractionResult>({
      model: "gpt-4o-mini",  // Use mini model for speed (extraction only)
      messages: [
        {
          role: "user",
          content: extractionPrompt,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ExtractionResult",
          schema: ExtractionSchema,
          strict: true,
        },
      },
      temperature: 0,  // Deterministic: low temperature for reliable extraction
    });

    // Step 4: Response is already parsed (parseStructured returns typed data directly)
    const extracted = response as ExtractionResult;

    // Step 5: Validate with Zod
    const validated = ExtractionSchema.parse(extracted);

    console.log(`✅ [EXTRACTION] Success:`, JSON.stringify(validated));

    return validated;
  } catch (error) {
    console.error(`❌ [EXTRACTION] Error: ${error}`);
    return null;
  }
}

/**
 * Build the extraction prompt that tells LLM what to extract
 *
 * This prompt provides CONTEXT to the LLM:
 * "Here's what we already know, here's the new message,
 *  now extract any NEW or UPDATED information"
 *
 * @param userMessage - Latest message from user
 * @param session - Current session state
 * @param clientConfig - Client configuration
 * @returns Formatted extraction prompt
 *
 * @note
 * The prompt is designed to be "smart" about updates:
 * - Extract new information
 * - Don't assume changes to confirmed data
 * - Handle incomplete sentences
 * - Deal with typos and abbreviations
 */
function buildExtractionPrompt(
  userMessage: string,
  session: UserSession,
  clientConfig: ClientConfig
): string {
  // Step 1: List what we already know (to prevent overwriting)
  const knownFields = [];
  if (session.nume) knownFields.push(`✅ Nume: ${session.nume}`);
  if (session.education) knownFields.push(`✅ Educație: ${session.education}`);
  if (session.experience_summary)
    knownFields.push(`✅ Experiență: ${session.experience_summary}`);
  if (session.hard_skills && session.hard_skills.length > 0)
    knownFields.push(
      `✅ Abilități: ${session.hard_skills.join(", ")}`
    );
  if (session.language_level)
    knownFields.push(`✅ Limbă: ${session.language_level}`);
  if (session.job_title_desired)
    knownFields.push(`✅ Job dorit: ${session.job_title_desired}`);

  const knownFieldsText =
    knownFields.length > 0
      ? `WHAT WE ALREADY KNOW:\n${knownFields.join("\n")}\n`
      : `WHAT WE ALREADY KNOW:\n(Nothing yet)\n`;

  // Step 2: Build extraction instructions (multi-language)
  const languageInstructions = {
    ro: `EXTRACTION INSTRUCTIONS:
Extract NEW or UPDATED information from the message below.

${knownFieldsText}

NEW MESSAGE FROM USER:
"${userMessage}"

EXTRACTION RULES:
1. Extract ONLY information explicitly mentioned
2. Do NOT guess or infer
3. If field is already known (listed above), ONLY update if NEW info contradicts
4. For education: look for school level + specialization
5. For experience: look for "company + years + role"
6. For skills: look for "used X", "worked with Y", "know how to Z"
7. For language: look for language name + level (A1-C2, "good", "basic", etc.)
8. If information is unclear or incomplete, set to null
9. conversation_notes: capture sentiment/tone if relevant

Return ONLY the JSON with extracted fields.`,

    nl: `EXTRACTION INSTRUCTIONS:
Extract NEW or UPDATED information from the message below.

${knownFieldsText}

NEW MESSAGE FROM USER:
"${userMessage}"

EXTRACTION RULES:
1. Extract ONLY explicitly mentioned information
2. For education: look for school level + specialization
3. For experience: look for "company + years + role"
4. For skills: tools/software used
5. For language: name + level (A1-C2, "good", "basic")
6. If unclear, set to null

Return ONLY the JSON.`,

    en: `EXTRACTION INSTRUCTIONS:
Extract NEW or UPDATED information from the message below.

${knownFieldsText}

NEW MESSAGE FROM USER:
"${userMessage}"

EXTRACTION RULES:
1. Extract ONLY explicitly mentioned information
2. For education: school level + specialization
3. For experience: company + years + role
4. For skills: tools/software mentioned
5. For language: name + level (A1-C2)
6. If unclear, set to null

Return ONLY the JSON.`,

    de: `EXTRACTION INSTRUCTIONS:
Extract NEW or UPDATED information from the message below.

${knownFieldsText}

NEW MESSAGE FROM USER:
"${userMessage}"

Extract ONLY explicitly mentioned information. Return JSON only.`,
  };

  const instructions =
    languageInstructions[clientConfig.systemLanguage] ||
    languageInstructions.en;

  return instructions;
}

/**
 * Merge extracted data into session
 *
 * CRITICAL: Only merges into EMPTY fields
 * Never overwrites confirmed data
 *
 * @param session - Current session (will be modified in-place)
 * @param extracted - Data extracted from message
 * @returns Updated session
 *
 * @example
 * const session = { phone: "+...", education: "Liceu" }
 * const extracted = { education: "Universitate", hard_skills: ["X", "Y"] }
 *
 * mergeExtractedData(session, extracted);
 * // Result:
 * // session = {
 * //   phone: "+...",
 * //   education: "Liceu",  // NOT overwritten (already had value)
 * //   hard_skills: ["X", "Y"]  // ADDED (was empty)
 * // }
 */
export function mergeExtractedData(
  session: UserSession,
  extracted: ExtractionResult
): UserSession {
  // Step 1: Merge simple string fields (only if empty)
  if (extracted.nume && !session.nume) {
    session.nume = extracted.nume;
    console.log(`   └─ Merged: nume = "${extracted.nume}"`);
  }

  if (extracted.education && !session.education) {
    session.education = extracted.education;
    console.log(`   └─ Merged: education = "${extracted.education}"`);
  }

  if (extracted.experience_summary && !session.experience_summary) {
    session.experience_summary = extracted.experience_summary;
    console.log(`   └─ Merged: experience_summary`);
  }

  if (extracted.language_level && !session.language_level) {
    session.language_level = extracted.language_level;
    console.log(`   └─ Merged: language_level = "${extracted.language_level}"`);
  }

  if (extracted.job_title_desired && !session.job_title_desired) {
    session.job_title_desired = extracted.job_title_desired;
    console.log(`   └─ Merged: job_title_desired`);
  }

  // Step 2: Merge arrays (add to existing)
  if (
    extracted.hard_skills &&
    extracted.hard_skills.length > 0 &&
    (!session.hard_skills || session.hard_skills.length === 0)
  ) {
    session.hard_skills = extracted.hard_skills;
    console.log(
      `   └─ Merged: hard_skills = [${extracted.hard_skills.join(", ")}]`
    );
  }

  // Step 3: Update metadata
  session.lastUpdate = Date.now();
  session.lastMessage = ""; // Clear (we don't store raw messages)

  // Step 4: Validate merged session with Zod
  const validated = safeParsePartial(session);
  if (!validated) {
    console.warn(`⚠️ Merged session validation failed, using original`);
    return session;
  }

  return validated as UserSession;
}

/**
 * Utility: Check if extraction should be attempted
 *
 * Skip extraction if:
 * - Very short message (likely "DA", "NU", "Yes", "No")
 * - Message is just punctuation
 * - Previous message was just extraction
 *
 * @param message - User message
 * @returns true if should attempt extraction
 */
export function shouldExtract(message: string): boolean {
  const trimmed = message.trim();

  // Skip single words that are just consent responses
  const skipWords = ["da", "nu", "yes", "no", "ok", "yep", "nope", "sure"];
  if (skipWords.includes(trimmed.toLowerCase())) {
    return false;
  }

  // Skip if too short
  if (trimmed.length < 5) {
    return false;
  }

  // Skip if only punctuation
  if (!trimmed.match(/[a-zA-Z0-9]/)) {
    return false;
  }

  return true;
}

// ============================================
// EXPORTS
// ============================================

export { extractDataWithStructured };
export { ExtractionSchema };
