/**
 * CODE SNIPPETS - SEGMENT 5 (FINAL)
 * Job Matching Engine Integration
 *
 * @version 5.0
 * @description
 *   Shows how to integrate job-matcher.ts into the main flow.
 *   Called when candidate profile is 100% complete.
 */

// ============================================
// SNIPPET #1: IMPORTS
// ============================================

import { calculateJobMatch, validateForBias, Job } from "./job-matcher";

// ============================================
// SNIPPET #2: CONVERT GOOGLE SHEETS TO JOB OBJECTS
// ============================================
// Add this function to parse Google Sheets data into Job[] format

/**
 * Convert Google Sheets CSV data to Job[] structure
 *
 * Google Sheets columns (example):
 * | jobId | jobTitle | city | salary | requiredSkills | requiredExperience | requiredLanguage | niceToHave |
 * | job_1 | Order Picker | Tilburg | 14€/h | Scanner RF,Inventory | 2 | A2 | EPT |
 *
 * @param csvData - Raw CSV data from Google Sheets
 * @param clientConfig - Client config (to filter client-specific jobs)
 * @returns Job[] array
 */
function parseJobsFromSheets(
  csvData: any[],
  clientConfig: ClientConfig
): Job[] {
  return csvData
    .map((row) => ({
      jobId: row.jobId || `job_${Date.now()}`,
      jobTitle: row.jobTitle || row.Titlu || "",
      city: row.city || row["Oraș"] || "",
      salary: row.salary || row["Salariu (€/oră)"] || "",
      requiredSkills: (row.requiredSkills || row["Necesită"] || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean),
      requiredExperience: parseInt(row.requiredExperience || "0") || 0,
      requiredLanguageLevel: row.requiredLanguage || "A1",
      niceToHaveSkills: (row.niceToHave || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean),
      description: row.description || "",
    }))
    .filter((job) => job.jobTitle); // Remove empty rows
}

// ============================================
// SNIPPET #3: FIND MATCHES AFTER PROFILE COMPLETE
// ============================================
// Add this in handleUserMessage() or a separate function

/**
 * Find job matches for candidate
 * Called when UserSession.stage reaches "offered_job"
 *
 * FLOW:
 * 1. Check profile completeness
 * 2. Call calculateJobMatch()
 * 3. Get Top 3 matches
 * 4. Send HR notification with Human-in-the-Loop disclaimer
 * 5. Send WhatsApp response to candidate
 *
 * @param session - Complete candidate profile
 * @param clientConfig - Client configuration
 * @returns WhatsApp response message
 */
