# SEGMENT 1: Multi-Tenant Architecture
## Modificări necesare în `server-v3.ts`

---

## 📋 CEEA CE SE SCHIMBĂ

### ✅ FIȘIERE NOI (deja create):
- ✅ `types/ClientConfig.ts` - Interface
- ✅ `config/clients.ts` - Mock data + getClientConfig()

### ✅ FIȘIER DE MODIFICAT:
- ⚠️ `server-v3.ts` - 5 locuri de modificat

---

## 🔧 MODIFICĂRI ÎN `server-v3.ts`

### MODIFICARE #1: IMPORTS (top of file)

**ORIGINAL:**
```typescript
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";
import { z } from "zod";
import OpenAI from "openai";
import * as fs from "fs";

dotenv.config();
```

**MODIFICAT (adaugă aceste linii după imports):**
```typescript
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";
import { z } from "zod";
import OpenAI from "openai";
import * as fs from "fs";
import { ClientConfig } from "./types/ClientConfig";
import { getClientConfig, DEFAULT_CLIENT } from "./config/clients";

dotenv.config();
```

✅ **ADĂUGATE:** 2 linii de import

---

### MODIFICARE #2: UserSession Interface (adaugă proprietate)

**ORIGINAL (linia ~21):**
```typescript
interface UserSession {
  phone: string;
  // ... alte proprietăți
}
```

**MODIFICAT (adaugă la început):**
```typescript
interface UserSession {
  phone: string;
  clientId?: string;  // ← ADĂUGAT: ClientID din care face parte
  // ... alte proprietăți
}
```

✅ **ADĂUGATĂ:** 1 linie (clientId)

---

### MODIFICARE #3: Funcția `extractCandidate` (semnătură)

**ORIGINAL (linia ~256):**
```typescript
async function extractCandidate(mesaj: string, existingData?: UserSession) {
  try {
    // ... cod
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `${SYSTEM_PROMPT}
          ...
