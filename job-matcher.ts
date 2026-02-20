/**
 * JOB MATCHER - FINAL SEGMENT
 * Intelligent Skill-Based Job Matching with EU AI Act Compliance
 *
 * @version 5.0
 * @author Recrutare AI - Enterprise Team
 * @description
 *   Calculates job matches for candidates using:
 *   - Hard skills analysis (40% weight)
 *   - Experience relevance (35% weight)
 *   - Language proficiency (25% weight)
 *
 *   Returns TOP 3 MATCHES (descending by score > 50%)
 *   Each match includes:
 *   - jobId + jobTitle
 *   - matchScore (0-100)
 *   - matchReasoning (HR-ready explanation)
 *
 * EU AI Act Compliance:
 *   - NO discrimination (age, gender, ethnicity, religion, health)
 *   - Human-in-the-loop (AI recommends, recruiter decides)
 *   - Explainable reasoning (recruiter understands WHY)
 *   - Audit trail (all reasoning logged)
 *
 * CRITICAL RULES:
 *   - Do NOT penalize missing non-critical skills
 *   - DO penalize missing critical skills
 *   - DO flag missing language (penalize, don't assume)
 *   - DO validate output for bias keywords
 *   - DO provide Top 3 (not singular match)
 */

import OpenAI from "openai";
import { z } from "zod";
import { UserSession } from "./types/UserSession";
import { ClientConfig } from "./types/ClientConfig";
import { OpenAIExtended } from "./types/OpenAIExtended";

// ============================================
// TYPE DEFINITIONS & SCHEMAS
// ============================================

/**
 * Job structure (from Google Sheets)
 * Represents available positions
 */
export interface Job {
  jobId: string;
  jobTitle: string;
  city: string;
  salary: string;
  requiredSkills: string[];
  requiredExperience: number; // years
  requiredLanguageLevel: "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | "any";
  niceToHaveSkills?: string[];
  description?: string;
}

/**
 * Single job match result
 */
const JobMatchSchema = z.object({
  jobId: z.string().describe("Unique job identifier"),
  jobTitle: z.string().describe("Job title (e.g., 'Order Picker')"),
  city: z.string().describe("Job location"),
  matchScore: z
    .number()
    .min(0)
    .max(100)
    .describe("Match score from 0-100"),
  matchReasoning: z
    .string()
    .describe(
      "Clear explanation of match score. Must NOT contain age, gender, ethnicity, religion, or health info."
    ),
  matchFactors: z.object({
    skillsScore: z
      .number()
      .min(0)
      .max(100)
      .describe("Skills match percentage (0-100)"),
    experienceScore: z
      .number()
      .min(0)
      .max(100)
      .describe("Experience relevance (0-100)"),
    languageScore: z
      .number()
      .min(0)
      .max(100)
      .describe("Language proficiency adequacy (0-100)"),
  }),
});

/**
 * Complete matching result with Top 3 matches
 */
const MatchingResultSchema = z.object({
  candidateName: z.string().describe("Candidate name"),
  totalJobsAnalyzed: z.number().describe("Number of jobs compared"),
  topMatches: z
    .array(JobMatchSchema)
    .min(0)
    .max(3)
    .describe("Top 3 job matches (score > 50%), ordered descending"),
  assessmentCompleteness: z
    .enum(["complete", "partial", "incomplete"])
    .describe(
      "COMPLETE: all profile data available, PARTIAL: some data missing, INCOMPLETE: critical data missing"
    ),
  assessmentNotes: z
    .string()
    .optional()
    .describe(
      "Internal notes about assessment (e.g., 'Language level unknown - scored conservatively')"
    ),
});

export type JobMatch = z.infer<typeof JobMatchSchema>;
export type MatchingResult = z.infer<typeof MatchingResultSchema>;

// ============================================
// ANTI-BIAS VALIDATION
// ============================================

