/**
 * @ts-nocheck - EXPERIMENTAL VERSION (server-v3)
 * This is a prototype/experimental implementation with untyped dependencies.
 * Use server.ts or server-v2.ts for production (type-checked versions).
 */
// @ts-nocheck
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";
import { z } from "zod";
import OpenAI from "openai";
import * as fs from "fs";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// ============================================
// 1. SESSION STORAGE
// ============================================

interface UserSession {
  phone: string;

  // INFORMAȚII PERSONALE
  nume?: string;

  // EDUCAȚIE
  school?: string;
  schoolProfile?: string;

  // EXPERIENȚĂ
  experience?: Array<{
    company: string;
    duration: string;
    role: string;
  }>;

  // HARD SKILLS
  hardSkills?: string[];

  // LIMBĂ
  languages?: Array<{
    language: string;
    level: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  }>;

  // NOTĂ INTERNĂ AI
  ai_notes?: string;

  // VECHI (backward compatible)
  hasVCA?: boolean;
  hasBSN?: boolean;
  permis?: boolean;
  limbi?: string[];

  // STATE MANAGEMENT
  stage: "new" | "education" | "experience" | "skills" | "language" | "offered_job" | "completed";
  lastMessage?: string;
  lastUpdate?: number;
}

const SESSIONS_FILE = "/tmp/whatsapp_sessions.json";

function loadSessions(): Record<string, UserSession> {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = fs.readFileSync(SESSIONS_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.log("⚠️ Nu s-a putut citi sessiunile");
  }
  return {};
}

function saveSessions(sessions: Record<string, UserSession>) {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  } catch (error) {
    console.error("❌ Eroare la salvarea sesiunilor:", error);
  }
}

let sessions = loadSessions();

// ============================================
// 2. SCHEMA & CONFIGS
// ============================================

const CandidateSchema = z.object({
  // PERSONALE
  nume: z.string().nullable().optional(),

  // EDUCAȚIE
  school: z.string().nullable().optional(),
  schoolProfile: z.string().nullable().optional(),

  // EXPERIENȚĂ
  experience: z.array(z.object({
    company: z.string().nullable().optional(),
    duration: z.string().nullable().optional(),
    role: z.string().nullable().optional()
  })).optional(),

  // HARD SKILLS
  hardSkills: z.array(z.string()).optional(),

  // LIMBĂ
  languages: z.array(z.object({
    language: z.string(),
    level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).nullable().optional()
  })).optional(),

  // NOTĂ AI
  ai_notes: z.string().nullable().optional(),

  // VECHI
  hasVCA: z.boolean().nullable().optional(),
  hasBSN: z.boolean().nullable().optional(),
  permis: z.boolean().nullable().optional(),
  limbi: z.array(z.string()).optional()
}).passthrough();

const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR3FVLbOc0qgViEyDeU4i4-UoDxN9syRXBCY8fCsqdlquPnLDxkWYHYrOhi2XzUNf0TMvQ3dcMQ7ljh/pub?output=csv";

