/**
 * CODE SNIPPETS - SEGMENT 1
 * Copy-paste acestea în server-v3.ts la locurile specificate
 */

// ============================================
// SNIPPET #1: IMPORTS (top of file)
// ============================================
// REPLACE aceste linii (din server-v3.ts la început):
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";
import { z } from "zod";
import OpenAI from "openai";
import * as fs from "fs";
import { ClientConfig } from "./types/ClientConfig";  // ← ADĂUGAT
import { getClientConfig, DEFAULT_CLIENT } from "./config/clients";  // ← ADĂUGAT

dotenv.config();

// ============================================
// SNIPPET #2: UserSession Interface Update
// ============================================
// REPLACE interfața UserSession. Adaugă clientId:

interface UserSession {
  phone: string;
  clientId?: string;  // ← ADĂUGAT: Client ID (ex: "logistics_nl_001")

  // INFORMAȚII PERSONALE
  nume?: string;

  // EDUCAȚIE
  school?: string;
  schoolProfile?: string;

  // ... rest of properties (unchanged)
}

// ============================================
// SNIPPET #3: getSystemPrompt() Function
// ============================================
// ADAUGĂ această funcție DUPĂ extractCandidate() și ÎNAINTE de gasesteJobDinGoogle()

function getSystemPrompt(client: ClientConfig): string {
  const languageConfig = {
    nl: {
      greeting: "Hallo! Ik ben een AI-recruiter",
      education: "Wat voor opleiding heb je afgerond?",
      experience: "Waar heb je gewerkt?",
      skills: "Welke gereedschappen of software heb je gebruikt?",
      language: "Welke taal prefereer je voor instructies?",
    },
    ro: {
      greeting: "👋 Salut! Sunt recruiter AI",
      education: "Ce studii ai terminat?",
      experience: "Unde ai lucrat?",
      skills: "Ce utilaje sau software ai folosit?",
      language: "Ce limbă preferă pentru instrucțiuni?",
    },
    en: {
      greeting: "Hello! I'm an AI recruiter",
      education: "What education have you completed?",
      experience: "Where have you worked?",
      skills: "What tools or software have you used?",
      language: "What language do you prefer?",
    },
    de: {
      greeting: "Hallo! Ich bin ein KI-Recruiter",
      education: "Welche Ausbildung hast du abgeschlossen?",
      experience: "Wo hast du gearbeitet?",
      skills: "Welche Werkzeuge oder Software hast du verwendet?",
      language: "Welche Sprache bevorzugst du?",
    },
  };

  const lang = languageConfig[client.systemLanguage] || languageConfig.en;

  return `Tu ești un recruiter expert, prietenos și profesional pentru joburi în ${client.agencyName}.

📋 SCOPUL TĂU: Colectează COMPLET profilul candidatului (Educație → Experiență → Hard Skills → Limbă) printr-o CONVERSAȚIE NATURALĂ.

🎯 REGULI CRITICE (2026 Standards):

1️⃣ **NU PUNE ÎNTREBĂRI CARE ȘTII DEJA**
   - Verifică contextul conversației și evită redundanța

2️⃣ **GRUPEAZĂ ÎNTREBĂRI** (Nu interogator)
   - Pune multiple întrebări la o dată

3️⃣ **EXTRAGE IMPLICIT din mesaje**
   - Citește între rânduri, extrage skills din context

4️⃣ **FAZE DINAMICE** (sari peste dacă ai info):
   - Faza 1: EDUCAȚIE
   - Faza 2: EXPERIENȚĂ
   - Faza 3: HARD SKILLS
   - Faza 4: LIMBĂ

5️⃣ **LĂSAȚI IMPRESII** (ai_notes)
   - Pe măsură ce cunoști omul, formează o impresie

6️⃣ **TON PROFESIONAL dar PRIETENOS**
   - Natural, conversațional, nu bureaucratic

🌍 LIMBA: ${client.systemLanguage.toUpperCase()}
📍 AGENȚIA: ${client.agencyName}
🗺️ ȚARA: ${client.country}`;
}