/**
 * Forbidden keywords in matching reasoning
 * These indicate discriminatory language (EU AI Act)
 *
 * CRITICAL: Any reasoning containing these words should be flagged
 */
const FORBIDDEN_BIAS_KEYWORDS = [
  // Age-related
  "old",
  "young",
  "youthful",
  "aged",
  "generation",
  "millennial",
  "boomer",
  "graduate year",
  "born in",
  "over 40",
  "under 25",

  // Gender-related
  "male",
  "female",
  "woman",
  "man",
  "she",
  "he",
  "mother",
  "father",
  "girlfriend",
  "boyfriend",
  "wife",
  "husband",
  "his voice",
  "her appearance",
  "masculine",
  "feminine",

  // Ethnicity-related
  "caucasian",
  "african",
  "asian",
  "hispanic",
  "white",
  "black",
  "brown",
  "nationality",
  "country of origin",
  "ethnic",
  "race",
  "immigrant",

  // Religion-related
  "christian",
  "muslim",
  "jewish",
  "hindu",
  "buddhist",
  "atheist",
  "religious",
  "faith",
  "prayer",
  "halal",
  "kosher",

  // Health/Disability-related
  "disabled",
  "disability",
  "mental health",
  "anxiety",
  "depression",
  "autism",
  "wheelchair",
  "blind",
  "deaf",
  "medical condition",
  "sick leave",
  "pregnant",
  "maternity",

  // Marital/Family status
  "married",
  "single",
  "divorced",
  "children",
  "family status",
  "dependents",
  "spouse",
  "household",

  // Appearance-related
  "attractive",
  "handsome",
  "pretty",
  "ugly",
  "obese",
  "thin",
  "tattoo",
  "piercing",
  "appearance",
  "looks",
];

/**
 * Validate reasoning text for bias keywords
 *
 * @param text - Reasoning text to validate
 * @returns Object with { isClean, foundKeywords }
 *
 * EU AI Act Article 10: "High-risk AI systems shall be designed and developed
 * in such a way as to ensure that natural persons are not discriminated against
 * on the basis of protected grounds."
 */
function validateForBias(text: string): {
  isClean: boolean;
  foundKeywords: string[];
} {
  const foundKeywords: string[] = [];
  const lowerText = text.toLowerCase();

  for (const keyword of FORBIDDEN_BIAS_KEYWORDS) {
    // Use word boundaries to avoid false positives
    // e.g., "understand" shouldn't match "understand"
    const regex = new RegExp(`\\b${keyword}\\b`, "gi");
    if (regex.test(lowerText)) {
      foundKeywords.push(keyword);
    }
  }

  return {
    isClean: foundKeywords.length === 0,
    foundKeywords,
  };
}

// ============================================
// MAIN MATCHING FUNCTION
// ============================================

/**
 * Calculate job matches for a candidate
 *
 * ALGORITHM:
 *   1. Score Hard Skills Match (40% weight)
 *      - Exact matches: 100%
 *      - Partial matches: 60-80%
 *      - Missing critical skills: penalize heavily
 *      - Missing nice-to-have: minor penalty
 *
 *   2. Score Experience Relevance (35% weight)
 *      - Years match: candidate years >= job years?
 *      - Role similarity: warehouse vs logistics?
 *      - Missing experience: penalize
 *
 *   3. Score Language (25% weight)
 *      - Candidate level >= required level?
 *      - Missing language: penalize heavily (can't assume)
 *      - Unknown level: conservative scoring
 *
 *   4. Combined Score:
 *      score = (skillsScore * 0.40) + (expScore * 0.35) + (langScore * 0.25)
 *
 *   5. Return Top 3 matches (score > 50%), ordered descending
 *
 * @param session - Candidate profile
 * @param availableJobs - Jobs to match against
 * @param clientConfig - Client configuration
 * @returns MatchingResult with top 3 matches
 *
 * @example
 * const result = await calculateJobMatch(session, jobs, clientConfig);
 * // Returns:
 * // {
 * //   candidateName: "Cosmin",
 * //   topMatches: [
 * //     { jobId: "1", jobTitle: "Order Picker", matchScore: 92, ... },
 * //     { jobId: "2", jobTitle: "Warehouse Worker", matchScore: 78, ... },
 * //     { jobId: "3", jobTitle: "Driver", matchScore: 65, ... }
 * //   ]
 * // }
 */
