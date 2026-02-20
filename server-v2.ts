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
// 1. SESSION STORAGE (MEMORIE UTILIZATORI)
// ============================================

interface UserSession {
  phone: string;
  nume?: string;
  hasVCA?: boolean;
  hasBSN?: boolean;
  permis?: boolean;
  limbi?: string[];
  stage: "new" | "collecting_info" | "has_data" | "offered_job" | "completed";
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
    console.log("⚠️ Nu s-a putut citi sessiunile, pornind cu gol");
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
// 2. SCHEMA & FUNCȚII
// ============================================

const CandidateSchema = z.object({
  nume: z.string().nullable().optional(),
  hasVCA: z.boolean().nullable().optional(),
  hasBSN: z.boolean().nullable().optional(),
  permis: z.boolean().nullable().optional(),
  limbi: z.array(z.string()).optional()
}).passthrough(); // Acceptă și alte fields

const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSO-y2ueZ1ocKYEpTrLH6sAWVDEW0y42JQV8nSp2e77s5zb0XSOnq4MgOxBZxhysXKL-JEOas5bAbq3/pub?output=csv";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================================
// 3. AGENTUL 2: EXTRACTOR (IMPROVED)
// ============================================

async function extractCandidate(mesaj: string, existingData?: UserSession) {
  try {
    const context = existingData
      ? `Context: Deja știm că ${existingData.nume || "omul"} a spus: "${existingData.lastMessage}". Acum adaugă noile informații din mesajul nou.`
      : "";

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `${context}

Citește următorul mesaj și extrage DOAR informațiile prezente (restul pot fi null/undefined):

"${mesaj}"

Returnează DOAR JSON:
{
  "nume": string sau null,
  "hasVCA": boolean sau null,
  "hasBSN": boolean sau null,
  "permis": boolean sau null,
  "limbi": array de stringuri sau []
}`
        }
      ],
      temperature: 0,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return null;
    }

    const extracted = JSON.parse(jsonMatch[0]);
    try {
      return CandidateSchema.parse(extracted);
    } catch (validationError) {
      // Dacă validarea eșuează, returnez ce am putut extrage
      console.warn("⚠️ Validare parțială:", validationError);
      return extracted;
    }
  } catch (error) {
    console.error("❌ Eroare la extragere:", error);
    return null;
  }
}

// ============================================
// 4. AGENTUL 3: MATCHER
// ============================================

async function gasesteJobDinGoogle(candidat: UserSession): Promise<string> {
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
      return `🚀 MATCH GĂSIT! ${candidat.nume}, am un post de ${match.Titlu} în ${match["Oraș"]} la ${match["Salariu (€/oră)"]}€/oră. Te interesează? Scrie "Da" sau "Nu"`;
    } else {
      return `${candidat.nume}, momentan nu avem un job care să se potrivească perfect cu ${candidat.hasVCA ? "VCA" : ""} ${candidat.hasBSN ? "BSN" : ""}, dar o să ți-l sunăm!`;
    }

  } catch (error) {
    console.error("❌ Eroare la matching:", error);
    return "Scuze, ceva nu merge. Incearcă din nou!";
  }
}

// ============================================
// 5. AGENTUL 1: STATE MACHINE (CREIERUL)
// ============================================

