import dotenv from "dotenv";
import { z } from "zod";
import OpenAI from "openai";
import axios from "axios";
import { parse } from "csv-parse/sync";

dotenv.config();

// 1. Aceasta este "Matrița" (Schema)
const CandidateSchema = z.object({
  nume: z.string().optional(),
  hasVCA: z.boolean().describe("Are diploma VCA?"),
  hasBSN: z.boolean().describe("Are certificat BSN?"),
  permis: z.boolean().describe("Are permis de conducere?"),
  limbi: z.array(z.string()).describe("Ce limbi străine cunoaște?")
});

// 2. Definim ce înseamnă un Job în agenția noastră
interface Job {
  id: number;
  titlu: string;
  oras: string;
  salariu: number;
  necesitaVCA: boolean;
  necesitaBSN: boolean;
}

// 3. LINK-UL TĂU REAL LA GOOGLE SHEETS:
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSO-y2ueZ1ocKYEpTrLH6sAWVDEW0y42JQV8nSp2e77s5zb0XSOnq4MgOxBZxhysXKL-JEOas5bAbq3/pub?output=csv";

// 4. LOGICA AGENTULUI 3 (Matcher-ul cu Google Sheets)
async function gasesteJobDinGoogle(candidat: any): Promise<string> {
  try {
    console.log(`\n--- Agentul 3 accesează Google Sheets pentru ${candidat.nume} ---`);

    // 1. Descarcă datele din Google Sheets
    const response = await axios.get(GOOGLE_SHEET_CSV_URL);

    // 2. Transformă CSV în listă de obiecte
    const joburi = parse(response.data, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      cast: true // Transformă automat "TRUE"/"FALSE" din tabel în booleeni reali
    });

    console.log(`📊 Am găsit ${joburi.length} joburi active în tabel.`);

    // 3. LOGICA DE MATCHING (Legea noastră)
    const match = joburi.find((job: any) => {
      // Convertim coloanele din Google Sheet la booleeni
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
      return `Salut ${candidat.nume}, momentan niciun job din tabel nu se potrivește cu profilul tău (VCA:${candidat.hasVCA}, BSN:${candidat.hasBSN}).`;
    }

  } catch (error) {
    console.error("❌ Eroare la citirea tabelului:", error);
    return "Eroare tehnică la baza de date.";
  }
}

// 2. Inițializează OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 3. Funcția care extrage datele
async function extractCandidate(mesaj: string) {
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
  return CandidateSchema.parse(extracted); // Validează cu schema
}

// 5. TEST COMPLET: Extrage datele + Găsește job din Google Sheets
async function main() {
  const mesaj = "Sunt Mihai, am permis cat B, nu am VCA dar am BSN. Vorbesc engleză.";

  console.log("📝 Mesaj original:", mesaj);
  console.log("\n⏳ Se extrage cu OpenAI...\n");

  const rezultat = await extractCandidate(mesaj);

  console.log("✅ Rezultatul (JSON structurat):");
  console.log(JSON.stringify(rezultat, null, 2));

  // TESTĂM LOGICA:
  const rezultatMatcher = await gasesteJobDinGoogle(rezultat);
  console.log("\n📢 Răspuns final pentru WhatsApp:");
  console.log(rezultatMatcher);
}

main().catch(console.error);