// SYSTEM PROMPT - INSTRUCȚIUNI BOTULUI (2026 STANDARD)
const SYSTEM_PROMPT = `Tu ești un recruiter expert, prietenos și profesional pentru joburi în logistică din Olanda/Germania.

📋 SCOPUL TĂU: Colectează COMPLET profilul candidatului (Educație → Experiență → Hard Skills → Limbă) printr-o CONVERSAȚIE NATURALĂ.

🎯 REGULI CRITICE (2026 Standards):

1️⃣ **NU PUNE ÎNTREBĂRI CARE ȘTII DEJA**
   - Dacă candidatul deja a zis "Am terminat liceul tehnic", nu mai întreba "Ce studii ai?"
   - Verifică contextul conversației și evită redundanța

2️⃣ **GRUPEAZĂ ÎNTREBĂRI** (Nu interogator)
   - În loc de: "Ce studii ai?" → "Unde ai lucrat?" → "Ce job?"
   - Grupe: "Ce studii ai și unde ai lucrat mai mult timp?" (2 iepuri deodată)

3️⃣ **EXTRAGE IMPLICIT din mesaje**
   - Dacă zice: "Am lucrat 3 ani la Emag ca Order Picker și am folosit scanner"
   - TU EXTRAGI: experience = [{company: "Emag", duration: "3 ani", role: "Order Picker"}], hardSkills = ["Scanner"]
   - Nu mai întreba despre joburile astea

4️⃣ **FAZE DINAMICE** (sari peste dacă ai info):
   - Faza 1: EDUCAȚIE - "Ce studii ai terminat?"
   - Faza 2: EXPERIENȚĂ - "Unde ai lucrat și în ce domeniu?"
   - Faza 3: HARD SKILLS - Aderesc pe bază de experiență. Ex: "Ai lucrat în depozit, ai folosit scanner?"
   - Faza 4: LIMBĂ - "Ce limbă prefer pentru instrucțiuni? (Română, Engleză, Germană?)"

5️⃣ **LĂSAȚI IMPRESII** (ai_notes)
   - Pe măsură ce cunoști omul, formează o impresie: "Pare motivat", "Răspunde prompt", "Are vocabular tehnic"

6️⃣ **TON PROFESIONAL dar PRIETENOS**
   - NU: "DATE PERSONALE NECESARE: 1) Nume 2) Educație..."
   - DA: "Super! Spune-mi puțin despre tine. De exemplu, ce studii ai și unde ai lucrat?"

JOBURI DISPONIBILE:
1. Order Picker (Tilburg, 14€/h) - VCA necesar
2. Montator Panouri (Rotterdam, 16€/h) - BSN necesar
3. Stivuitorist (Eindhoven, 17€/h) - VCA+BSN
4. Curier (Amsterdam, 13€/h)
5. Lucrător Depozit (Venlo, 14.5€/h) - BSN
6. Operator CNC (Utrecht, 15.5€/h) - VCA+BSN

🎯 CÂND TERMINI COLECTAREA: După ce ai educație, experiență și limbă, spune "Gata! Am toate informațiile."`;


const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================================
// 3. EMAIL NOTIFICATION (RESEND)
// ============================================

