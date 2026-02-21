# UPGRADE LOG - Recrutare AI v4

**Date:** February 21, 2026
**Status:** PRODUCTION READY

---

## CE FACE BOTUL - PE SCURT (pentru oricine)

Când un candidat trimite un **PDF cu CV-ul** pe WhatsApp:

1. **Botul primește mesajul** de la Meta (WhatsApp Business API)
2. **Descarcă PDF-ul** temporar pe server (in folderul /tmp/)
3. **Convertește PDF-ul** într-un format pe care AI-ul îl poate citi (base64)
4. **Trimite PDF-ul la GPT-4o** (inteligența artificială de la OpenAI) care **citește CV-ul** și extrage:
   - Ce studii are candidatul
   - Unde a lucrat și ce funcții a avut
   - Ce abilități tehnice are (software, unelte, certificări)
   - Ce limbi vorbește și la ce nivel
5. **Verifică datele** - dacă AI-ul a inventat ceva (halucinare), le marchează ca suspecte
6. **Șterge PDF-ul** de pe server imediat (conform GDPR - protecția datelor)
7. **Trimite confirmare** candidatului pe WhatsApp: "Am citit CV-ul tău!"

**Totul se întâmplă într-un singur pas, fără intermediari.**
Înainte erau 2 apeluri API separate (upload + citire) - acum e doar 1.

---

## CE ÎNSEAMNĂ FIȘIERELE DIN PROIECT

| Fișier | Ce face |
|--------|---------|
| `app.ts` | Serverul principal - primește mesajele de pe WhatsApp, le procesează, trimite răspunsuri |
| `document-processor.ts` | Procesează CV-urile - descarcă, convertește, trimite la AI, validează, șterge |
| `types/OpenAIExtended.ts` | Conectarea cu OpenAI (GPT-4o) - trimite cereri, primește răspunsuri |
| `types/UserSession.ts` | Structura datelor pentru fiecare candidat (ce știm despre el) |
| `types/ClientConfig.ts` | Configurația pentru fiecare client/firmă care folosește botul |
| `config/clients.ts` | Lista firmelor care folosesc botul (multi-tenant) |
| `data-extractor.ts` | Extrage date din mesajele text (nu din documente) |
| `prompt-generator.ts` | Generează întrebările pe care botul le pune candidaților |
| `job-matcher.ts` | Potrivește candidații cu job-urile disponibile |
| `schemas/zod-schemas.ts` | Reguli de validare a datelor (Zod = librărie de validare) |

---

## DETALII TEHNICE (pentru programatori)

---

## FASE 1 - OpenAI SDK Refactor (Feb 20, 2026)

### 1.1 types/OpenAIExtended.ts - Beta API Removal
**Problem:** `.beta.chat.completions.parse()` undefined in SDK 6.22.0
**Solution:** Standard API + JSON regex parsing

```typescript
// BEFORE (broken):
const beta = (this.client as any).beta;
const apiCall = beta.chat.completions.parse(options);

// AFTER (working):
const apiCall = this.client.chat.completions.create({
  model: options.model,
  messages: options.messages,
  temperature: options.temperature ?? 0,
  max_tokens: options.max_tokens,
});
const content = response.choices?.[0]?.message?.content || "";
const jsonMatch = content.match(/\{[\s\S]*\}/);
return JSON.parse(jsonMatch[0]) as T;
```

### 1.2 types/OpenAIExtended.ts - Constructor Fallback
**Problem:** API key undefined at runtime

```typescript
constructor(apiKey?: string) {
  this.client = new OpenAI({
    apiKey: apiKey || process.env.OPENAI_API_KEY,
    defaultHeaders: { "User-Agent": "openai-node/6.0.0" }
  });
}
```

### 1.3 document-processor.ts - Meta Download Auth
**Problem:** HTTP 401 downloading PDF from Meta (no Bearer token)

```typescript
// Line 415-421: Headers with Bearer token
const headers: Record<string, string> = {
  'User-Agent': 'axios/1.7.2'
};
if (whatsappToken) {
  headers['Authorization'] = `Bearer ${whatsappToken}`;
}
https.get(url, { headers }, (response) => { ... })
```

### 1.4 app.ts - Webhook Signature Raw Buffer
**Problem:** JSON.stringify not byte-exact with Meta's transmission

```typescript
// Line 81-84: Capture raw buffer
app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));
```

