/**
 * Zod Schemas - SEGMENT 2
 * Validation schemas for user sessions and compliance data
 *
 * @version 2.0
 * @description
 *   Enterprise-grade validation schemas using Zod.
 *   Ensures data quality, type safety, and GDPR compliance.
 *
 * @note
 *   All profile fields (.education, .hard_skills, .language_level, etc.)
 *   are optional/nullable initially. They're populated progressively
 *   during the onboarding conversation flow.
 */

import { z } from "zod";
import { UserSession, OnboardingStage, LanguageLevel, Experience, Language } from "../types/UserSession";

// ============================================
// PRIMITIVE SCHEMAS
// ============================================

/**
 * Enum for onboarding stages
 * Controls which phase of conversation the bot is in
 */
const OnboardingStaggeSchema = z.enum([
  "new",
  "pending_consent",
  "collecting_data",
  "offered_job",
  "completed",
]);

/**
 * Enum for language proficiency levels (CEFR)
 * Following European Common Framework Reference levels
 */
const LanguageLevelSchema = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);

// ============================================
// NESTED SCHEMAS
// ============================================

/**
 * Schema for a single professional experience entry
 *
 * @example
 * {
 *   company: "Emag",
 *   duration: "3 ani",
 *   role: "Order Picker"
 * }
 */
const ExperienceSchema = z.object({
  company: z.string().nullable().optional().describe("Company/employer name"),
  duration: z.string().nullable().optional().describe("Duration (e.g., '3 years')"),
  role: z.string().nullable().optional().describe("Job title/position"),
});

/**
 * Schema for language proficiency entry
 *
 * @example
 * {
 *   language: "English",
 *   level: "B1"
 * }
 */
const LanguageSchema = z.object({
  language: z.string().describe("Language name"),
  level: z
    .enum(["A1", "A2", "B1", "B2", "C1", "C2"])
    .nullable()
    .optional()
    .describe("CEFR proficiency level"),
});

// ============================================
// MAIN USER SESSION SCHEMA (SEGMENT 2)
// ============================================

/**
 * UserSessionSchema - Main validation schema for candidate profiles
 *
 * Features:
 *   - Flexible: All profile fields are .optional() (progressive collection)
 *   - Type-safe: Full TypeScript inference
 *   - Nullable: Accepts null values for missing data (graceful degradation)
 *   - Compliance: Includes GDPR & EU AI Act tracking
 *   - Passthrough: Allows extra fields for future extensibility
 *
 * @note
 *   Stage "new" has minimal required fields:
 *   - phone (always required)
 *   - stage: "new"
 *
 *   Stage "collecting_data" progressively fills:
 *   - education
 *   - experience/experience_summary
 *   - hard_skills
 *   - language_level
 *   - job_title_desired
 *
 *   Stage "offered_job" requires:
 *   - consent_given: true
 *   - ai_disclosure_acknowledged: true
 */
export const UserSessionSchema = z
  .object({
    // ============================================
    // IDENTIFICATION
    // ============================================

    phone: z.string().min(7).describe("WhatsApp phone number (with + prefix)"),

    clientId: z
      .string()
      .optional()
      .describe("Client/Agency ID (from ClientConfig)"),

    // ============================================
    // PERSONAL INFO
    // ============================================

    nume: z.string().nullable().optional().describe("Candidate full name"),

    profileCreatedAt: z.number().int().optional().describe("Timestamp when profile was created"),

    // ============================================
    // SKILL-BASED MATCHING (SEGMENT 2)
    // ============================================

    education: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Education level and specialization (e.g., 'Liceu Tehnic - Mecanică')"
      ),

    experience_summary: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Professional experience summary (e.g., '5 years warehouse, 2 years driver')"
      ),

    experience: z
      .array(ExperienceSchema)
      .optional()
      .describe("Array of individual work experiences"),

    hard_skills: z
      .array(z.string())
      .optional()
      .describe(
        "Technical skills array (e.g., ['Scanner RF', 'SAP', 'Forklift'])"
      ),

    hardSkills: z
      .array(z.string())
      .optional()
      .describe("LEGACY: Hard skills (use hard_skills instead)"),

    languages: z
      .array(LanguageSchema)
      .optional()
      .describe("Language proficiency entries with CEFR levels"),

    language_level: z
      .enum(["A1", "A2", "B1", "B2", "C1", "C2"])
      .nullable()
      .optional()
      .describe("Primary language proficiency level (CEFR)"),

    limbi: z
      .array(z.string())
      .optional()
      .describe("LEGACY: Language names (use languages instead)"),

    job_title_desired: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Job title/position candidate is looking for (e.g., 'Order Picker')"
      ),

    // ============================================
    // LEGACY FIELDS (Backward compatibility)
    // ============================================

    school: z
      .string()
      .nullable()
      .optional()
      .describe("LEGACY: Education level"),

    schoolProfile: z
      .string()
      .nullable()
      .optional()
      .describe("LEGACY: Education specialization"),

    hasVCA: z
      .boolean()
      .nullable()
      .optional()
      .describe("LEGACY: Has VCA certification"),

    hasBSN: z
      .boolean()
      .nullable()
      .optional()
      .describe("LEGACY: Has BSN certification"),

    permis: z
      .boolean()
      .nullable()
      .optional()
      .describe("LEGACY: Has driver's license"),

    ai_notes: z
      .string()
      .nullable()
      .optional()
      .describe(
        "AI internal notes about candidate (e.g., 'Motivated, tech-savvy')"
      ),

    // ============================================
    // COMPLIANCE & PRIVACY (SEGMENT 2)
    // GDPR & EU AI Act
    // ============================================

    consent_given: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "GDPR: User consented to data processing (Article 7). Set to true after user responds 'DA' to consent prompt."
      ),

    ai_disclosure_acknowledged: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "EU AI Act: User acknowledged bot is AI-powered (Article 54). Set to true after transparency message."
      ),

    data_retention_date: z
      .string()
      .nullable()
      .optional()
      .describe(
        "GDPR: Auto-deletion date (ISO 8601, e.g., '2026-03-20'). Calculated: today + clientConfig.dataRetentionDays. Storage limitation principle (Article 5)."
      ),

    // ============================================
    // STATE MANAGEMENT
    // ============================================

    stage: OnboardingStaggeSchema.default("new").describe(
      "Onboarding stage: new → pending_consent → collecting_data → offered_job → completed"
    ),

    lastUpdate: z.number().int().optional().describe("Unix timestamp of last message"),

    lastMessage: z.string().nullable().optional().describe("Last message text from user"),
  })
  .passthrough(); // Allow extra fields for future extensibility