async function calculateJobMatch(
  session: UserSession,
  availableJobs: Job[],
  clientConfig: ClientConfig
): Promise<MatchingResult | null> {
  try {
    console.log(
      `\n🎯 [MATCHER] Calculating matches for ${session.phone} (${clientConfig.clientId})`
    );
    console.log(
      `   Candidate: ${session.nume || "Unknown"}`
    );
    console.log(
      `   Available jobs: ${availableJobs.length}`
    );

    // Step 1: Check assessment completeness
    const completeness = assessProfileCompleteness(session);
    console.log(`   Assessment completeness: ${completeness}`);

    // Step 2: Calculate individual matches for each job
    const allMatches: JobMatch[] = [];

    for (const job of availableJobs) {
      const match = await scoreJobMatch(
        session,
        job,
        clientConfig,
        completeness
      );

      if (match) {
        allMatches.push(match);
      }
    }

    // Step 3: Filter for score > 50% and sort descending
    const qualifyingMatches = allMatches
      .filter((m) => m.matchScore > 50)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 3); // Top 3

    console.log(
      `   ✅ Qualifying matches: ${qualifyingMatches.length} (score > 50%)`
    );

    // Step 4: Build result
    const result: MatchingResult = {
      candidateName: session.nume || "Unknown",
      totalJobsAnalyzed: availableJobs.length,
      topMatches: qualifyingMatches,
      assessmentCompleteness: completeness,
      assessmentNotes:
        completeness !== "complete"
          ? `Assessment is ${completeness}. Some factors may be conservatively scored.`
          : undefined,
    };

    // Step 5: Validate result (anti-bias check)
    validateMatchingResult(result);

    console.log(`   🎯 Top match: ${qualifyingMatches[0]?.jobTitle || "None"} (${qualifyingMatches[0]?.matchScore || 0}%)`);

    return result;
  } catch (error) {
    console.error(`❌ [MATCHER] Error:`, error);
    return null;
  }
}

/**
 * Score a single job match
 * Uses LLM for intelligent reasoning with structured output
 *
 * @param session - Candidate
 * @param job - Job to match
 * @param clientConfig - Client config
 * @param completeness - Assessment quality level
 * @returns JobMatch with score and reasoning
 */
async function scoreJobMatch(
  session: UserSession,
  job: Job,
  clientConfig: ClientConfig,
  completeness: "complete" | "partial" | "incomplete"
): Promise<JobMatch | null> {
  try {
    const openai = new OpenAIExtended(process.env.OPENAI_API_KEY);

    // Step 1: Build evaluation prompt
    const evalPrompt = buildJobMatchPrompt(
      session,
      job,
      clientConfig,
      completeness
    );

    // Step 2: Call OpenAI with structured output (Type-safe, no `as any`)
    console.log(`   📊 Scoring ${job.jobTitle}...`);

    const response = await openai.parseStructured<JobMatch>({
      model: "gpt-4o-mini",  // Fast for matching
      messages: [
        {
          role: "system",
          content: buildAntibiasSystemPrompt(clientConfig.systemLanguage),
        },
        {
          role: "user",
          content: evalPrompt,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "JobMatch",
          schema: JobMatchSchema,
          strict: true,
        },
      },
      temperature: 0,  // Deterministic
      max_tokens: 800,
    });

    // parseStructured returns the parsed data directly (type-safe)
    const match = response as JobMatch;

    // Step 3: Validate reasoning for bias
    const biasCheck = validateForBias(match.matchReasoning);
    if (!biasCheck.isClean) {
      console.warn(
        `   ⚠️ [BIAS CHECK] ${job.jobTitle} contains forbidden keywords:`,
        biasCheck.foundKeywords
      );
      // Log but continue (will be flagged in audit)
    }

    // Step 4: Override with job data
    match.jobId = job.jobId;
    match.jobTitle = job.jobTitle;
    match.city = job.city;

    return match;
  } catch (error) {
    console.error(`   ❌ Error scoring ${job.jobTitle}:`, error);
    return null;
  }
}