---

## FASE 2 - PDF Inline Base64 + Zod Hardening (Feb 21, 2026)

### 2.1 DELETED: uploadPdfToFilesAPI()
**What was removed:** Entire function that uploaded PDF to OpenAI Files API
**Why:** Chat Completions API accepts PDF inline as base64 - no upload step needed
**Impact:** Eliminated 400 Bad Request errors, reduced to 1 API call instead of 2

### 2.2 buildVisionMessageContent() - PDF Inline Format
**File:** `document-processor.ts` lines 783-818
**What it does:** Builds the message content array for OpenAI Chat Completions

**Two deterministic flows (NO mixing):**

```typescript
// LINE 783: Function signature (simplified - no more isFileId param)
function buildVisionMessageContent(base64Data: string, mimeType: string): any {

  // LINE 784-799: IMAGE FLOW
  if (mimeType.startsWith("image/")) {
    return [
      { type: "text", text: "Extract the data from this CV/resume..." },
      {
        type: "image_url",
        image_url: {
          url: `data:${imageMediaType};base64,${base64Data}`,
          detail: "high",
        },
      },
    ];
  }

  // LINE 800-815: PDF FLOW (inline base64 - Chat Completions 2026 format)
  else if (mimeType === "application/pdf") {
    return [
      { type: "text", text: "Extract the data from this CV/resume..." },
      {
        type: "file",
        file: {
          filename: "cv.pdf",
          file_data: `data:application/pdf;base64,${base64Data}`,
        },
      },
    ];
  }
}
```

**CRITICAL FORMAT:**
```json
{
  "type": "file",
  "file": {
    "filename": "cv.pdf",
    "file_data": "data:application/pdf;base64,JVBER..."
  }
}
```

### 2.3 extractDataFromDocument() - Simplified Call
**File:** `document-processor.ts` lines 523-602
**What changed:** Removed pdfPath parameter, sends base64Data directly

```typescript
// LINE 523-528: Function signature (clean - no pdfPath needed)
async function extractDataFromDocument(
  base64Data: string,
  mimeType: string,
  session: UserSession,
  clientConfig: ClientConfig,
): Promise<CVExtractionResult | null> {

  // LINE 530: Create OpenAI client
  const openai = new OpenAIExtended(process.env.OPENAI_API_KEY);

  // LINE 533: Build anti-hallucination prompt
  const systemPrompt = buildVisionPrivacyPrompt(clientConfig, session);

  // LINE 539-542: PDF uses same base64Data as images - just different format
  if (isPdf) {
    messageContent = buildVisionMessageContent(base64Data, mimeType);
  } else {
    messageContent = buildVisionMessageContent(base64Data, mimeType);
  }

  // LINE 550-572: Single API call to gpt-4o
  const response = await openai.parseStructured<CVExtractionResult>({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: messageContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "CVExtraction", schema: CVExtractionSchema, strict: true },
    },
    temperature: 0,
    max_tokens: 1000,
  });

  // LINE 600: Zod validation with auto-normalization
  const validated = CVExtractionSchema.parse(extracted) as CVExtractionResult;
}
```

### 2.4 processCandidateDocument() - Main Orchestrator
**File:** `document-processor.ts` lines 284-372
**What it does:** Downloads PDF, converts to base64, calls extraction, GDPR cleanup

```typescript
// LINE 284-289: Entry point
async function processCandidateDocument(
  mediaUrl: string, mimeType: string,
  session: UserSession, clientConfig: ClientConfig
): Promise<CVExtractionResult | null> {

  // LINE 294: Validate MIME type (pdf, jpeg, png)
  if (!SUPPORTED_MIME_TYPES.includes(mimeType)) { return null; }

  // LINE 308-310: Generate temp path
  const fileName = `cv_${session.phone.replace(/\D/g, "")}_${Date.now()}${fileExtension}`;
  tempFilePath = path.join("/tmp", fileName);

  // LINE 314-319: Download with Bearer token auth
  await downloadFileWithSizeLimit(mediaUrl, tempFilePath, MAX_FILE_SIZE_BYTES,
    process.env.WHATSAPP_TOKEN);

  // LINE 332-333: Convert to Base64
  const fileBuffer = fs.readFileSync(tempFilePath);
  const base64Data = fileBuffer.toString("base64");

  // LINE 341-346: Extract data (single API call)
  const extraction = await extractDataFromDocument(
    base64Data, mimeType, session, clientConfig
  );

  // LINE 372-381: GDPR cleanup (finally block - ALWAYS runs)
  if (tempFilePath && fs.existsSync(tempFilePath)) {
    fs.unlinkSync(tempFilePath);
  }
}
```

