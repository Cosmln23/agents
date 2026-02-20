import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";
import { z } from "zod";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// ============================================
// 1. SCHEMA & FUNCȚII DE LA INDEX.TS
// ============================================

const CandidateSchema = z.object({
  nume: z.string().optional(),
  hasVCA: z.boolean().describe("Are diploma VCA?"),
  hasBSN: z.boolean().describe("Are certificat BSN?"),
  permis: z.boolean().describe("Are permis de conducere?"),
  limbi: z.array(z.string()).describe("Ce limbi străine cunoaște?")
});

const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSO-y2ueZ1ocKYEpTrLH6sAWVDEW0y42JQV8nSp2e77s5zb0XSOnq4MgOxBZxhysXKL-JEOas5bAbq3/pub?output=csv";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================================
// 2. AGENTUL 2: EXTRACTOR
// ============================================
async function extractCandidate(mesaj: string) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Citește următorul text și extrage informațiile despre candidat. Returnează DOAR obiectul JSON, fără alte texte:

"${mesaj}"

Structura trebuie să fie EXACT:
{
  "nume": string sau null,
  "hasVCA": boolean,
  "hasBSN": boolean,
  "permis": boolean,
  "limbi": array de stringuri
}`
        }
      ],
      temperature: 0,
    });

    const content = response.choices[0].message.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("Nu s-a putut extrage JSON din răspuns");
    }

    const extracted = JSON.parse(jsonMatch[0]);
    return CandidateSchema.parse(extracted);
  } catch (error) {
    console.error("Eroare la extragere:", error);
    throw error;
  }
}

// ============================================
// 3. AGENTUL 3: MATCHER
// ============================================
async function gasesteJobDinGoogle(candidat: any): Promise<string> {
  try {
    console.log(`🔍 Căut joburi pentru ${candidat.nume}...`);

    const response = await axios.get(GOOGLE_SHEET_CSV_URL);

    const joburi = parse(response.data, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      cast: true
    });

    console.log(`📊 Am găsit ${joburi.length} joburi active`);

    const match = joburi.find((job: any) => {
      const necesitaVCA = job["Necesită VCA"] === "TRUE";
      const necesitaBSN = job["Necesită BSN"] === "TRUE";

      const vcaOk = necesitaVCA ? candidat.hasVCA : true;
      const bsnOk = necesitaBSN ? candidat.hasBSN : true;
      return vcaOk && bsnOk;
    });

    if (match) {
      const m = match as any;
      return `🚀 MATCH GĂSIT! Salut ${candidat.nume}, am un post de ${m.Titlu} în ${m["Oraș"]} la ${m["Salariu (€/oră)"]}€/oră. Te interesează?`;
    } else {
      return `Salut ${candidat.nume}, momentan niciun job nu se potrivește cu profilul tău, dar o să te sun!`;
    }

  } catch (error) {
    console.error("❌ Eroare la matching:", error);
    return "Scuze, ceva nu merge. Incearcă din nou!";
  }
}

// ============================================
// 4. WEBHOOK - PRIMIRE MESAJ
// ============================================

// GET: Verificarea Webhook-ului pentru Meta
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log(`\n✓ Meta verifică webhook-ul...`);
  console.log(`  Mode: ${mode}`);
  console.log(`  Token: ${token}`);

  if (mode && token === process.env.VERIFY_TOKEN) {
    console.log(`✅ Webhook verificat cu succes!\n`);
    res.status(200).send(challenge);
  } else {
    console.log(`❌ Token incorect!\n`);
    res.sendStatus(403);
  }
});

// POST: Primirea și procesarea mesajelor
app.post("/webhook", async (req, res) => {
  const body = req.body;

  // Confirma imediat Meta că am primit mesajul
  res.sendStatus(200);

  if (body.object === "whatsapp_business_account") {
    try {
      const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;

      if (messages && messages.length > 0) {
        const message = messages[0];
        const from = message.from;           // Telefonul omului
        const msgText = message.text.body;   // Ce a scris

        console.log(`\n📱 MESAJ PRIMIT`);
        console.log(`  De la: +${from}`);
        console.log(`  Text: "${msgText}"\n`);

        // ============================================
        // FLUXUL COMPLET: Extract -> Match -> Reply
        // ============================================

        console.log(`🤖 Agentul 2: Se extrage datele...`);
        const candidatDate = await extractCandidate(msgText);
        console.log(`✅ Extragere gata:`, JSON.stringify(candidatDate, null, 2));

        console.log(`\n💼 Agentul 3: Se cauta jobul...`);
        const raspunsulMatcher = await gasesteJobDinGoogle(candidatDate);

        console.log(`\n📤 Se trimite răspunsul pe WhatsApp...\n`);
        await trimiteMesajWhatsApp(from, raspunsulMatcher);

        console.log(`✅ Răspuns trimis cu succes!\n`);
      }
    } catch (error) {
      console.error("❌ Eroare la procesare:", error);
      // Trimite mesaj de eroare pe WhatsApp
      const from = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
      if (from) {
        await trimiteMesajWhatsApp(from, "Scuze, ceva nu merge. Incearcă din nou mai târziu!");
      }
    }
  }
});

// ============================================
// 5. FUNCȚIA PENTRU TRIMITERE MESAJ
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

    console.log(`📨 Mesaj trimis cu ID:`, response.data?.messages?.[0]?.id);
  } catch (error) {
    console.error("❌ Eroare la trimiterea mesajului pe WhatsApp:", error);
    throw error;
  }
}

// ============================================
// 6. PORNIRE SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`\n🚀 WEBHOOK ACTIV!`);
  console.log(`📍 Portul: ${PORT}`);
  console.log(`🔗 URL local: http://localhost:${PORT}`);
  console.log(`\n⚠️  Pentru a funcționa, trebuie să faci portul vizibil cu ngrok:`);
  console.log(`   ngrok http ${PORT}\n`);
});

export { extractCandidate, gasesteJobDinGoogle };
