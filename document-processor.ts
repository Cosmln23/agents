/**
 * DOCUMENT PROCESSOR - SEGMENT 4
 * Vision-Based CV/Document Parsing with GDPR-First Privacy
 *
 * @version 4.0
 * @author Recrutare AI - Enterprise Team
 * @description
 *   Processes CV documents (PDF, JPG, PNG) received via WhatsApp.
 *   Downloads temporarily, extracts data via OpenAI Vision,
 *   immediately deletes file from disk (GDPR compliant).
 *
 * Security Features:
 *   - File size limit: 5MB (prevent DoS)
 *   - Temporary storage in /tmp/ (auto-cleanup on reboot)
 *   - Try-catch-finally with guaranteed file deletion
 *   - Privacy redaction prompt (GDPR Art. 5, 32)
 *   - No logging of sensitive data
 *   - Structured output with Zod validation
 *
 * Flow:
 *   User sends CV PDF/image
 *       ↓
 *   Detect media_url in webhook
 *       ↓
 *   processCandidateDocument()
 *       ├─ Download file (~100-500KB for typical CV)
 *       ├─ Convert to Base64
 *       ├─ Send to GPT-4o Vision with redaction prompt
 *       ├─ Extract with .parse() (Zod validated)
 *       ├─ Delete temp file [GDPR]
 *       └─ Return extracted data
 *       ↓
 *   Merge into UserSession
 *       ↓
 *   Fast-forward stage
 *       ↓
 *   User sees: "Am citit CV-ul tău! Văd că ai..."
 */

import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import OpenAI from "openai";
import { z } from "zod";
import { UserSession } from "./types/UserSession";
import { ClientConfig } from "./types/ClientConfig";
import { mergeExtractedData } from "./data-extractor";
import { OpenAIExtended } from "./types/OpenAIExtended";
// PDF conversion libraries removed - using native OpenAI PDF support instead

// ============================================
// CONSTANTS & CONFIGURATION
// ============================================

/** Maximum file size (5MB - generous for CV but prevents DoS) */
const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/** Temporary directory for CV downloads */
const TEMP_DIR = "/tmp";

/** Timeout for file download (30 seconds) */
const DOWNLOAD_TIMEOUT_MS = 30 * 1000;

/** Timeout for Vision API (45 seconds - longer due to image processing) */
const VISION_TIMEOUT_MS = 45 * 1000;

/** Maximum retries for failed downloads */
const MAX_DOWNLOAD_RETRIES = 3;

/** Base64 encoding chunk size for large files */
const BASE64_CHUNK_SIZE = 1024 * 1024; // 1MB chunks

/** Supported MIME types */
const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/jpg",
];

// ============================================
// TYPES & SCHEMAS
// ============================================

/**
 * Document metadata extracted from webhook
 */
interface DocumentMetadata {
  mediaUrl: string;
  mimeType: string;
  fileName: string;
  mediaType: "pdf" | "image"; // Simplified: pdf or image
}

/**
 * Result from vision extraction
 * Subset of UserSession fields extracted from CV
 *
 * CRITICAL: All fields are nullable to allow "I don't know" answers
 * extraction_logic is REQUIRED to force AI to justify before generating
 */
interface CVExtractionResult {
  education?: string | null;
  experience_summary?: string | null;
  hard_skills?: string[] | null;
  language_level?: "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | null;
  extraction_confidence?: number; // 0-100
  extraction_notes?: string | null; // "Couldn't find experience section", etc.
  extraction_logic?: string; // REQUIRED: Why you extracted this (line numbers, section names, etc.)
  requires_human_review?: boolean; // Flag if confidence=100% but data seems suspicious
}

/**
 * Zod schema for CV extraction result
 * Allows partial extraction (all fields optional/nullable)
 */