async function trimiteNotificareMatch(candidat: UserSession, job: any) {
  try {
    // Construiește porțiuni de HTML pentru datele disponibile
    const educationHTML = candidat.school
      ? `<p><strong>📚 Educație:</strong> ${candidat.school}${candidat.schoolProfile ? ` (${candidat.schoolProfile})` : ""}</p>`
      : "";

    const experienceHTML = candidat.experience && candidat.experience.length > 0
      ? `<p><strong>💼 Experiență:</strong></p><ul>${candidat.experience.map(e => `<li>${e.role} la ${e.company} (${e.duration})</li>`).join("")}</ul>`
      : "";

    const skillsHTML = candidat.hardSkills && candidat.hardSkills.length > 0
      ? `<p><strong>🛠️ Competențe Tehnice:</strong> ${candidat.hardSkills.map(s => `✅ ${s}`).join(", ")}</p>`
      : "";

    const languageHTML = candidat.languages && candidat.languages.length > 0
      ? `<p><strong>🌍 Limbă:</strong> ${candidat.languages.map(l => `${l.language} (${l.level || "nivel necunoscut"})`).join(", ")}</p>`
      : "";

    const certHTML = `<p><strong>📜 Certificate:</strong> VCA: ${candidat.hasVCA ? "✅ DA" : "❌ NU"} | BSN: ${candidat.hasBSN ? "✅ DA" : "❌ NU"}</p>`;

    const aiNotesHTML = candidat.ai_notes
      ? `<p><em style="color: #666;">💡 Notă interna: ${candidat.ai_notes}</em></p>`
      : "";

    const response = await axios.post("https://api.resend.com/emails", {
      from: process.env.RESEND_FROM_EMAIL,
      to: process.env.NOTIFICATION_EMAIL,
      subject: `🎯 MATCH GĂSIT: ${candidat.nume} - ${job.Titlu}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2ecc71;">🎉 Nou Match de Recrutare!</h2>

          <hr style="border: none; border-top: 2px solid #eee; margin: 20px 0;">

          <h3>👤 CANDIDAT</h3>
          <p><strong>Nume:</strong> ${candidat.nume}</p>
          <p><strong>Telefon:</strong> +${candidat.phone}</p>
          ${educationHTML}
          ${experienceHTML}
          ${skillsHTML}
          ${languageHTML}
          ${certHTML}
          ${aiNotesHTML}

          <hr style="border: none; border-top: 2px solid #eee; margin: 20px 0;">

          <h3>💼 JOB POTRIVIT</h3>
          <p><strong>Poziție:</strong> ${job.Titlu}</p>
          <p><strong>Oraș:</strong> ${job["Oraș"]}</p>
          <p><strong>Salariu:</strong> <strong style="color: #27ae60;">${job["Salariu (€/oră)"]}€/oră</strong></p>
          <p><strong>Descriere:</strong> ${job["Descriere Scurtă"]}</p>

          <hr style="border: none; border-top: 2px solid #eee; margin: 20px 0;">

          <p style="text-align: center; color: #7f8c8d;">
            ✨ <em>Email generat automat de Recrutare AI WhatsApp Bot V4 (2026)</em>
          </p>
        </div>
      `
    }, {
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    console.log(`✅ Email trimis pentru match: ${candidat.nume} - ${job.Titlu}`);
    return response.data;
  } catch (error) {
    console.error("❌ Eroare la trimiterea email:", error);
  }
}

// ============================================
// 4. AGENT 2: EXTRACTOR
// ============================================

async function extractCandidate(mesaj: string, existingData?: UserSession) {
  try {
    let context = "";
    if (existingData) {
      const dataPoints = [];
      if (existingData.nume) dataPoints.push(`Nume: ${existingData.nume}`);
      if (existingData.school) dataPoints.push(`Studii: ${existingData.school}`);
      if (existingData.experience?.length) {
        dataPoints.push(`Experiență: ${existingData.experience.map(e => `${e.role} la ${e.company}`).join(", ")}`);
      }
      if (existingData.hardSkills?.length) dataPoints.push(`Skills: ${existingData.hardSkills.join(", ")}`);

      context = dataPoints.length > 0
        ? `CONTEXT (ce știu deja):\n${dataPoints.join("\n")}\n\nAcum extrage și COMPLICĂ cu noile informații din mesaj.`
        : "";
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `${SYSTEM_PROMPT}

${context}

INSTRUCȚIUNI PARSE:
1. Extrage NUME: Căută "Mă numesc X" sau "Sunt X"
2. Extrage EDUCAȚIE: "terminat [liceul/profesională/universitate] [pe] [PROFIL]"
3. Extrage EXPERIENȚĂ: "lucrat X ani la [COMPANIE] ca [ROL]" → crea array cu {company, duration, role}
4. Extrage SKILLS: "am folosit/am condus [UTILAJ/SOFTWARE]" → ["Scanner", "Liză", etc]
5. Extrage LIMBĂ: "vorbesc [LIMBĂ] [nivel]" → ["Engleză" = A1/A2, "Bun engleză" = B1]
6. Extrage CERTIFICATE: "am VCA" = true, "nu am BSN" = false
7. Notă AI: Dacă mesaj e lung și detaliat = "Răspunde detaliat, pare motivat"

Mesaj: "${mesaj}"

RETURNEAZĂ NUMAI JSON (fără ```json, fără blocuri markdown):
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
}`
        }
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
// 5. AGENT 3: MATCHER
// ============================================

async function gasesteJobDinGoogle(candidat: UserSession): Promise<{ raspuns: string, job?: any }> {
  try {
    console.log(`🔍 Căut joburi pentru ${candidat.nume}...`);

    const response = await axios.get(GOOGLE_SHEET_CSV_URL);

    const joburi = parse(response.data, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      cast: true
    });

    const match = joburi.find((job: any) => {
      const necesitaVCA = job["Necesită VCA"] === "TRUE";
      const necesitaBSN = job["Necesită BSN"] === "TRUE";

      const vcaOk = necesitaVCA ? candidat.hasVCA : true;
      const bsnOk = necesitaBSN ? candidat.hasBSN : true;
      return vcaOk && bsnOk;
    });

    if (match) {
      // DECLANȘEZ EMAIL-UL!
      await trimiteNotificareMatch(candidat, match);

      return {
        raspuns: `🚀 MATCH GĂSIT! ${candidat.nume}, am un post de ${match.Titlu} în ${match["Oraș"]} la ${match["Salariu (€/oră)"]}€/oră. Te interesează? Scrie "Da" sau "Nu"`,
        job: match
      };
    } else {
      return {
        raspuns: `${candidat.nume}, momentan nu avem un job care să se potrivească cu profilul tău, dar te vom contacta!`
      };
    }

  } catch (error) {
    console.error("❌ Eroare la matching:", error);
    return {
      raspuns: "Scuze, ceva nu merge. Incearcă din nou!"
    };
  }
}

// ============================================
// 6. AGENT 1: STATE MACHINE
// ============================================

async function handleUserMessage(from: string, msgText: string): Promise<string> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📱 USER: +${from} → "${msgText}"`);
  console.log(`${"=".repeat(60)}`);

  let user = sessions[from];

  // ============ USER NOU ============
  if (!user) {
    console.log(`✨ USER NOU`);
    const extracted = await extractCandidate(msgText);

    user = {
      phone: from,
      ...(extracted || {}),
      stage: "education",
      lastMessage: msgText,
      lastUpdate: Date.now()
    };
    sessions[from] = user;
    saveSessions(sessions);

    // Deja are nume? Skip EDUCATION
    if (user.nume && user.school) {
      user.stage = "experience";
      saveSessions(sessions);
      return `Super, ${user.nume}! Spune-mi unde ai lucrat și în ce domeniu?`;
    }

    return `👋 Salut! Sunt recruiter AI. Ca să te cunosc mai bine, spune-mi:\n- Cum te cheamă?\n- Ce studii ai terminat? (Liceu, Profesională, Universitate?)`;
  }

  // ============ FAZA 1: EDUCAȚIE ============
  if (user.stage === "education") {
    console.log(`📚 COLECTEZ EDUCAȚIE`);
    const extracted = await extractCandidate(msgText, user);

    if (extracted) {
      user.nume = user.nume || extracted.nume;
      user.school = user.school || extracted.school;
      user.schoolProfile = user.schoolProfile || extracted.schoolProfile;
      user.lastMessage = msgText;
      user.lastUpdate = Date.now();
    }

    // Check: Am nome și educație?
    if (user.nume && user.school) {
      user.stage = "experience";
      saveSessions(sessions);
      return `Excelent, ${user.nume}! Și unde ai lucrat până acum? Spune-mi 2 joburi pe care le-ai avut.`;
    }

    saveSessions(sessions);
    return `Mulțumesc! Îmi mai trebuie și nivelul tău de studii pentru a face o potrivire bună.`;
  }

  // ============ FAZA 2: EXPERIENȚĂ ============
  if (user.stage === "experience") {
    console.log(`💼 COLECTEZ EXPERIENȚĂ`);
    const extracted = await extractCandidate(msgText, user);

    if (extracted) {
      // Merge experience arrays
      if (extracted.experience && extracted.experience.length > 0) {
        user.experience = [...(user.experience || []), ...extracted.experience];
      }
      // Also accept joburi menționați din mesaj
      if (!user.experience || user.experience.length === 0) {
        // Fallback: salvează text-ul ca note
        if (msgText.toLowerCase().includes("lucr") || msgText.toLowerCase().includes("job")) {
          user.experience = [{ company: null, duration: null, role: null }];
        }
      }
      user.lastMessage = msgText;
      user.lastUpdate = Date.now();
    }

    // Check: Am experiență sau am auzit de joburi?
    const hasExp = user.experience && user.experience.length > 0;
    if (hasExp) {
      user.stage = "skills";
      saveSessions(sessions);

      // Sugerează skills pe baza experienței
      const jobTypes = user.experience
        .map(e => e.role || "o poziție")
        .filter(Boolean)
        .join(", ");
      return `Bun! Văd că ai lucrat. Ce utilaje sau software ai folosit? (Ex: Scanner, SAP, Motostivuitor, etc.)`;
    }

    saveSessions(sessions);
    return `Mulțumesc! Spune-mi mai mult despre joburile pe care le-ai avut - ce companii și cât timp.`;
  }

  // ============ FAZA 3: HARD SKILLS ============
  if (user.stage === "skills") {
    console.log(`🛠️ COLECTEZ SKILLS`);
    const extracted = await extractCandidate(msgText, user);

    if (extracted && extracted.hardSkills) {
      user.hardSkills = extracted.hardSkills;
      user.lastMessage = msgText;
      user.lastUpdate = Date.now();
    }

    // Sempre go to language phase
    user.stage = "language";
    saveSessions(sessions);
    return `Super! Și în ce limbă te simți confortabil cu instrucțiuni? (Română, Engleză, Germană?)`;
  }

  // ============ FAZA 4: LIMBĂ ============
  if (user.stage === "language") {
    console.log(`🌍 COLECTEZ LIMBĂ`);
    const extracted = await extractCandidate(msgText, user);

    if (extracted && extracted.languages) {
      user.languages = extracted.languages;
      user.lastMessage = msgText;
      user.lastUpdate = Date.now();
    }

    // Extract ai_notes despre candidat
    if (!user.ai_notes) {
      // Simplă heuristică: dacă răspunde repede și politicos = motivat
      if (msgText.length > 5) {
        user.ai_notes = "Răspunde detaliat și pare motivat";
      }
    }

    // Ready to match!
    user.stage = "offered_job";
    saveSessions(sessions);

    const result = await gasesteJobDinGoogle(user);
    user.stage = "offered_job";
    saveSessions(sessions);
    return result.raspuns;
  }

  // ============ OFERTĂ JOB ============
  if (user.stage === "offered_job") {
    const response = msgText.toLowerCase().trim();

    if (response === "da" || response === "yes" || response === "yep") {
      user.stage = "completed";
      saveSessions(sessions);
      return `🎉 Excelent, ${user.nume}! Te voi contacta în curând. Mulțumim pentru interes! 📞`;
    } else if (response === "nu" || response === "no" || response === "nope") {
      user.stage = "experience";
      saveSessions(sessions);
      return `Înțeles! Dacă vrei alt tip de job, spune-mi ce preferi.`;
    } else {
      return `Răspunde-mi cu "Da" sau "Nu" - te interesează oferta asta?`;
    }
  }

  // ============ COMPLETAT ============
  if (user.stage === "completed") {
    if (msgText.toLowerCase() === "reset") {
      delete sessions[from];
      saveSessions(sessions);
      return `✨ Profil resetat! Pornim din nou cu "Salut"?`;
    }
    return `Pare că deja am toate info. Dacă vrei să schimbi ceva, scrie "Reset"`;
  }

  return `Nu am înțeles. Spune-mi mai clar 😊`;
}

// ============================================
// 7. WEBHOOK ENDPOINTS
// ============================================

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === process.env.VERIFY_TOKEN) {
    console.log(`✅ Webhook verificat!\n`);
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  const body = req.body;
  res.sendStatus(200);

  if (body.object === "whatsapp_business_account") {
    try {
      const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;

      if (messages && messages.length > 0) {
        const message = messages[0];
        const from = message.from;
        const msgText = message.text.body;

        const reply = await handleUserMessage(from, msgText);

        console.log(`\n📤 REPLY: ${reply}\n`);
        await trimiteMesajWhatsApp(from, reply);
      }
    } catch (error) {
      console.error("❌ Eroare:", error);
    }
  }
});

// ============================================
// 8. WHATSAPP SEND
// ============================================

async function trimiteMesajWhatsApp(to: string, text: string): Promise<void> {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log(`✅ Mesaj WhatsApp trimis`);
  } catch (error) {
    console.error("❌ Eroare la WhatsApp:", error);
  }
}

// ============================================
// 9. START
// ============================================

app.listen(PORT, () => {
  console.log(`\n🚀 WEBHOOK V3 (SYSTEM PROMPT + EMAIL) ACTIV!`);
  console.log(`📍 Portul: ${PORT}`);
  console.log(`📧 Notificări la: ${process.env.NOTIFICATION_EMAIL}\n`);
});
