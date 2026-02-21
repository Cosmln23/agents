/**
 * UserSession Type Definition - SEGMENT 2
 * Extended with skill-based matching & GDPR/EU AI Act compliance
 *
 * @version 2.0
 * @author Recrutare AI Bot
 * @description
 *   Defines the complete user session structure for multi-tenant recruitment bot.
 *   Includes profile data collection, skill matching, and legal compliance tracking.
 */

/**
 * Onboarding state progression for user conversation flow
 * @typedef {string} OnboardingStage
 *
 * Flow: new → pending_consent → collecting_data → offered_job → completed
 */
export type OnboardingStage =
  | "new"                       // User just started conversation
  | "pending_consent"           // Waiting for GDPR consent (DA/NU)
  | "collecting_data"           // Collecting education, experience, skills via CV or text
  | "waiting_qualification"     // CV read → asking start date + accommodation needs
  | "waiting_candidate_note"    // NEW: Asking if candidate wants to add a personal note for HR
  | "waiting_dispatch_consent"  // Showing job matches → asking GDPR consent to send profile to office
  | "offered_job"               // Legacy: job match found (kept for compatibility)
  | "dispatched"                // Profile sent to office, awaiting recruiter callback
  | "completed";                // User accepted job or opted out

/**
 * Language proficiency levels following EU standards (CEFR)
 * @typedef {string} LanguageLevel
 */
export type LanguageLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

/**
 * Professional experience entry
 * @interface Experience
 */
export interface Experience {
  company?: string | null;    // Company/employer name
  duration?: string | null;   // Duration (e.g., "3 years", "2 ani")
  role?: string | null;       // Job title/role
}

/**
 * Language proficiency entry
 * @interface Language
 */
export interface Language {
  language: string;           // Language name (e.g., "English", "Dutch")
  level?: LanguageLevel | null; // CEFR level
}

/**
 * Main User Session Interface
 * Stores all candidate profile data + compliance metadata
 *
 * @interface UserSession
 */
export interface UserSession {
  // ============================================
  // IDENTIFICATION
  // ============================================

  /**
   * WhatsApp phone number (with + prefix)
   * Format: "+1234567890"
   */
  phone: string;

  /**
   * Client/Agency ID (from ClientConfig)
   * Used to identify which agency this candidate is communicating with
   * Example: "logistics_nl_001"
   */
  clientId?: string;

  // ============================================
  // PERSONAL INFORMATION
  // ============================================

  /**
   * Candidate's full name
   * Extracted from first message via AI
   */
  nume?: string;

  /**
   * Years since profile was created (helps with age gating)
   */
  profileCreatedAt?: number; // timestamp

  // ============================================
  // SKILL-BASED MATCHING FIELDS (NEW - Segment 2)
  // ============================================

  /**
   * Education level and specialization
   * Examples:
   *   - "Liceu Tehnic - Mecanică"
   *   - "Universitate - Logistică"
   *   - "Professionele School - Warehousing"
   *
   * Extracted: Stage "education"
   */
  education?: string;

  /**
   * Professional experience summary
   * Examples:
   *   - "5 years warehouse, 2 years driver"
   *   - "3 ani depozit, 1 an curier"
   *
   * Derived from experience array
   */
  experience_summary?: string;

  /**
   * Legacy: Individual experience entries (each job)
   * Migration path for future database storage
   *
   * Example:
   *   [{company: "Emag", duration: "3 ani", role: "Order Picker"}]
   */
  experience?: Array<Experience>;

  /**
   * Hard technical skills array
   * Examples: ["Scanner RF", "EPT", "SAP", "Forklift", "Pallet Jack"]
   *
   * Extracted: Stage "skills"
   */
  hard_skills?: string[];

  /**
   * Legacy: Individual hard skills (for backward compatibility)
   * Superseded by hard_skills array
   */
  hardSkills?: string[];

  /**
   * Language proficiency entries
   * Example: [{language: "English", level: "B1"}, {language: "Dutch", level: "A2"}]
   *
   * Extracted: Stage "language"
   */
  languages?: Array<Language>;

  /**
   * EU CEFR language level for primary language
   * Used in quick skill matching
   * Values: "A1" | "A2" | "B1" | "B2" | "C1" | "C2"
   *
   * Example: "B1"
   */
  language_level?: LanguageLevel;

  /**
   * Legacy: Array of language names (for backward compatibility)
   * Example: ["English", "Dutch", "Romanian"]
   */
  limbi?: string[];

  /**
   * Desired job title or position
   * What the candidate is looking for
   * Examples: "Order Picker", "Driver", "Healthcare Assistant"
   *
   * Extracted: During conversation or matching
   */
  job_title_desired?: string;