async function handleUserMessage(from: string, msgText: string): Promise<string> {
  console.log(`\n👤 User: +${from} → "${msgText}"`);

  // Obțin sesiunea utilizatorului
  let user = sessions[from];

  // CAZ 1: USER NU EXISTĂ ÎN SISTEM (PRIMA DATĂ)
  if (!user) {
    console.log(`✨ USER NOU: +${from}`);

    // Încerc să extrag date din mesaj
    const extracted = await extractCandidate(msgText);

    if (extracted && extracted.nume) {
      // AVEM DATE! Salvez utilizatorul și merg la matcher
      user = {
        phone: from,
        ...extracted,
        stage: "has_data",
        lastMessage: msgText,
        lastUpdate: Date.now()
      };
      sessions[from] = user;
      saveSessions(sessions);

      console.log(`✅ Date extrase: ${user.nume}`);
      const jobOffer = await gasesteJobDinGoogle(user);
      user.stage = "offered_job";
      saveSessions(sessions);
      return jobOffer;
    } else {
      // NU AVEM DATE SUFICIENTE
      user = {
        phone: from,
        stage: "collecting_info",
        lastMessage: msgText,
        lastUpdate: Date.now()
      };
      sessions[from] = user;
      saveSessions(sessions);

      return `👋 Salut! Sunt botul de recrutare. Ca să te ajut, spune-mi te rog:\n- Cum te cheamă?\n- Ai diplomă VCA?\n- Ai certificat BSN?`;
    }
  }

  // CAZ 2: USER EXISTĂ ȘI E ÎN STADIU DE COLECTARE DATE
  if (user.stage === "collecting_info") {
    console.log(`📝 COLECTEZ DATE pentru +${from}`);

    // Încerc să extrag date noi
    const extracted = await extractCandidate(msgText, user);

    if (extracted) {
      // MERGE DATELE - UPDATE PROFIL
      user.nume = user.nume || extracted.nume;
      user.hasVCA = user.hasVCA !== undefined ? user.hasVCA : extracted.hasVCA;
      user.hasBSN = user.hasBSN !== undefined ? user.hasBSN : extracted.hasBSN;
      user.permis = user.permis !== undefined ? user.permis : extracted.permis;
      user.limbi = user.limbi || extracted.limbi;
      user.lastMessage = msgText;
      user.lastUpdate = Date.now();

      // Verific dacă avem date suficiente
      if (user.nume && (user.hasVCA !== undefined || user.hasBSN !== undefined)) {
        user.stage = "has_data";
        saveSessions(sessions);

        console.log(`✅ Profil actualizat: ${user.nume}`);
        const jobOffer = await gasesteJobDinGoogle(user);
        user.stage = "offered_job";
        saveSessions(sessions);
        return jobOffer;
      } else {
        saveSessions(sessions);
        return `Thanks ${user.nume || ""}! Spune-mi și despre diploma VCA și BSN dacă le ai`;
      }
    }

    return `Scuze, nu am înțeles. Spune-mi te rog numele și diplome (VCA/BSN)`;
  }

  // CAZ 3: USER ARE DATE ȘI I-AM OFERIT JOB ("Da" / "Nu")
  if (user.stage === "offered_job") {
    const response = msgText.toLowerCase().trim();

    if (response === "da" || response === "yes" || response === "yep" || response === "ok") {
      user.stage = "completed";
      saveSessions(sessions);

      return `🎉 Excelent, ${user.nume}! Te voi contacta în curând pentru detalii. Mulțumim! 📞`;
    } else if (response === "nu" || response === "no" || response === "nope") {
      user.stage = "collecting_info";
      saveSessions(sessions);

      return `Înțeles! Dacă vrei alt tip de job, spune-mi te rog ce cauți.`;
    } else {
      // Nu a zis da/nu, dar a zis ceva
      return `Am înțeles. Vrei să continui cu oferta asta sau nu? Scrie "Da" sau "Nu"`;
    }
  }

  // CAZ 4: USER A COMPLETAT PROCESUL
  if (user.stage === "completed") {
    if (msgText.toLowerCase() === "reset") {
      delete sessions[from];
      saveSessions(sessions);
      return `✨ Profil resetat! Pornim din nou?`;
    }
    return `Oops, pare că deja te-am contactat! Dacă vrei de la capat, scrie "Reset"`;
  }

  return `Nu am înțeles. Spune-mi mai clar 😊`;
}

// ============================================
// 6. WEBHOOK ENDPOINTS
// ============================================

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === process.env.VERIFY_TOKEN) {
    console.log(`✅ Webhook verificat cu succes!\n`);
    res.status(200).send(challenge);
  } else {
    console.log(`❌ Token incorect!\n`);
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  const body = req.body;
  res.sendStatus(200); // Confirma imediat Meta

  if (body.object === "whatsapp_business_account") {
    try {
      const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;

      if (messages && messages.length > 0) {
        const message = messages[0];
        const from = message.from;
        const msgText = message.text.body;

        console.log(`\n${"=".repeat(60)}`);
        console.log(`📱 MESAJ PRIMIT DE LA +${from}`);
        console.log(`💬 "${msgText}"`);
        console.log(`${"=".repeat(60)}`);

        // AGENTUL 1: CREIERUL (STATE MACHINE)
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
// 7. TRIMITERE MESAJ
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

    console.log(`✅ Mesaj trimis cu ID:`, response.data?.messages?.[0]?.id);
  } catch (error) {
    console.error("❌ Eroare la trimitere:", error);
  }
}

// ============================================
// 8. START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`\n🚀 WEBHOOK V2 (STATE MANAGEMENT) ACTIV!`);
  console.log(`📍 Portul: ${PORT}`);
  console.log(`🧠 Memory: ${Object.keys(sessions).length} utilizatori activi\n`);
});