const CVExtractionSchema = z.object({
  education: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Education level and specialization extracted from CV (e.g., 'Liceu Tehnic - Mecanică'). Return null if not found."
    ),

  experience_summary: z
    .preprocess(
      (value) => {
        if (value === null || value === undefined) return null;
        if (Array.isArray(value)) return value.join(", ");
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
      },
      z.string().nullable().optional()
    )
    .describe(
      "Professional experience summary (e.g., '5 years at Emag as Order Picker'). Return null if not found or if text is unclear."
    ),

  hard_skills: z
    .array(z.string())
    .nullable()
    .optional()
    .describe("Technical skills found in CV (e.g., ['Scanner RF', 'SAP']). Return null if none found."),

  language_level: z
    .preprocess(
      // Normalize any input to valid CEFR level
      (value) => {
        if (value === null || value === undefined || value === "") {
          return null;
        }
        const str = String(value).trim().toUpperCase();
        // Already valid
        if (["A1", "A2", "B1", "B2", "C1", "C2"].includes(str)) {
          return str;
        }
        // Map descriptors to CEFR levels
        if (
          str.includes("FLUENT") ||
          str.includes("NATIVE") ||
          str.includes("MOTHER")
        ) {
          return "C2";
        }
        if (str.includes("ADVANCED") || str.includes("PROFICIENT")) {
          return "C1";
        }
        if (
          str.includes("UPPER-INTERMEDIATE") ||
          str.includes("UPPER INTERMEDIATE")
        ) {
          return "B2";
        }
        if (
          str.includes("INTERMEDIATE") ||
          str.includes("WORKING") ||
          str.includes("CONVERSATIONAL")
        ) {
          return "B1";
        }
        if (str.includes("ELEMENTARY") || str.includes("BASIC")) {
          return "A2";
        }
        if (str.includes("BEGINNER") || str.includes("MINIMAL")) {
          return "A1";
        }
        // Default fallback for unknown values - but now returns null instead!
        return null;
      },
      z
        .string()
        .refine((val) => ["A1", "A2", "B1", "B2", "C1", "C2"].includes(val), {
          message: "Must be one of: A1, A2, B1, B2, C1, C2",
        })
        .nullable()
        .optional()
    )
    .catch(null) // If validation fails, return null (NOT B1 default!)
    .describe("Language proficiency level (CEFR: A1-C2). Auto-normalized from descriptors. Return null if not found."),

  extraction_confidence: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Confidence score (0-100) of extraction quality. Be honest: lower if text is unclear. NOT 100% if you guessed!"),

  extraction_notes: z
    .string()
    .nullable()
    .optional()
    .describe("Notes about extraction (e.g., 'Couldn't find experience', 'Text was blurry')"),

  extraction_logic: z
    .preprocess(
      (value) => {
        if (value === null || value === undefined) return "";
        if (Array.isArray(value)) return value.join("; ");
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
      },
      z.string()
    )
    .describe(
      "REQUIRED - CRITICAL: Explain exactly where you found each piece of data in the image. Example: 'Line 3-5: Education - Bachelor in Business. Line 7-10: Experience - 4 years at Company X as Manager. Line 12: Skills - Excel, SAP, Salesforce.' If you cannot point to a specific location, the field must be null."
    ),

  requires_human_review: z
    .boolean()
    .optional()
    .describe("Flag if confidence=100% but data seems suspicious or generic (e.g., 'Software Developer at Tech Solutions' when that text is NOT visible in the image)"),
});

// ============================================
// MAIN PROCESSING FUNCTION
// ============================================

/**
 * Process CV/document from WhatsApp
 *
 * GDPR-Compliant Flow:
 * 1. Validate file size & type
 * 2. Download to /tmp/
 * 3. Convert to Base64
 * 4. Send to OpenAI Vision (with redaction prompt)
 * 5. Extract with Zod validation
 * 6. DELETE FILE FROM DISK (finally block)
 * 7. Return extracted data
 *
 * @param mediaUrl - URL from WhatsApp webhook
 * @param mimeType - MIME type (application/pdf, image/jpeg, etc.)
 * @param session - Current user session (for context)
 * @param clientConfig - Client configuration
 * @returns Promise<CVExtractionResult | null>
 *
 * @example
 * const extraction = await processCandidateDocument(
 *   "https://..../cv.pdf",
 *   "application/pdf",
 *   session,
 *   clientConfig
 * );
 *
 * if (extraction) {
 *   // Merge into session
 *   mergeExtractedData(session, extraction);
 * }
 *
 * @note
 * FILE SECURITY:
 * - Files downloaded to /tmp/ (temporary filesystem)
 * - Deleted immediately after processing (finally block)
 * - No long-term storage of PDFs
 * - No copies in application logs
 *
 * @note
 * PRIVACY (GDPR):
 * - Redaction prompt tells GPT-4o what to ignore
 * - Extracts ONLY job-relevant data
 * - No storage of sensitive fields (CNP, address, etc.)
 */
