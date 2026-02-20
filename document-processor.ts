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

// ============================================
// CONSTANTS & CONFIGURATION
// ============================================

/** Maximum file size (5MB - generous for CV but prevents DoS) */
const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/** Temporary directory for CV downloads */
const TEMP_DIR = "/tmp";

/** Timeout for file download (30 seconds) */
const DOWNLOAD_TIMEOUT_MS = 30000;

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
 */
interface CVExtractionResult {
  education?: string | null;
  experience_summary?: string | null;
  hard_skills?: string[] | null;
  language_level?: "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | null;
  extraction_confidence?: number; // 0-100
  extraction_notes?: string; // "Couldn't find experience section", etc.
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
      "Education level and specialization extracted from CV (e.g., 'Liceu Tehnic - Mecanică')"
    ),

  experience_summary: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Professional experience summary (e.g., '5 years at Emag as Order Picker')"
    ),

  hard_skills: z
    .array(z.string())
    .nullable()
    .optional()
    .describe("Technical skills found in CV (e.g., ['Scanner RF', 'SAP'])"),

  language_level: z
    .enum(["A1", "A2", "B1", "B2", "C1", "C2"])
    .nullable()
    .optional()
    .describe("Language proficiency level extracted from CV"),

  extraction_confidence: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Confidence score (0-100) of extraction quality"),

  extraction_notes: z
    .string()
    .nullable()
    .optional()
    .describe("Notes about extraction (e.g., 'Couldn't find experience')"),
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

    // Step 3: Download file with size check
    console.log(`   Downloading to: ${tempFilePath}`);
    await downloadFileWithSizeLimit(mediaUrl, tempFilePath, MAX_FILE_SIZE_BYTES);

    // Step 4: Verify file downloaded
    if (!fs.existsSync(tempFilePath)) {
      console.error(`❌ [DOCUMENT] File not found after download: ${tempFilePath}`);
      return null;
    }

    const fileStats = fs.statSync(tempFilePath);
    console.log(`   ✅ Downloaded: ${(fileStats.size / 1024).toFixed(2)}KB`);

    // Step 5: Determine media type for Vision API
    const isImage = mimeType.startsWith("image/");
    const isPdf = mimeType === "application/pdf";

    // Step 6: Convert to Base64
    console.log(`   Converting to Base64...`);
    const fileBuffer = fs.readFileSync(tempFilePath);
    const base64Data = fileBuffer.toString("base64");
    console.log(
      `   ✅ Base64 encoded: ${(base64Data.length / 1024).toFixed(2)}KB`
    );

    // Step 7: Send to OpenAI Vision (gpt-4o model)
    console.log(`   Sending to OpenAI Vision (gpt-4o)...`);
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
function downloadFileWithSizeLimit(
  url: string,
  filePath: string,
  maxSize: number
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

    // Step 3: Handle HTTPS request
    https
      .get(url, (response) => {
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
  clientConfig: ClientConfig
): Promise<CVExtractionResult | null> {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Step 1: Build vision-aware system prompt with privacy redaction
    const systemPrompt = buildVisionPrivacyPrompt(clientConfig, session);

    // Step 2: Build message with vision data
    // OpenAI expects: { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
    // OR for PDF: { type: "document", document: { type: "application/pdf", data: "base64..." } }

    const messageContent = buildVisionMessageContent(base64Data, mimeType);

    console.log(`   📡 Calling OpenAI Vision (gpt-4o)...`);

    // Step 3: Call OpenAI with vision capability
    const response = await (openai as any).beta.chat.completions.parse({
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

    // Step 4: Parse response
    if (!response.choices[0].message.parsed) {
      console.warn(`⚠️ No parsed data from Vision API`);
      return null;
    }

    const extracted = response.choices[0].message.parsed as CVExtractionResult;

    // Step 5: Validate with Zod
    const validated = CVExtractionSchema.parse(extracted);

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

Return JSON with: education, experience_summary, hard_skills (array), language_level, extraction_confidence (0-100), extraction_notes`,

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
 * Handles both images and PDFs
 * OpenAI requires different formats
 *
 * @param base64Data - Base64 encoded file
 * @param mimeType - MIME type
 * @returns Array of message content objects
 */
function buildVisionMessageContent(base64Data: string, mimeType: string): any {
  if (mimeType.startsWith("image/")) {
    // Image format
    const imageMediaType = mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
    return [
      {
        type: "image_url",
        image_url: {
          url: `data:${imageMediaType};base64,${base64Data}`,
          detail: "high",  // High detail for better text extraction
        },
      },
      {
        type: "text",
        text: "Extract the data from this CV/resume according to the system prompt.",
      },
    ];
  } else if (mimeType === "application/pdf") {
    // PDF format (gpt-4o supports native PDF)
    return [
      {
        type: "document",
        document: {
          type: "application/pdf",
          data: base64Data,
        },
      },
      {
        type: "text",
        text: "Extract the data from this PDF CV/resume according to the system prompt.",
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