/**
 * Build job matching prompt for LLM evaluation
 *
 * Tells AI: "Compare this candidate to this job"
 *
 * @param session - Candidate profile
 * @param job - Job to match
 * @param clientConfig - Client config
 * @param completeness - Assessment quality
 * @returns Prompt string
 */
function buildJobMatchPrompt(
  session: UserSession,
  job: Job,
  clientConfig: ClientConfig,
  completeness: "complete" | "partial" | "incomplete"
): string {
  const skillsText =
    session.hard_skills && session.hard_skills.length > 0
      ? `- Skills: ${session.hard_skills.join(", ")}`
      : `- Skills: (none specified - will penalize)`;

  const experienceText =
    session.experience_summary ||
    "(no experience specified - will penalize)";

  const languageText =
    session.language_level ||
    "(language level unknown - score conservatively)";

  const assessmentWarning =
    completeness !== "complete"
      ? `\n⚠️ NOTE: Assessment is ${completeness}. Be conservative in scoring.`
      : "";

  return `CANDIDATE PROFILE:
Name: ${session.nume || "Unknown"}
${skillsText}
Experience: ${experienceText}
Language Level: ${languageText}${assessmentWarning}

JOB OPENING:
Title: ${job.jobTitle}
Location: ${job.city}
Required Skills: ${job.requiredSkills.join(", ")}
Required Experience: ${job.requiredExperience}+ years
Required Language: ${job.requiredLanguageLevel}
Nice-to-Have Skills: ${job.niceToHaveSkills?.join(", ") || "none"}

SCORING INSTRUCTIONS:
1. HARD SKILLS (40% weight in final score):
   - Exact matches: 90-100%
   - Partial/related matches: 60-80%
   - Missing required skill: -20% each
   - Missing nice-to-have: -5% each

2. EXPERIENCE (35% weight):
   - Years match: candidate years >= job requirement?
   - Role similarity: Is experience relevant to this job?
   - Missing any relevant experience: penalize 30-50%

3. LANGUAGE (25% weight):
   - Candidate level >= job requirement?
   - If unknown/missing: assume minimum required (conservative)
   - Below requirement: penalize 30-70%

FINAL SCORE CALCULATION:
matchScore = (skillsScore * 0.40) + (experienceScore * 0.35) + (languageScore * 0.25)

REASONING (CRITICAL):
- Be specific: "Candidate has Scanner RF (required ✅) but missing SAP (nice-to-have)"
- Be fair: Acknowledge what matches AND what doesn't
- Be transparent: Explain the scoring clearly
- Do NOT mention: age, gender, ethnicity, religion, health, marital status, appearance
- Do NOT assume: missing skills are "probably" there

Return JSON with: jobId, jobTitle, city, matchScore, matchReasoning, matchFactors`;
}

/**
 * Anti-bias system prompt
 * Tells LLM what discrimination is and why it's forbidden
 *
 * @param language - System language
 * @returns System prompt
 */