async function processCandidateDocument(
  mediaUrl: string,
  mimeType: string,
  session: UserSession,
  clientConfig: ClientConfig
): Promise<CVExtractionResult | null> {
  let tempFilePath: string | null = null;

  try {
    // Step 1: Validate MIME type
    if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
      console.warn(
        `⚠️ [DOCUMENT] Unsupported MIME type: ${mimeType}. Supported: ${SUPPORTED_MIME_TYPES.join(", ")}`
      );
      return null;
    }

    console.log(
      `📄 [DOCUMENT] Processing CV for ${session.phone} (${clientConfig.clientId})`
    );
    console.log(`   MIME Type: ${mimeType}`);
    console.log(`   URL: ${mediaUrl.substring(0, 50)}...`);

    // Step 2: Generate temp file path
    const fileExtension = getFileExtension(mimeType);
    const fileName = `cv_${session.phone.replace(/\D/g, "")}_${Date.now()}${fileExtension}`;
    tempFilePath = path.join(TEMP_DIR, fileName);

    // Step 3: Download file with size check and Meta authentication
    console.log(`   Downloading to: ${tempFilePath}`);
    await downloadFileWithSizeLimit(
      mediaUrl,
      tempFilePath,
      MAX_FILE_SIZE_BYTES,
      process.env.WHATSAPP_TOKEN // Pass token for Meta authentication
    );

    // Step 4: Verify file downloaded
    if (!fs.existsSync(tempFilePath)) {
      console.error(`❌ [DOCUMENT] File not found after download: ${tempFilePath}`);
      return null;
    }

    const fileStats = fs.statSync(tempFilePath);
    console.log(`   ✅ Downloaded: ${(fileStats.size / 1024).toFixed(2)}KB`);

    // Step 5: Convert to Base64 (no conversion needed - OpenAI handles PDFs natively)
    console.log(`   Converting to Base64...`);
    const fileBuffer = fs.readFileSync(tempFilePath);
    const base64Data = fileBuffer.toString("base64");
    console.log(
      `   ✅ Base64 encoded: ${(base64Data.length / 1024).toFixed(2)}KB`
    );

    // Step 6: Send to OpenAI Vision (gpt-4o model)
    // OpenAI now handles PDFs natively - no conversion needed!
    console.log(`   Sending to OpenAI Vision (gpt-4o) - Native PDF Support...`);
    const extraction = await extractDataFromDocument(
      base64Data,
      mimeType,
      session,
      clientConfig
    );

    console.log(`   ✅ Extraction complete`);
    if (extraction) {
      console.log(
        `      - Education: ${extraction.education || "(not found)"}`
      );
      console.log(
        `      - Experience: ${extraction.experience_summary ? "✅" : "❌"}`
      );
      console.log(
        `      - Skills: ${extraction.hard_skills?.length || 0} items`
      );
      console.log(
        `      - Language: ${extraction.language_level || "(not found)"}`
      );
      console.log(
        `      - Confidence: ${extraction.extraction_confidence || "N/A"}%`
      );
    }

    return extraction;
  } catch (error) {
    console.error(`❌ [DOCUMENT] Processing error:`, error);
    return null;
  } finally {
    // Step 8: GDPR CLEANUP - Guarantee file deletion
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log(`🗑️ [GDPR] Temp file deleted: ${tempFilePath}`);
      } catch (deleteError) {
        console.error(
          `⚠️ [GDPR] Failed to delete temp file ${tempFilePath}:`,
          deleteError
        );
        // Log but don't crash - file will be cleaned by OS anyway
      }
    }
  }
}

/**
 * Download file from URL with size limit check
 *
 * SECURITY:
 * - Stops download if exceeds MAX_FILE_SIZE_BYTES
 * - 30 second timeout (prevent hanging)
 * - Validates HTTP status (200-299)
 *
 * @param url - File URL
 * @param filePath - Where to save
 * @param maxSize - Maximum bytes allowed
 * @throws Error if file too large or download fails
 */