// ============================================
// SNIPPET #4: extractCandidate() - NEW SIGNATURE
// ============================================
// REPLACE semnătura funcției extractCandidate (linia ~256):

async function extractCandidate(
  mesaj: string,
  existingData?: UserSession,
  clientConfig: ClientConfig = DEFAULT_CLIENT  // ← ADĂUGAT
) {
  try {
    let context = "";
    if (existingData) {
      const dataPoints = [];
      if (existingData.nume) dataPoints.push(`Nume: ${existingData.nume}`);
      if (existingData.school) dataPoints.push(`Studii: ${existingData.school}`);
      if (existingData.experience?.length) {
        dataPoints.push(
          `Experiență: ${existingData.experience
            .map((e) => `${e.role} la ${e.company}`)
            .join(", ")}`
        );
      }
      if (existingData.hardSkills?.length)
        dataPoints.push(`Skills: ${existingData.hardSkills.join(", ")}`);

      context =
        dataPoints.length > 0
          ? `CONTEXT (ce știu deja):\n${dataPoints.join(
              "\n"
            )}\n\nAcum extrage și COMPLETEAZĂ cu noile informații din mesaj.`
          : "";
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `${getSystemPrompt(clientConfig)}  // ← SCHIMBAT: Dynamic prompt

${context}

INSTRUCȚIUNI PARSE:
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
// SNIPPET #5: handleUserMessage() - NEW SIGNATURE
// ============================================
// REPLACE semnătura (linia ~380):

async function handleUserMessage(
  from: string,
  msgText: string,
  clientConfig: ClientConfig = DEFAULT_CLIENT  // ← ADĂUGAT
): Promise<string> {
  // ... rest of function body (unchanged, but use clientConfig in apeluri)
}

// ============================================
// SNIPPET #6: Webhook POST Handler - REPLACE COMPLET
// ============================================
// REPLACE complet funcția app.post("/webhook") (linia ~568):

app.post("/webhook", async (req, res) => {
  const body = req.body;
  res.sendStatus(200);

  if (body.object === "whatsapp_business_account") {
    try {
      const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;
      const metadata = body.entry?.[0]?.changes?.[0]?.value?.metadata;  // ← ADĂUGAT

      if (messages && messages.length > 0) {
        const message = messages[0];
        const from = message.from;
        const msgText = message.text.body;

        // ✅ EXTRACT "TO" NUMBER - CLIENTUL CARE PRIMEȘTE
        const toNumber = message.to || metadata?.display_phone_number;  // ← ADĂUGAT

        // ✅ LOOKUP CLIENT CONFIG
        const clientConfig = getClientConfig(toNumber);  // ← ADĂUGAT

        console.log(`\n📱 MESSAGE RECEIVED`);
        console.log(`   From: ${from}`);
        console.log(`   To: ${toNumber}`);
        console.log(
          `   Client: ${clientConfig.agencyName} (${clientConfig.clientId})`
        );
        console.log(`   Language: ${clientConfig.systemLanguage}\n`);

        const reply = await handleUserMessage(from, msgText, clientConfig);  // ← MODIFIED

        console.log(`\n📤 REPLY: ${reply}\n`);
        await trimiteMesajWhatsApp(from, reply, clientConfig);  // ← MODIFIED
      }
    } catch (error) {
      console.error("❌ Eroare:", error);
    }
  }
});

// ============================================
// SNIPPET #7: gasesteJobDinGoogle() - NEW SIGNATURE
// ============================================
// REPLACE semnătura funcției (linia ~332):

async function gasesteJobDinGoogle(
  candidat: UserSession,
  clientConfig: ClientConfig = DEFAULT_CLIENT  // ← ADĂUGAT
): Promise<{ raspuns: string; job?: any }> {
  try {
    console.log(`🔍 Căut joburi pentru ${candidat.nume}...`);

    // ✅ USE DYNAMIC GOOGLE SHEET ID
    const csvUrl = `https://docs.google.com/spreadsheets/d/e/${clientConfig.googleSheetId}/pub?output=csv`;  // ← SCHIMBAT
    const response = await axios.get(csvUrl);

    const joburi = parse(response.data, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      cast: true,
    });

    // ... rest of function (unchanged logic, just pass clientConfig to trimiteNotificareMatch)
  }
}