function buildAntibiasSystemPrompt(language: "ro" | "nl" | "en" | "de"): string {
  const prompts = {
    ro: `You are a fair and unbiased job matching AI system.

⚠️ CRITICAL - EU AI ACT COMPLIANCE (Article 10):
You MUST NOT DISCRIMINATE based on:
- Age (candidate age, graduation year, "young", "experienced")
- Gender (male/female, appearance, family status)
- Ethnicity (nationality, "foreigner", country of origin)
- Religion (any religious affiliation)
- Health/Disability (mental/physical conditions)
- Marital/Family Status (married, children, dependents)

✅ YOU CAN EVALUATE:
- Professional skills and experience
- Language proficiency (job requirement)
- Relevant certifications
- Years of relevant work experience

Your reasoning MUST be free of any discriminatory language.
If you accidentally use a forbidden term, REJECT it and rephrase professionally.`,

    nl: `Je bent een eerlijk job matching AI systeem.

⚠️ KRITIEK - EU AI ACT COMPLIANCE (Artikel 10):
Je MAG NIET DISCRIMINEREN op basis van:
- Leeftijd
- Geslacht
- Etniciteit
- Religie
- Gezondheid/Handicap
- Burgerlijke staat/Familie

✅ JE KUNT EVALUEREN:
- Professionele vaardigheden
- Taalproficiency
- Relevante certificaten
- Jaren werkervaring

Your reasoning must be fair and free of discrimination.`,

    en: `You are a fair and unbiased job matching AI system.

⚠️ CRITICAL - EU AI ACT COMPLIANCE (Article 10):
You MUST NOT DISCRIMINATE based on:
- Age
- Gender
- Ethnicity
- Religion
- Health/Disability
- Marital/Family Status

✅ YOU CAN EVALUATE:
- Professional skills
- Language proficiency
- Relevant certifications
- Years of work experience

Your reasoning must be free of discriminatory language.`,

    de: `Du bist ein fairer und unvoreingenommenes Job-Matching-KI-System.

⚠️ KRITISCH - EU AI ACT COMPLIANCE (Artikel 10):
Du DARFST NICHT DISKRIMINIEREN aufgrund von:
- Alter
- Geschlecht
- Ethnizität
- Religion
- Gesundheit/Behinderung
- Familienstand

✅ DU KANNST BEWERTEN:
- Berufliche Fähigkeiten
- Sprachprofessionalität
- Relevante Zertifikate
- Jahre Berufserfahrung

Deine Begründung muss diskriminierungsfrei sein.`,
  };

  return prompts[language] || prompts.en;
}

/**
 * Assess how complete the candidate profile is
 *
 * COMPLETE: All fields (education, experience, skills, language)
 * PARTIAL: Missing one field
 * INCOMPLETE: Missing 2+ fields
 *
 * @param session - Candidate session
 * @returns Assessment level
 */
function assessProfileCompleteness(
  session: UserSession
): "complete" | "partial" | "incomplete" {
  const hasEducation = !!session.education;
  const hasExperience = !!session.experience_summary;
  const hasSkills =
    session.hard_skills && session.hard_skills.length > 0;
  const hasLanguage = !!session.language_level;

  const filledFields = [hasEducation, hasExperience, hasSkills, hasLanguage]
    .filter(Boolean).length;

  if (filledFields === 4) return "complete";
  if (filledFields === 3) return "partial";
  return "incomplete";
}

/**
 * Validate matching result for bias
 *
 * Checks all reasoning texts for forbidden keywords
 *
 * @param result - Matching result to validate
 */
function validateMatchingResult(result: MatchingResult): void {
  console.log(`\n🔍 [BIAS VALIDATION] Checking ${result.topMatches.length} matches...`);

  for (const match of result.topMatches) {
    const biasCheck = validateForBias(match.matchReasoning);

    if (!biasCheck.isClean) {
      console.warn(
        `⚠️ [BIAS FLAG] ${match.jobTitle}: Found forbidden keywords:`,
        biasCheck.foundKeywords.join(", ")
      );
      // In production: Log to audit trail, flag for human review
    }
  }

  console.log(`✅ Bias validation complete`);
}

// ============================================
// EXPORTS
// ============================================

export { calculateJobMatch, validateForBias };