### 2.5 Zod Schema - Preprocess Safety Nets
**File:** `document-processor.ts` lines 118-233
**What changed:** Added `.preprocess()` on fields where GPT-4o returns object/array instead of string

```typescript
// LINE 127-139: experience_summary - converts array/object to string
experience_summary: z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) return value.join(", ");     // GPT returns array sometimes
    if (typeof value === "object") return JSON.stringify(value); // GPT returns object sometimes
    return String(value);
  },
  z.string().nullable().optional()
),

// LINE 147-201: language_level - normalizes descriptors to CEFR
language_level: z.preprocess(
  (value) => {
    // "Fluent"/"Native" → "C2", "Advanced" → "C1", etc.
    // Returns null if unknown (NOT default B1)
  },
  z.string().refine(...)
).catch(null),  // If ALL validation fails → null, not crash

// LINE 216-228: extraction_logic - converts object/array to string
extraction_logic: z.preprocess(
  (value) => {
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) return value.join("; ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  },
  z.string()
),
```

---

## FLOW COMPLET CU LINII DE COD

```
User trimite PDF pe WhatsApp
  |
  v
[app.ts] POST /webhook
  | Line 81-84: Webhook signature validated (raw buffer)
  | Line ~400: Client config detected (multi-tenant routing)
  | Line ~405: GDPR consent checked
  | Line ~406: Media detected → processCandidateDocument()
  |
  v
[document-processor.ts] processCandidateDocument() - LINE 284
  |
  | LINE 294: Validate MIME type ∈ [pdf, jpeg, png, jpg]
  | LINE 308-310: Generate temp path → /tmp/cv_40754564716_1771640265500.pdf
  |
  v
  | LINE 314-319: Download PDF with Bearer token (Meta auth)
  |   downloadFileWithSizeLimit(url, path, 5MB, WHATSAPP_TOKEN)
  |   Headers: { Authorization: "Bearer ...", User-Agent: "axios/1.7.2" }
  |   Result: /tmp/cv_xxx.pdf (50.59KB)
  |
  v
  | LINE 332-333: Convert to Base64
  |   fs.readFileSync(tempFilePath) → .toString("base64")
  |   Result: 67.46KB base64 string
  |
  v
[document-processor.ts] extractDataFromDocument() - LINE 523
  |
  | LINE 530: new OpenAIExtended(OPENAI_API_KEY)
  | LINE 533: buildVisionPrivacyPrompt() → Anti-hallucination guardrails
  |
  v
  | LINE 539-542: buildVisionMessageContent(base64Data, "application/pdf")
  |   Returns:
  |   [
  |     { type: "text", text: "Extract the data..." },
  |     { type: "file", file: {
  |         filename: "cv.pdf",
  |         file_data: "data:application/pdf;base64,JVBER..."
  |     }}
  |   ]
  |
  v
  | LINE 550-572: UN SINGUR REQUEST → gpt-4o Chat Completions
  |   openai.parseStructured<CVExtractionResult>({
  |     model: "gpt-4o",
  |     messages: [system_prompt, user_content_with_pdf],
  |     response_format: { type: "json_schema", ... },
  |     temperature: 0,
  |     max_tokens: 1000,
  |   })
  |
  v
  | LINE 574-597: Log + validate extracted data
  |   education: "MBO Level Technical College Iuliu Maniu"
  |   experience: "Transport Coordinator at Pliti Dispo SRL..."
  |   skills: ["Microsoft Office", "Transport coordination", ...]
  |   confidence: 100%
  |   extraction_logic: "Found education in header section..."
  |
  v
  | LINE 600: Zod validation (auto-normalizes language, converts arrays)
  |   CVExtractionSchema.parse(extracted)
  |
  v
[document-processor.ts] Back in processCandidateDocument()
  |
  | LINE 348-365: Log extraction results
  |
  v
  | LINE 372-381: GDPR CLEANUP (finally block)
  |   fs.unlinkSync(tempFilePath)
  |   "Temp file deleted: /tmp/cv_xxx.pdf"
  |
  v
[app.ts] Back in handleUserMessage()
  | Merge extraction into session
  | Send confirmation: "Am citit CV-ul tau!"
  | Save sessions to /tmp/whatsapp_sessions.json
```