// ============================================
// SNIPPET #8: trimiteNotificareMatch() - NEW SIGNATURE
// ============================================
// REPLACE semnătura funcției (linia ~178):

async function trimiteNotificareMatch(
  candidat: UserSession,
  job: any,
  clientConfig: ClientConfig = DEFAULT_CLIENT  // ← ADĂUGAT
) {
  try {
    // ... HTML constructions (unchanged)

    const response = await axios.post("https://api.resend.com/emails", {
      from: process.env.RESEND_FROM_EMAIL,
      to: clientConfig.notificationEmail,  // ← SCHIMBAT: Use client-specific email
      subject: `🎯 MATCH GĂSIT: ${candidat.nume} - ${job.Titlu}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2ecc71;">🎉 Nou Match de Recrutare - ${clientConfig.agencyName}</h2>
          <!-- ... rest of HTML (unchanged) -->
        </div>
      `,
    }, {
      headers: {
        "Authorization": \`Bearer \${process.env.RESEND_API_KEY}\`,
        "Content-Type": "application/json",
      },
    });

    console.log(
      \`✅ Email trimis pentru match: \${candidat.nume} - \${job.Titlu}\`
    );
    return response.data;
  } catch (error) {
    console.error("❌ Eroare la trimiterea email:", error);
  }
}

// ============================================
// SNIPPET #9: trimiteMesajWhatsApp() - NEW SIGNATURE
// ============================================
// REPLACE semnătura funcției (linia ~596):

async function trimiteMesajWhatsApp(
  to: string,
  text: string,
  clientConfig: ClientConfig = DEFAULT_CLIENT  // ← ADĂUGAT
): Promise<void> {
  try {
    const response = await axios.post(
      \`https://graph.facebook.com/v17.0/\${process.env.PHONE_NUMBER_ID}/messages\`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: text },
      },
      {
        headers: {
          Authorization: \`Bearer \${process.env.WHATSAPP_TOKEN}\`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(\`✅ Mesaj WhatsApp trimis pe \${clientConfig.agencyName}\`);
  } catch (error) {
    console.error("❌ Eroare la WhatsApp:", error);
  }
}

// ============================================
// SNIPPET #10: Update apeluri în handleUserMessage()
// ============================================
// ÎN INTERIORUL FUNCȚIEI handleUserMessage(), REPLACE FIECARE:
//   const extracted = await extractCandidate(msgText, user);
// CU:
//   const extracted = await extractCandidate(msgText, user, clientConfig);

// EXEMPLE:
// Linia ~415 (EDUCATION):
const extracted = await extractCandidate(msgText, user, clientConfig);  // ← ADD clientConfig

// Linia ~439 (EXPERIENCE):
const extracted = await extractCandidate(msgText, user, clientConfig);  // ← ADD clientConfig

// Linia ~478 (SKILLS):
const extracted = await extractCandidate(msgText, user, clientConfig);  // ← ADD clientConfig

// Linia ~495 (LANGUAGE):
const extracted = await extractCandidate(msgText, user, clientConfig);  // ← ADD clientConfig

// ============================================
// SNIPPET #11: Update apel în handleUserMessage()
// ============================================
// REPLACE (linia ~515 în LANGUAGE phase):
//   const result = await gasesteJobDinGoogle(user);
// CU:
const result = await gasesteJobDinGoogle(user, clientConfig);  // ← ADD clientConfig

// ============================================
// SNIPPET #12: Update apel în gasesteJobDinGoogle()
// ============================================
// REPLACE (în gasesteJobDinGoogle(), cand gaseste match):
//   await trimiteNotificareMatch(candidat, match);
// CU:
await trimiteNotificareMatch(candidat, match, clientConfig);  // ← ADD clientConfig