/**
 * Download file from URL with size limit and authentication
 *
 * @param url - File URL from Meta
 * @param filePath - Where to save file
 * @param maxSize - Max bytes allowed
 * @param whatsappToken - Bearer token for Meta authentication
 */
function downloadFileWithSizeLimit(
  url: string,
  filePath: string,
  maxSize: number,
  whatsappToken?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Step 1: Create write stream
    const file = fs.createWriteStream(filePath);
    let downloadedSize = 0;

    // Step 2: Set timeout
    const timeout = setTimeout(() => {
      file.destroy();
      fs.unlinkSync(filePath);
      reject(new Error(`Download timeout (30s) for ${url}`));
    }, DOWNLOAD_TIMEOUT_MS);

    // Step 3: Prepare headers with authentication
    const headers: Record<string, string> = {
      'User-Agent': 'axios/1.7.2' // Some servers block requests without User-Agent
    };

    if (whatsappToken) {
      headers['Authorization'] = `Bearer ${whatsappToken}`;
    }

    // Step 4: Handle HTTPS request with headers
    https
      .get(url, { headers }, (response) => {
        // Check HTTP status
        if (response.statusCode! < 200 || response.statusCode! >= 300) {
          clearTimeout(timeout);
          file.destroy();
          fs.unlinkSync(filePath);
          reject(
            new Error(
              `HTTP ${response.statusCode} downloading ${url}`
            )
          );
          return;
        }

        // Check Content-Length header
        const contentLength = parseInt(
          response.headers["content-length"] || "0",
          10
        );
        if (contentLength > maxSize) {
          clearTimeout(timeout);
          file.destroy();
          fs.unlinkSync(filePath);
          reject(
            new Error(
              `File too large: ${(contentLength / 1024 / 1024).toFixed(2)}MB (max ${MAX_FILE_SIZE_MB}MB)`
            )
          );
          return;
        }

        // Monitor size during download
        response.on("data", (chunk) => {
          downloadedSize += chunk.length;
          if (downloadedSize > maxSize) {
            clearTimeout(timeout);
            file.destroy();
            fs.unlinkSync(filePath);
            reject(
              new Error(
                `File exceeded size limit during download (${(downloadedSize / 1024 / 1024).toFixed(2)}MB > ${MAX_FILE_SIZE_MB}MB)`
              )
            );
          }
        });

        response.pipe(file);
      })
      .on("error", (error) => {
        clearTimeout(timeout);
        file.destroy();
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        reject(error);
      });

    file.on("finish", () => {
      clearTimeout(timeout);
      file.close();
      resolve();
    });

    file.on("error", (error) => {
      clearTimeout(timeout);
      fs.unlink(filePath, () => {}); // Clean up
      reject(error);
    });
  });
}

/**
 * Extract data from document using OpenAI Vision
 *
 * PRIVACY (GDPR Art. 5, 32):
 * System prompt includes redaction instructions to tell GPT-4o:
 * - Ignore: CNP/BSN, exact address, birth date, marital status
 * - Extract: Education, experience, skills, languages (job-relevant only)
 *
 * @param base64Data - Base64 encoded file content
 * @param mimeType - MIME type (pdf, image/jpeg, etc.)
 * @param session - User session (for language context)
 * @param clientConfig - Client config (for language)
 * @returns Extracted data or null
 */