---

## ANTI-HALLUCINATION GUARDRAILS

**File:** `document-processor.ts` lines 618-694 (Romanian prompt)

Key rules in system prompt:
1. Extract ONLY what you PHYSICALLY SEE in the image
2. If field NOT explicitly stated → MUST return null
3. NEVER fill fields with made-up company names/job titles
4. Read text CHARACTER-BY-CHARACTER
5. extraction_logic is REQUIRED - explain WHERE you found each field
6. If you cannot point to specific line/section → field MUST be null
7. requires_human_review = true if data seems suspicious

**Zod safety nets:**
- `experience_summary`: `.preprocess()` converts array/object → string (line 128)
- `language_level`: `.preprocess()` normalizes "Fluent" → "C2" etc. (line 148)
- `extraction_logic`: `.preprocess()` converts object → string (line 217)
- All with `.catch(null)` or `.nullable()` → never crashes on bad data

---

## STABILITY TABLE

| Area | Before | After |
|------|--------|-------|
| **PDF Processing** | Files API upload → 400 Bad Request | Inline base64 → 1 request, works |
| **API Calls** | 2 (upload + chat) | 1 (chat only) |
| **Webhook Auth** | JSON.stringify (inconsistent) | Raw buffer (byte-exact) |
| **PDF Download** | HTTP 401 (no auth) | HTTP 200 (Bearer token) |
| **Vision API** | `.beta` undefined error | Standard API + JSON parsing |
| **Data Extraction** | Hallucinated "Software Developer" | Real "Transport Coordinator" |
| **Zod Validation** | Crashed on array/object | Preprocess converts gracefully |
| **Error Handling** | Silent failures | User-friendly WhatsApp messages |
| **GDPR** | File sometimes left on disk | Always deleted in finally block |

---

## TEMPLATE - How to Send PDF to OpenAI Chat Completions (2026)

```typescript
import OpenAI from "openai";
import * as fs from "fs";

// Step 1: Read file and convert to base64
const fileBuffer = fs.readFileSync("/path/to/cv.pdf");
const base64Data = fileBuffer.toString("base64");

// Step 2: Build message content
const messageContent = [
  {
    type: "text",
    text: "Your instruction prompt here",
  },
  {
    type: "file",
    file: {
      filename: "cv.pdf",
      file_data: `data:application/pdf;base64,${base64Data}`,
    },
  },
];

// Step 3: Single API call
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "System prompt with extraction rules" },
    { role: "user", content: messageContent },
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "ExtractionResult",
      schema: yourZodSchema,
      strict: true,
    },
  },
  temperature: 0,
  max_tokens: 1000,
});

// Step 4: Parse response
const content = response.choices?.[0]?.message?.content || "";
const jsonMatch = content.match(/\{[\s\S]*\}/);
const result = JSON.parse(jsonMatch[0]);

// Step 5: GDPR cleanup
fs.unlinkSync("/path/to/cv.pdf");
```

**Key points:**
- `type: "file"` (NOT `"input_file"` - that's for Responses API)
- `file_data: "data:application/pdf;base64,..."` (data URI format)
- `filename: "cv.pdf"` (required field)
- NO Files API upload needed
- NO `purpose: "assistants"` or `"user_data"` needed
- Max 50MB per file, max 100 pages

---

## FILES MODIFIED

| File | Lines | What Changed |
|------|-------|-------------|
| `document-processor.ts` | 127-139 | `experience_summary` Zod preprocess (array → string) |
| `document-processor.ts` | 216-228 | `extraction_logic` Zod preprocess (object → string) |
| `document-processor.ts` | 539-542 | PDF uses inline base64, not Files API |
| `document-processor.ts` | 783-818 | `buildVisionMessageContent()` new PDF format |
| `document-processor.ts` | (deleted) | `uploadPdfToFilesAPI()` removed entirely |
| `types/OpenAIExtended.ts` | constructor | API key fallback to env var |
| `types/OpenAIExtended.ts` | parseStructured | Standard API + JSON regex |
| `app.ts` | 81-84 | Raw buffer webhook signature |
| `app.ts` | ~406 | try-catch around document processing |