// ============================================
// COMPLIANCE METADATA SCHEMA
// ============================================

/**
 * Separate schema for compliance tracking
 * Can be used independently for audit logs
 *
 * @example
 * {
 *   phone: "+1234567890",
 *   consent_given: true,
 *   ai_disclosure_acknowledged: true,
 *   data_retention_date: "2026-03-20",
 *   timestamp: 1708422000000
 * }
 */
export const ComplianceMetadataSchema = z.object({
  phone: z.string().describe("User's WhatsApp number"),

  clientId: z.string().optional().describe("Client/Agency ID"),

  consent_given: z
    .boolean()
    .describe("GDPR: User consented to data processing"),

  ai_disclosure_acknowledged: z
    .boolean()
    .describe("EU AI Act: User acknowledged AI assistance"),

  data_retention_date: z.string().describe("Data deletion date (ISO 8601)"),

  timestamp: z
    .number()
    .int()
    .describe("When this compliance record was created"),

  ip_address: z.string().optional().describe("Optional: User's IP (if available)"),

  user_agent: z
    .string()
    .optional()
    .describe("Optional: WhatsApp client info"),
});

// ============================================
// TYPE EXPORTS
// ============================================

/**
 * Inferred TypeScript type from UserSessionSchema
 * Use this for full type safety
 */
export type ValidatedUserSession = z.infer<typeof UserSessionSchema>;

/**
 * Inferred TypeScript type from ComplianceMetadataSchema
 */
export type ComplianceMetadata = z.infer<typeof ComplianceMetadataSchema>;

// ============================================
// UTILITY FUNCTIONS FOR COMMON OPERATIONS
// ============================================

/**
 * Safe parse user session with error handling
 * Returns null if validation fails (graceful degradation)
 *
 * @param data - Raw user session data
 * @returns Validated session or null
 *
 * @example
 * const session = safeParse(rawData);
 * if (session) {
 *   console.log("Valid session:", session.phone);
 * } else {
 *   console.warn("Invalid session data");
 * }
 */
export function safeParse(data: unknown): ValidatedUserSession | null {
  try {
    return UserSessionSchema.parse(data);
  } catch (error) {
    console.warn("⚠️ Session validation failed:", error);
    return null;
  }
}

/**
 * Partial parse - validate only provided fields
 * Used during progressive data collection
 *
 * @param data - Partial user session data
 * @returns Validated partial session or null
 *
 * @example
 * const updated = safeParsePartial({ education: "Liceu Tehnic" });
 */
export function safeParsePartial(data: unknown): Partial<ValidatedUserSession> | null {
  try {
    return UserSessionSchema.partial().parse(data);
  } catch (error) {
    console.warn("⚠️ Partial validation failed:", error);
    return null;
  }
}

/**
 * Validate compliance metadata specifically
 * Use for audit logging
 *
 * @param data - Compliance metadata to validate
 * @returns Validated metadata or null
 */
export function validateCompliance(data: unknown): ComplianceMetadata | null {
  try {
    return ComplianceMetadataSchema.parse(data);
  } catch (error) {
    console.warn("❌ Compliance validation failed:", error);
    return null;
  }
}

/**
 * Check if session has given required consent
 * Gate function for proceeding with data processing
 *
 * @param session - User session to check
 * @returns true if both consent and AI disclosure are acknowledged
 *
 * @example
 * if (isConsented(session)) {
 *   // Safe to process and store data
 * } else {
 *   // Ask for consent first
 * }
 */
export function isConsented(session: ValidatedUserSession): boolean {
  return session.consent_given === true && session.ai_disclosure_acknowledged === true;
}

/**
 * Extract only compliance-relevant fields from session
 * For GDPR audit trails
 *
 * @param session - Full user session
 * @returns Compliance metadata subset
 *
 * @example
 * const compliance = extractComplianceData(session);
 * await saveToAuditLog(compliance);
 */
export function extractComplianceData(
  session: ValidatedUserSession
): Partial<ComplianceMetadata> {
  return {
    phone: session.phone,
    clientId: session.clientId,
    consent_given: session.consent_given,
    ai_disclosure_acknowledged: session.ai_disclosure_acknowledged,
    data_retention_date: session.data_retention_date,
    timestamp: session.lastUpdate || Date.now(),
  };
}