```

**MODIFICAT:**
```typescript
async function extractCandidate(
  mesaj: string,
  existingData?: UserSession,
  clientConfig: ClientConfig = DEFAULT_CLIENT  // ← ADĂUGAT
) {
  try {
    // ... cod
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `${getSystemPrompt(clientConfig)}
          ...
```

✅ **MODIFICĂRI:**
- Parameter 3: `clientConfig`
- Call SYSTEM_PROMPT → `getSystemPrompt(clientConfig)` (funcție nouă mai jos)

---

### MODIFICARE #4: Adaugă funcție `getSystemPrompt()` (DINAMICĂ pe limbă)

**ADAUGĂ DUPĂ funcția `extractCandidate`, înainte de `gasesteJobDinGoogle`:**

```typescript
// ============================================
// DYNAMIC SYSTEM PROMPT PER CLIENT
// ============================================

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

  return `Tu ești un recruiter expert pentru ${client.agencyName}.

📋 SCOPUL TĂU: Colectează COMPLET profilul candidatului (Educație → Experiență → Hard Skills → Limbă) printr-o CONVERSAȚIE NATURALĂ.

LIMBA PROMPTULUI: ${client.systemLanguage.toUpperCase()}
AGENȚIA: ${client.agencyName}
ȚARA: ${client.country}

🎯 REGULI CRITICE:

1️⃣ NU PUNE ÎNTREBĂRI CARE ȘTII DEJA
2️⃣ GRUPEAZĂ ÎNTREBĂRI (nu interogator)
3️⃣ EXTRAGE IMPLICIT din mesaje
4️⃣ FAZE DINAMICE (sari peste dacă ai info)
5️⃣ LĂSAȚI IMPRESII (ai_notes)
6️⃣ TON PROFESIONAL dar PRIETENOS

🌍 LIMBĂ DE RĂSPUNS: ${client.systemLanguage}
- ${lang.greeting}
- ${lang.education}
- ${lang.experience}
- ${lang.skills}
- ${lang.language}`;
}
```

✅ **ADĂUGATĂ:** Funcție nouă care dinamiza promptul pe limbă și agenție

---

### MODIFICARE #5: Webhook POST handler (extrage "To" number)

**ORIGINAL (linia ~568):**
```typescript
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
```

**MODIFICAT:**
```typescript
app.post("/webhook", async (req, res) => {
  const body = req.body;
  res.sendStatus(200);

  if (body.object === "whatsapp_business_account") {
    try {
      const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;
      const metadata = body.entry?.[0]?.changes?.[0]?.value?.metadata;

      if (messages && messages.length > 0) {
        const message = messages[0];
        const from = message.from;
        const msgText = message.text.body;

        // ✅ EXTRACT "TO" NUMBER - din payload
        const toNumber = message.to || metadata?.display_phone_number;

        // ✅ LOOKUP CLIENT CONFIG
        const clientConfig = getClientConfig(toNumber);

        console.log(`\n📱 MESSAGE RECEIVED`);
        console.log(`   From: ${from}`);
        console.log(`   To: ${toNumber}`);
        console.log(`   Client: ${clientConfig.agencyName} (${clientConfig.clientId})`);
        console.log(`   Language: ${clientConfig.systemLanguage}\n`);

        const reply = await handleUserMessage(from, msgText, clientConfig);

        console.log(`\n📤 REPLY: ${reply}\n`);
        await trimiteMesajWhatsApp(from, reply, clientConfig);
      }
    } catch (error) {
      console.error("❌ Eroare:", error);
    }
  }
});
```

✅ **MODIFICĂRI:**
- Extract `toNumber` din payload
- Call `getClientConfig(toNumber)`
- Pass `clientConfig` la `handleUserMessage()`
- Pass `clientConfig` la `trimiteMesajWhatsApp()`
- Log client info

---

### MODIFICARE #6: Semnătură funcție `handleUserMessage` (parametru 3)

**ORIGINAL (linia ~380):**
```typescript
async function handleUserMessage(from: string, msgText: string): Promise<string> {
```

**MODIFICAT:**
```typescript
async function handleUserMessage(
  from: string,
  msgText: string,
  clientConfig: ClientConfig = DEFAULT_CLIENT
): Promise<string> {
```

✅ **ADĂUGAT:** Parameter 3 `clientConfig`

---

### MODIFICARE #7: Apeluri `extractCandidate` în `handleUserMessage`

**ORIGINAL - 4 apeluri în `handleUserMessage`:**
```typescript
const extracted = await extractCandidate(msgText, user);
```

**MODIFICAT - TOATE 4:**
```typescript
const extracted = await extractCandidate(msgText, user, clientConfig);
```

🔍 **UNDE:**
- Linia ~415 (EDUCATION phase)
- Linia ~439 (EXPERIENCE phase)
- Linia ~478 (SKILLS phase)
- Linia ~495 (LANGUAGE phase)

---

### MODIFICARE #8: Semnătură `gasesteJobDinGoogle` (parametru 2)

**ORIGINAL (linia ~332):**
```typescript
async function gasesteJobDinGoogle(candidat: UserSession): Promise<{ raspuns: string, job?: any }> {
```

**MODIFICAT:**
```typescript
async function gasesteJobDinGoogle(
  candidat: UserSession,
  clientConfig: ClientConfig = DEFAULT_CLIENT
): Promise<{ raspuns: string, job?: any }> {
```

✅ **ADĂUGAT:** Parameter 2 `clientConfig`

**ȘI FOLOSEȘTE `clientConfig.googleSheetId` în loc de HARDCODED `GOOGLE_SHEET_CSV_URL`:**

```typescript
// Construiește URL dinamic
const csvUrl = `https://docs.google.com/spreadsheets/d/e/${clientConfig.googleSheetId}/pub?output=csv`;
const response = await axios.get(csvUrl);
```

---

### MODIFICARE #9: Apel `gasesteJobDinGoogle` în `handleUserMessage`

**ORIGINAL (linia ~515):**
```typescript
const result = await gasesteJobDinGoogle(user);
```

**MODIFICAT:**
```typescript
const result = await gasesteJobDinGoogle(user, clientConfig);
```

---

### MODIFICARE #10: Semnătură `trimiteNotificareMatch` (parametru 3)

**ORIGINAL (linia ~178):**
```typescript
async function trimiteNotificareMatch(candidat: UserSession, job: any) {
```

**MODIFICAT:**
```typescript
async function trimiteNotificareMatch(
  candidat: UserSession,
  job: any,
  clientConfig: ClientConfig = DEFAULT_CLIENT
) {
```

**ȘI FOLOSEȘTE `clientConfig.notificationEmail` în loc de env var:**

```typescript
const response = await axios.post("https://api.resend.com/emails", {
  from: process.env.RESEND_FROM_EMAIL,
  to: clientConfig.notificationEmail,  // ← SCHIMBAT
  subject: `🎯 MATCH GĂSIT: ${candidat.nume} - ${job.Titlu}`,
  // ... rest
```

---

### MODIFICARE #11: Apel `trimiteNotificareMatch` în `gasesteJobDinGoogle`

**ORIGINAL (linia ~???):**
```typescript
await trimiteNotificareMatch(candidat, match);
```

**MODIFICAT:**
```typescript
await trimiteNotificareMatch(candidat, match, clientConfig);
```

---

### MODIFICARE #12: Semnătură `trimiteMesajWhatsApp` (parametru 3)

**ORIGINAL (linia ~596):**
```typescript
async function trimiteMesajWhatsApp(to: string, text: string): Promise<void> {
```

**MODIFICAT:**
```typescript
async function trimiteMesajWhatsApp(
  to: string,
  text: string,
  clientConfig: ClientConfig = DEFAULT_CLIENT
): Promise<void> {
```

✅ **ADĂUGAT:** Parameter 3 `clientConfig`

---

## 📊 REZUMAT MODIFICĂRI

| Nr | Tip | Locație | Change |
|----|-----|---------|--------|
| 1 | Import | Top | +2 linii: ClientConfig, getClientConfig |
| 2 | Interface | UserSession | +1 linie: clientId? |
| 3 | Funcție | extractCandidate() | +1 param: clientConfig |
| 4 | Funcție | NEW | getSystemPrompt() - 50 linii |
| 5 | Webhook | POST /webhook | +5 linii: extract "To" + lookup |
| 6 | Funcție | handleUserMessage() | +1 param |
| 7 | Apeluri | 4 × extractCandidate() | +param |
| 8 | Funcție | gasesteJobDinGoogle() | +1 param |
| 9 | Apel | gasesteJobDinGoogle() | +param |
| 10 | Funcție | trimiteNotificareMatch() | +1 param |
| 11 | Apel | trimiteNotificareMatch() | +param |
| 12 | Funcție | trimiteMesajWhatsApp() | +1 param |

---

## 🎯 CUM VA ȘTI SISTEMUL PENTRU CARE CLIENT RULEAZĂ?

### Fluxul:

```
1️⃣ WhatsApp Message arrives
   📥 POST /webhook { entry[0].changes[0].value.messages[0] }

2️⃣ Extract numbers
   • from = "+1234567890"  (candidat)
   • to = "+31612345678"   (business WhatsApp)

3️⃣ Lookup client
   ✅ getClientConfig("+31612345678")
   → "Logistics Staffing NL" (logistics_nl_001)

4️⃣ Load configuration
   • googleSheetId = "2PACX-1vR3..." (LOGISTICS jobs)
   • systemLanguage = "nl"
   • notificationEmail = "hr-logistics@logistics-nl.com"

5️⃣ Dynamic system prompt
   ✅ getSystemPrompt(clientConfig)
   → "Tu ești recruiter pentru Logistics Staffing NL în Olanda..."

6️⃣ AI extraction
   • GPT-4o mini używa localized prompt
   • Extrage datele + respinge non-relevant info

7️⃣ Job matching
   • Citește Google Sheet din clientConfig.googleSheetId
   • Compară cu joburile PENTRU ACEL CLIENT

8️⃣ Email notification
   • Trimite pe clientConfig.notificationEmail
   • Subiect: "🎯 MATCH GĂSIT: [Candidat] - [Job]"

9️⃣ WhatsApp response
   • Răspunde în limba clientului (systemLanguage)
```

---

## ✅ VERIFICARE

După modificări, sistemul va:
- ✅ Detecta automatic pentru care agenție primește mesajul
- ✅ Incarca config-ul specific clientului
- ✅ Adapta promptul AI la limbă și agenție
- ✅ Cautare joburi din Google Sheet specific al clientului
- ✅ Trimite notificări pe email-ul specific al clientului

---

## 🚀 TESTING

### Test Client 1 (Logistics NL):
```
To: +31612345678
Expected: "Logistics Staffing NL" + "nl" language + logistics jobs
```

### Test Client 2 (Health RO):
```
To: +40712345678
Expected: "Health Staffing Romania" + "ro" language + health jobs
```

### Test Fallback (Unknown):
```
To: +99999999999
Expected: DEFAULT_CLIENT + "ro" language + default jobs
```

---

**GATA! Sistemul e multi-tenant ready!** 🎉