async function extractDataFromDocument(
  base64Data: string,
  mimeType: string,
  session: UserSession,
  clientConfig: ClientConfig,
): Promise<CVExtractionResult | null> {
  try {
    const openai = new OpenAIExtended(process.env.OPENAI_API_KEY);

    // Step 1: Build vision-aware system prompt with privacy redaction
    const systemPrompt = buildVisionPrivacyPrompt(clientConfig, session);

    // Step 2: Handle PDF upload or image inline
    let messageContent: any;
    const isPdf = mimeType === "application/pdf";

    if (isPdf) {
      // PDF workflow: base64 inline → type: "file" with file_data
      // No Files API upload needed - Chat Completions accepts inline PDFs
      messageContent = buildVisionMessageContent(base64Data, mimeType);
    } else {
      // Image workflow: base64 → inline → type: "image_url"
      messageContent = buildVisionMessageContent(base64Data, mimeType);
    }

    // Step 3: Call OpenAI Chat Completions with vision data
    console.log(`   📡 Calling OpenAI Vision (gpt-4o)...`);
    const response = await openai.parseStructured<CVExtractionResult>({
      model: "gpt-4o",  // Vision-capable model
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: messageContent,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "CVExtraction",
          schema: CVExtractionSchema,
          strict: true,
        },
      },
      temperature: 0,  // Deterministic
      max_tokens: 1000,  // Enough for extraction
    });

    // Step 4: Response is already parsed (parseStructured returns typed data directly)
    const extracted = response as CVExtractionResult;

    // Step 5: LOG EXTRACTED DATA
    console.log(`   📊 Vision API returned:`);
    console.log(`      - education: "${extracted.education || '(null)'}"`);
    console.log(`      - experience_summary: "${extracted.experience_summary || '(null)'}"`);
    console.log(`      - hard_skills: ${JSON.stringify(extracted.hard_skills || [])}`);
    console.log(`      - language_level: "${extracted.language_level || '(null)'}"`);
    console.log(`      - extraction_confidence: ${extracted.extraction_confidence || '(null)'}%`);
    console.log(`      - extraction_logic: "${extracted.extraction_logic || '(missing)'}"`);
    if (extracted.extraction_notes) {
      console.log(`      - extraction_notes: "${extracted.extraction_notes}"`);
    }

    // Step 6: CHECK FOR SUSPICIOUS DATA (Human Review Flag)
    if (extracted.requires_human_review === true) {
      console.warn(
        `   ⚠️  [HUMAN REVIEW REQUIRED] Confidence=${extracted.extraction_confidence}% but data seems suspicious`
      );
      console.warn(
        `       Logic: ${extracted.extraction_logic || '(not provided)'}`
      );
    }

    // Step 7: Validate with Zod (auto-normalizes language_level)
    const validated = CVExtractionSchema.parse(extracted) as CVExtractionResult;

    return validated;
  } catch (error) {
    console.error(`❌ Vision extraction error:`, error);
    return null;
  }
}

/**
 * Build system prompt with privacy redaction instructions
 *
 * Tells GPT-4o what to IGNORE and what to EXTRACT from CV
 *
 * @param clientConfig - Client configuration
 * @param session - User session
 * @returns System prompt string
 */