  /**
   * Education level & specialization (legacy)
   * Kept for backward compatibility
   */
  school?: string;
  schoolProfile?: string;

  /**
   * Certifications/Licenses
   * Legacy fields: VCA, BSN, Driver's License
   * Will be migrated to skills array in future versions
   */
  hasVCA?: boolean;
  hasBSN?: boolean;
  permis?: boolean;

  /**
   * AI internal notes about candidate
   * Example: "Responds promptly, tech-savvy, motivated"
   *
   * Populated: Throughout conversation stages
   */
  ai_notes?: string;

  // ============================================
  // QUALIFICATION DATA (Stage: waiting_qualification)
  // Collected after CV read, before dispatch
  // ============================================

  /**
   * When the candidate can start working
   * Examples: "Imediat", "Preaviz 2 săptămâni", "01.04.2026"
   * Collected: Stage "waiting_qualification"
   */
  availability?: string;

  /**
   * Whether candidate needs accommodation from agency
   * Examples: "Da, am nevoie de cazare", "Nu, am locuință proprie"
   * Collected: Stage "waiting_qualification"
   */
  accommodation_needed?: string;

  /**
   * Domain/area of activity extracted from CV
   * Examples: "Transport și Logistică", "IT", "Sănătate"
   * Extracted: From CV via Vision API
   */
  domeniu_activitate?: string;

  /**
   * Most recent job role extracted from CV
   * Examples: "Transport Coordinator la Pliti Dispo SRL"
   * Extracted: From CV via Vision API
   */
  experienta_recenta?: string;

  /**
   * Countries/cities where candidate worked
   * Examples: "România, Olanda, Germania"
   * Extracted: From CV via Vision API
   */
  mobilitate?: string;

  /**
   * Personal note from the candidate to the recruiter
   * Examples: "Prefer ture de noapte", "Am mașină proprie"
   * Collected: Stage "waiting_candidate_note"
   */
  candidate_note?: string;

  /**
   * General sentiment/mood of the candidate during qualification
   * Extracted via LLM Contextual Analysis
   */
  user_sentiment?: string;

  // ============================================
  // DISPATCH DATA (Stage: dispatched)
  // GDPR compliance audit trail
  // ============================================

  /**
   * Timestamp when user gave explicit consent to send profile to office
   * GDPR Article 7 - Explicit consent required before data transfer
   * Format: Unix timestamp (milliseconds)
   */
  dispatch_consent_timestamp?: number;

  /**
   * Timestamp when profile was dispatched to office
   * Used for GDPR audit trail
   */
  dispatch_timestamp?: number;

  /**
   * Job IDs that were matched and presented to candidate
   * Stored for audit trail
   */
  matched_job_ids?: string[];

  // ============================================
  // COMPLIANCE & PRIVACY (NEW - Segment 2)
  // EU AI Act & GDPR Requirements
  // ============================================

  /**
   * GDPR Consent: User agreed to data processing
   *
   * Set to true when user responds affirmatively to:
   * "Do you consent to your data being processed for job matching?"
   *
   * Default: false
   * Legal: Required under GDPR Article 7
   */
  consent_given?: boolean;

  /**
   * EU AI Act Compliance: User acknowledged bot is AI-powered
   *
   * Set to true when user sees transparency message:
   * "You are talking to an AI assistant of {AgencyName}"
   * and responds affirmatively.
   *
   * Default: false
   * Legal: Required under EU AI Act Article 54 (transparency)
   */
  ai_disclosure_acknowledged?: boolean;

  /**
   * GDPR Data Retention: Auto-deletion date
   *
   * Format: ISO 8601 date string (e.g., "2026-03-20")
   * Calculated: Today's date + clientConfig.dataRetentionDays
   *
   * Example:
   *   - Created: 2026-02-20
   *   - dataRetentionDays: 30
   *   - Result: "2026-03-20"
   *
   * Legal: GDPR Article 5(1)(e) - "storage limitation principle"
   * System should auto-delete profile after this date
   */
  data_retention_date?: string;

  // ============================================
  // STATE MANAGEMENT
  // ============================================

  /**
   * Current stage in onboarding flow
   * Drives which questions bot asks next
   *
   * Flow progression:
   *   new → pending_consent → collecting_data → offered_job → completed
   */
  stage: OnboardingStage;

  /**
   * Timestamp of last message from user
   * Used for session timeout detection
   * Unix timestamp (milliseconds)
   */
  lastUpdate?: number;

  /**
   * Last message text from user
   * Kept for debugging and conversation context
   */
  lastMessage?: string;
}