async function findAndNotifyMatches(
  session: UserSession,
  clientConfig: ClientConfig
): Promise<string> {
  try {
    console.log(
      `\n🎯 [FIND MATCHES] Profile complete for ${session.phone}`
    );

    // Step 1: Fetch available jobs for this client
    const jobsResponse = await axios.get(
      `https://docs.google.com/spreadsheets/d/e/${clientConfig.googleSheetId}/pub?output=csv`
    );

    const jobsRaw = parse(jobsResponse.data, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const jobs = parseJobsFromSheets(jobsRaw, clientConfig);
    console.log(`   📋 Found ${jobs.length} available jobs`);

    // Step 2: Calculate matches
    const matchResult = await calculateJobMatch(session, jobs, clientConfig);

    if (!matchResult || matchResult.topMatches.length === 0) {
      // No good matches
      const noMatchMessage =
        clientConfig.systemLanguage === "nl"
          ? `Helaas hebben we momenteel geen perfecte match voor je profiel.
             Stuur ons je CV opnieuw over een paar weken als je nieuw ervaring hebt opgedaan!`
          : `Din păcate, nu avem în moment o potrivire perfectă pentru profilul tău.
             Te-am notat și te vom contacta când apar joburi noi!`;

      await trimiteMesajWhatsApp(session.phone, noMatchMessage, clientConfig);

      return noMatchMessage;
    }

    // Step 3: Get best match
    const bestMatch = matchResult.topMatches[0];

    console.log(
      `\n✅ MATCHES FOUND:`
    );
    matchResult.topMatches.forEach((m, i) => {
      console.log(
        `   ${i + 1}. ${m.jobTitle} (${m.city}) - Score: ${m.matchScore}%`
      );
    });

    // Step 4: Send HR notification (Human-in-the-Loop)
    await sendHRNotification(session, matchResult, clientConfig);

    // Step 5: Send WhatsApp response
    const whatsappMessage = generateWhatsAppOffer(
      session,
      bestMatch,
      clientConfig
    );

    await trimiteMesajWhatsApp(
      session.phone,
      whatsappMessage,
      clientConfig
    );

    return whatsappMessage;
  } catch (error) {
    console.error(`❌ Error finding matches:`, error);
    return "Scuze, a fost o problemă la căutarea job-urilor. Te rog reîncearcă mai târziu.";
  }
}

// ============================================
// SNIPPET #4: HR NOTIFICATION (HUMAN-IN-THE-LOOP)
// ============================================
// Send email to recruiter with AI recommendation + disclaimer

/**
 * Send HR notification with job matches
 *
 * EMAIL includes:
 * - Candidate profile summary
 * - Top 3 matches (scores + reasoning)
 * - Human-in-the-Loop disclaimer (EU AI Act)
 * - Call-to-action button
 *
 * @param session - Candidate profile
 * @param matchResult - Matching result from AI
 * @param clientConfig - Client configuration
 */
async function sendHRNotification(
  session: UserSession,
  matchResult: any,
  clientConfig: ClientConfig
): Promise<void> {
  try {
    const htmlEmail = buildHREmailHTML(
      session,
      matchResult,
      clientConfig
    );

    const response = await axios.post("https://api.resend.com/emails", {
      from: process.env.RESEND_FROM_EMAIL,
      to: clientConfig.notificationEmail,
      subject: `🎯 AI MATCH FOUND: ${session.nume} - Top ${matchResult.topMatches.length} Candidates`,
      html: htmlEmail,
    }, {
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    console.log(`✅ HR notification sent to ${clientConfig.notificationEmail}`);
  } catch (error) {
    console.error(`❌ Error sending HR notification:`, error);
  }
}

// ============================================
// SNIPPET #5: HR EMAIL TEMPLATE (HTML)
// ============================================
// Generate professional HTML email for recruiter

/**
 * Build HR notification email (HTML)
 *
 * @param session - Candidate
 * @param matchResult - Top 3 matches
 * @param clientConfig - Client config
 * @returns HTML email string
 */
function buildHREmailHTML(
  session: UserSession,
  matchResult: any,
  clientConfig: ClientConfig
): string {
  const topMatches = matchResult.topMatches
    .map(
      (match: any, index: number) => `
    <div style="background: #f5f5f5; padding: 15px; margin: 10px 0; border-left: 4px solid ${
        index === 0 ? "#27ae60" : "#3498db"
      };">
      <h3>${index + 1}. ${match.jobTitle} - ${match.city}</h3>
      <p><strong>AI Match Score:</strong> <span style="color: #27ae60; font-size: 18px;">${match.matchScore}%</span></p>

      <div style="margin: 10px 0;">
        <strong>📊 Breakdown:</strong>
        <ul style="margin: 5px 0;">
          <li>Skills Match: ${match.matchFactors.skillsScore}%</li>
          <li>Experience: ${match.matchFactors.experienceScore}%</li>
          <li>Language: ${match.matchFactors.languageScore}%</li>
        </ul>
      </div>

      <p><strong>🤖 AI Reasoning:</strong></p>
      <p style="font-style: italic; color: #555;">${match.matchReasoning}</p>
    </div>
  `
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; color: #333; }
    .container { max-width: 600px; margin: 0 auto; background: #fff; padding: 20px; }
    .header { background: #2c3e50; color: white; padding: 20px; border-radius: 5px; }
    .disclaimer { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 5px; }
    .footer { font-size: 12px; color: #999; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎯 AI CANDIDATE MATCH FOUND</h1>
      <p>New candidate profile with ${matchResult.topMatches.length} job match recommendations</p>
    </div>

    <h2>👤 Candidate Profile</h2>
    <p><strong>Name:</strong> ${session.nume || "Unknown"}</p>
    <p><strong>Phone:</strong> ${session.phone}</p>

    <h3>📋 Profile Summary:</h3>
    <ul>
      <li><strong>Education:</strong> ${session.education || "(not provided)"}</li>
      <li><strong>Experience:</strong> ${session.experience_summary || "(not provided)"}</li>
      <li><strong>Skills:</strong> ${session.hard_skills?.join(", ") || "(not provided)"}</li>
      <li><strong>Language Level:</strong> ${session.language_level || "(unknown)"}</li>
    </ul>

    <p><strong>Assessment Quality:</strong> ${matchResult.assessmentCompleteness}</p>
    ${
      matchResult.assessmentNotes
        ? `<p><em>${matchResult.assessmentNotes}</em></p>`
        : ""
    }

    <h2>🏆 Top ${matchResult.topMatches.length} Job Matches</h2>
    ${topMatches}

    <div class="disclaimer">
      <h3>⚠️ IMPORTANT: EU AI Act Compliance (Human-in-the-Loop)</h3>
      <p>
        <strong>This is an AI RECOMMENDATION only.</strong>
      </p>
      <p>
        The scores and reasoning above are generated by our intelligent matching system
        to help you make better hiring decisions. However:
      </p>
      <ul>
        <li>✅ You (the recruiter) make the final hiring decision</li>
        <li>✅ AI cannot guarantee job fit or predict performance</li>
        <li>✅ Please review the candidate profile independently</li>
        <li>✅ Look for potential bias in scoring (though we use anti-bias validation)</li>
        <li>✅ Consider factors beyond skills (culture fit, team needs, etc.)</li>
      </ul>
      <p>
        <strong>No discrimination:</strong> This system does not consider age, gender,
        ethnicity, religion, health, or marital status. Only job-relevant skills and
        experience are evaluated.
      </p>
    </div>

    <h2>📞 Next Steps</h2>
    <ol>
      <li>Review candidate profile and match scores</li>
      <li>Click the button below to view full candidate details</li>
      <li>Contact the candidate if interested (WhatsApp details above)</li>
      <li>Provide feedback on match quality for future improvements</li>
    </ol>

    <p style="text-align: center; margin: 30px 0;">
      <a href="[CANDIDATE_PORTAL_URL]" style="background: #27ae60; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
        📌 View Full Candidate Profile
      </a>
    </p>

    <div class="footer">
      <p>
        <strong>Recruitment AI v5.0 - Segment 5 Complete</strong>
      </p>
      <p>
        This email was generated by our intelligent job matching system.
        For questions about AI scoring, please contact the system administrator.
      </p>
      <p>
        <em>Platform compliant with: GDPR (EU) • EU AI Act • Privacy-by-Design</em>
      </p>
    </div>
  </div>
</body>
</html>
  `;
}

// ============================================
// SNIPPET #6: WHATSAPP OFFER MESSAGE
// ============================================
// Generate user-friendly WhatsApp message

/**
 * Generate WhatsApp message for candidate
 *
 * @param session - Candidate
 * @param bestMatch - Top job match
 * @param clientConfig - Client config
 * @returns WhatsApp message
 */
function generateWhatsAppOffer(
  session: UserSession,
  bestMatch: any,
  clientConfig: ClientConfig
): string {
  const messages = {
    ro: `🚀 MATCH GĂSIT, ${session.nume}!

Am analizat profilul tău și am găsit o poziție perfectă pentru tine:

📍 **${bestMatch.jobTitle}** - ${bestMatch.city}
💰 Salariu: ${bestMatch.salary}
🎯 AI Matching Score: ${bestMatch.matchScore}%

**De ce ți se potrivește:**
${bestMatch.matchReasoning}

Ești interesat? Răspunde cu DA pentru a continua cu procesul de recrutare!

*Notă: Aceasta este o recomandare AI. Recruiterul nostru uman va revizui și va lua decizia finală.*`,

    nl: `🚀 MATCH GEVONDEN, ${session.nume}!

Ik heb je profiel geanalyseerd en een perfecte positie voor je gevonden:

📍 **${bestMatch.jobTitle}** - ${bestMatch.city}
💰 Salaris: ${bestMatch.salary}
🎯 AI Matching Score: ${bestMatch.matchScore}%

**Waarom past dit bij jou:**
${bestMatch.matchReasoning}

Ben je geïnteresseerd? Antwoord met JA om door te gaan!

*Opmerking: Dit is een AI-aanbeveling. Onze recruiter zal beoordelen.*`,

    en: `🚀 MATCH FOUND, ${session.nume}!

I've analyzed your profile and found a perfect position for you:

📍 **${bestMatch.jobTitle}** - ${bestMatch.city}
💰 Salary: ${bestMatch.salary}
🎯 AI Matching Score: ${bestMatch.matchScore}%

**Why this matches you:**
${bestMatch.matchReasoning}

Interested? Reply with YES to continue!

*Note: This is an AI recommendation. Our recruiter will make the final decision.*`,

    de: `🚀 MATCH GEFUNDEN, ${session.nume}!

Ich habe dein Profil analysiert und eine perfekte Position für dich gefunden:

📍 **${bestMatch.jobTitle}** - ${bestMatch.city}
💰 Gehalt: ${bestMatch.salary}
🎯 AI-Matching-Score: ${bestMatch.matchScore}%

**Warum passt dies zu dir:**
${bestMatch.matchReasoning}

Interessiert? Antworte mit JA!`,
  };

  return (
    messages[clientConfig.systemLanguage] || messages.en
  );
}

// ============================================
// SNIPPET #7: INTEGRATE INTO handleUserMessage()
// ============================================
// Add this when session.stage === "offered_job"

/**
 * When profile is complete:
 * 1. Update stage to "offered_job"
 * 2. Call findAndNotifyMatches()
 * 3. Return WhatsApp response
 */

// In handleUserMessage(), after language collection completes:
// session.stage = "offered_job";
// const matchMessage = await findAndNotifyMatches(session, clientConfig);
// saveSessions(sessions);
// return matchMessage;

// ============================================
// END OF CODE SNIPPETS
// ============================================