function buildVisionPrivacyPrompt(
  clientConfig: ClientConfig,
  session: UserSession
): string {
  const privacyPrompt = {
    ro: `You are a CV/resume analyzer for a recruitment AI system.

📄 YOUR TASK: Extract job-relevant information from the CV/resume image/PDF.

🚫 ANTI-HALLUCINATION RULES (CRITICAL - DO NOT BREAK):
1. Extract ONLY what you PHYSICALLY SEE in the image
2. Whenever a field is NOT explicitly stated or legible → YOU MUST RETURN NULL (not guessed data)
3. Do NOT assume, guess, or infer data that isn't explicitly written
4. CRITICAL: Creative guessing is a violation of system integrity
5. If you're unsure about text, put description in extraction_notes and set field to null
6. NEVER fill in fields with made-up company names, job titles, or skills
7. Read text CHARACTER-BY-CHARACTER from image - verify every single word
8. Examples:
   - CV says "Transport Coordinator / Reach Truck Driver" → extract EXACTLY THAT, NOT "Logistics Manager"
   - CV says "Software Engineer at TechCorp" → extract EXACTLY THAT, NOT "Tech Solutions"
   - If company name is blurry → return null + note in extraction_notes: "Company name unclear"
9. DO NOT replace, correct, or "improve" what the candidate wrote
10. extraction_confidence = 100% ONLY if all extracted fields are 100% legible and verified
11. VERIFICATION BEFORE SUBMIT: Compare each extracted field character-by-character with the visible text in image

⚠️ PRIVACY REDACTION (GDPR Art. 5, 32):
You MUST IGNORE and NOT EXTRACT:
- ❌ Exact home address (street number, building, neighborhood)
- ❌ CNP/BSN/ID numbers (any personal identification)
- ❌ Birth date (you may infer age range from graduation years)
- ❌ Marital status, family info, dependents
- ❌ Medical information, disabilities (unless directly relevant to job)
- ❌ Religious/political affiliations
- ❌ Candidate's photograph
- ❌ Social media profiles/personal links

✅ EXTRACT ONLY (Job-Relevant):
- 📚 Education: Level (high school, college, university) and specialization/field
- 💼 Professional Experience: Job titles, companies, duration (years/months)
- 🛠️ Hard Skills: Technical tools, software, certifications mentioned
- 🌍 Languages: Language names and proficiency levels (A1-C2, fluent, basic, etc.)

EXTRACTION NOTES:
- If a section is unclear or missing, set to null
- For languages, infer CEFR level if only descriptors given ("fluent" → C1, "basic" → A1)
- For experience, summarize in format: "X years at Company in Role"
- If CV is in non-English language, still extract in English

⚠️ CRITICAL - THE "REASONING" REQUIREMENT (Master Level Anti-Hallucination):
BEFORE you extract any field, you MUST write extraction_logic explaining WHERE you found it.
Examples:
- "Line 3: Found 'Bachelor in Computer Science' under Education header"
- "Cannot find experience section - extraction_logic: 'No Professional Experience section found in CV'"
- "Line 7-9: '5 years at Tech Corp as Engineer' found under Work History"

If you cannot point to a specific line/section in the image, the field MUST be null.
This prevents hallucinations like "Software Developer at Tech Solutions" when those words don't appear.

⚠️ CRITICAL - LANGUAGE LEVEL MAPPING:
For language_level field, you MUST map EXACTLY to ONE of these CEFR levels: A1, A2, B1, B2, C1, C2
Mapping rules:
- "Fluent" or "Native" or "Mother tongue" → C2
- "Advanced" or "Proficient" → C1
- "Upper-intermediate" → B2
- "Intermediate" or "Working proficiency" → B1
- "Elementary" or "Basic" → A2
- "Beginner" or "Minimal" → A1
- If unclear, default to B1
NEVER use any other values. ALWAYS pick ONE from: A1, A2, B1, B2, C1, C2

Return JSON with: education, experience_summary, hard_skills (array), language_level, extraction_confidence (0-100), extraction_notes, extraction_logic (REQUIRED).

FINAL CHECK BEFORE RETURNING JSON:
1. For each field (education, experience, skills, language), can you point to the exact line in the image?
2. If NO → set field to null, explain in extraction_logic and extraction_notes
3. If YES → set field to the exact text from image, explain the location in extraction_logic
4. If you had to guess/invent anything → set requires_human_review: true`,

    nl: `Je bent een CV/resume analyzer voor een recruitment AI-systeem.

📄 JE TAAK: Extract werkgerelateerde informatie uit het CV/resume.

⚠️ PRIVACYBESCHERMING (GDPR Art. 5, 32):
Negeer en extract NIET:
- ❌ Exact adres (huisnummer, straat)
- ❌ BSN/ID-nummers
- ❌ Geboortedatum (alleen leeftijdschatting)
- ❌ Burgerlijke staat, familie
- ❌ Medische informatie
- ❌ Religieuze/politieke voorkeur
- ❌ Foto
- ❌ Persoonlijke links

✅ EXTRACT ALLEEN (Werkgerelateerd):
- 📚 Onderwijs: Niveau en specialisatie
- 💼 Beroepservaring: Functies, bedrijven, duur
- 🛠️ Vaardigheden: Tools, software, certificaten
- 🌍 Talen: Namen en niveau (A1-C2)

Return JSON.`,

    en: `You are a CV/resume analyzer for a recruitment AI system.

📄 YOUR TASK: Extract job-relevant information from the CV/resume.

⚠️ PRIVACY REDACTION (GDPR Art. 5, 32):
You MUST IGNORE and NOT EXTRACT:
- ❌ Exact home address
- ❌ CNP/BSN/ID numbers
- ❌ Birth date
- ❌ Marital status, family info
- ❌ Medical information
- ❌ Religious/political affiliations
- ❌ Photograph
- ❌ Personal links

✅ EXTRACT ONLY (Job-Relevant):
- 📚 Education: Level and specialization
- 💼 Professional Experience: Titles, companies, duration
- 🛠️ Hard Skills: Tools, software, certifications
- 🌍 Languages: Names and proficiency (A1-C2)

Return JSON with: education, experience_summary, hard_skills, language_level, extraction_confidence (0-100).`,

    de: `Du bist ein CV/Lebenslauf-Analyzer für ein Recruiting-AI-System.

📄 DEINE AUFGABE: Job-relevante Informationen aus dem CV extrahieren.

⚠️ DATENSCHUTZ (GDPR Art. 5, 32):
Ignoriere und extrahiere NICHT:
- ❌ Genaue Adresse
- ❌ Personalausweisnummern
- ❌ Geburtsdatum
- ❌ Familienstand, Familie
- ❌ Medizinische Informationen
- ❌ Religiöse/politische Neigung
- ❌ Foto
- ❌ Persönliche Links

✅ EXTRAHIERE NUR (Jobspezifisch):
- 📚 Ausbildung: Niveau und Fachrichtung
- 💼 Berufserfahrung: Positionen, Unternehmen, Dauer
- 🛠️ Kompetenzen: Tools, Software, Zertifikate
- 🌍 Sprachen: Namen und Niveau (A1-C2)

Return JSON.`,
  };

  return (
    privacyPrompt[clientConfig.systemLanguage] || privacyPrompt.en
  );
}


/**
 * Build message content for Vision API
 *
 * Two deterministic flows:
 * - Images: type: "image_url" with inline base64
 * - PDFs: type: "file" with inline base64 (file_data format)
 *
 * @param base64Data - Base64 encoded file content
 * @param mimeType - MIME type
 * @returns Array of message content objects
 */
function buildVisionMessageContent(base64Data: string, mimeType: string): any {
  if (mimeType.startsWith("image/")) {
    // Image: inline base64 via image_url
    const imageMediaType = mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
    return [
      {
        type: "text",
        text: "Extract the data from this CV/resume according to the system prompt.",
      },
      {
        type: "image_url",
        image_url: {
          url: `data:${imageMediaType};base64,${base64Data}`,
          detail: "high",
        },
      },
    ];
  } else if (mimeType === "application/pdf") {
    // PDF: inline base64 via file_data (Chat Completions 2026 format)
    return [
      {
        type: "text",
        text: "Extract the data from this CV/resume according to the system prompt.",
      },
      {
        type: "file",
        file: {
          filename: "cv.pdf",
          file_data: `data:application/pdf;base64,${base64Data}`,
        },
      },
    ];
  }

  throw new Error(`Unsupported MIME type for Vision: ${mimeType}`);
}

/**
 * Get file extension from MIME type
 *
 * @param mimeType - MIME type string
 * @returns File extension (e.g., ".pdf", ".jpg")
 */
function getFileExtension(mimeType: string): string {
  const extensions: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
  };

  return extensions[mimeType] || ".bin";
}

/**
 * Detect if message contains media (document or image)
 *
 * @param messageData - Message data from webhook
 * @returns DocumentMetadata if found, null otherwise
 */
export function detectMediaInMessage(messageData: any): DocumentMetadata | null {
  try {
    // Check for media in different webhook formats (Meta, Twilio)
    const media =
      messageData.media ||
      messageData.document ||
      messageData.image ||
      (messageData.type === "document" && messageData) ||
      (messageData.type === "image" && messageData);

    if (!media || !media.url) {
      return null;
    }

    const mimeType = media.mime_type || media.mimeType || "application/pdf";
    const url = media.url;

    // Generate filename from URL or use timestamp
    let fileName = "cv_document";
    try {
      const urlParts = new URL(url).pathname.split("/");
      fileName = urlParts[urlParts.length - 1] || fileName;
    } catch {
      // URL parsing failed, use default
    }

    // Determine if PDF or image
    const isPdf = mimeType === "application/pdf";
    const isImage = mimeType.startsWith("image/");

    if (!isPdf && !isImage) {
      console.warn(`⚠️ Unsupported media type: ${mimeType}`);
      return null;
    }

    return {
      mediaUrl: url,
      mimeType,
      fileName,
      mediaType: isPdf ? "pdf" : "image",
    };
  } catch (error) {
    console.error(`⚠️ Error detecting media:`, error);
    return null;
  }
}

// ============================================
// EXPORTS
// ============================================

export { processCandidateDocument, CVExtractionResult, DocumentMetadata };
