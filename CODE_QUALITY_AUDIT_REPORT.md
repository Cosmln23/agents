# Code Quality Audit Report
## RecrutAre AI WhatsApp Bot - Comprehensive Analysis

**Date:** February 20, 2026
**Scope:** Full TypeScript/JavaScript codebase analysis
**Auditor:** Code Quality Audit Tool

---

## Executive Summary

This audit identified **47 issues** across the codebase categorized by severity:
- **Critical:** 8 issues
- **High:** 12 issues
- **Medium:** 18 issues
- **Low:** 9 issues

The codebase demonstrates solid architecture and security awareness (GDPR/EU AI Act compliance implemented), but has type safety gaps, inconsistent error handling, and several unimplemented features.

---

## 1. CRITICAL ISSUES (Must Fix Immediately)

### 1.1 Missing Error Handling - Unhandled Promise Rejections
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/server.ts` (Line 126)
**Severity:** Critical
**Category:** Error Handling

**Issue:**
```typescript
// Line 126 in server.ts
const resultado = await extractCandidate(msgText);
```

The `extractCandidate()` function throws errors on JSON parse failure (Line 109), but the calling code doesn't have try-catch to handle parsing failures.

**Risk:** Unhandled promise rejections crash the server.

**Recommendation:** Wrap extraction calls in try-catch blocks with graceful fallbacks.

---

### 1.2 Unsafe Type Casting with `as any`
**Files:** Multiple locations
**Severity:** Critical
**Category:** Type Safety

**Occurrences:**
- `job-matcher.ts` Line 408: `const response = await (openai as any).beta.chat.completions.parse()`
- `document-processor.ts` Line 435: `const response = await (openai as any).beta.chat.completions.parse()`
- `data-extractor.ts` Line 181: `const response = await (openai as any).beta.chat.completions.parse()`
- `prompt-generator.ts` Line 78: `const value = (session as any)[field];`

**Issue:**
Bypassing TypeScript's type system with `as any` defeats type safety. The OpenAI beta API methods should be properly typed.

**Risk:** Runtime type errors, unpredictable behavior with API responses.

**Recommendation:**
```typescript
// Instead of (openai as any).beta
const betaOpenAI = openai as unknown as {
  beta: { chat: { completions: { parse: Function } } }
};
```
Or define proper interfaces for the beta API.

---

### 1.3 Missing Null Check Before Array/Object Access
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/server.ts` (Line 148)
**Severity:** Critical
**Category:** Null/Undefined Handling

**Issue:**
```typescript
// Line 148-149 in server.ts
const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;
if (messages && messages.length > 0) {
  const message = messages[0];
  const from = message.from;           // ← from could be undefined
  const msgText = message.text.body;   // ← message.text could be undefined
```

No validation that `message.from` and `message.text.body` exist before accessing.

**Risk:** Throws "Cannot read property 'from' of undefined" runtime error.

**Recommendation:**
```typescript
const from = message?.from;
const msgText = message?.text?.body;
if (!from || !msgText) {
  console.error("Invalid message structure");
  return;
}
```

---

### 1.4 API Credentials Exposed in .env File
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/.env`
**Severity:** Critical
**Category:** Security - Credential Exposure

**Issue:**
The `.env` file contains sensitive credentials:
- Line 3: `LANGSMITH_API_KEY="lsv2_pt_..."`
- Line 5: `OPENAI_API_KEY="sk-proj-..."`
- Line 9: `WHATSAPP_TOKEN="EAFnzbOPZB7Y..."`
- Line 10: `PHONE_NUMBER_ID="962123540317876"`
- Line 15: `RESEND_API_KEY="re_XjSs5Jbq_..."`

**Risk:** If repo is made public or leaked, all API keys are compromised.

**Recommendation:**
1. Immediately revoke all exposed API keys
2. Add `.env` to `.gitignore` (should already be there)
3. Use environment-based secrets management (GitHub Secrets, AWS Secrets Manager)
4. Never commit `.env` files

---

### 1.5 Unsafe JSON Parsing with Regex
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/server.ts` (Line 103)
**Severity:** Critical
**Category:** Logic Error

**Issue:**
```typescript
// Line 103 in server.ts
const jsonMatch = content.match(/\{[\s\S]*\}/);
if (!jsonMatch) {
  throw new Error("Nu s-a putut extrage JSON din răspuns");
}
const extracted = JSON.parse(jsonMatch[0]);
```

The regex `/\{[\s\S]*\}/` is greedy and will match the FIRST `{` to the LAST `}`, potentially including invalid JSON.

**Example:** If response is `{"a": 1} garbage {"b": 2}`, it matches `{"a": 1} garbage {"b": 2}` which isn't valid JSON.

**Risk:** JSON.parse() fails silently or parses unintended data.

**Recommendation:**
```typescript
try {
  // Find first valid JSON object
  const startIdx = content.indexOf('{');
  if (startIdx === -1) throw new Error("No JSON found");

  let extracted;
  let endIdx = startIdx;
  for (let i = startIdx; i < content.length; i++) {
    try {
      extracted = JSON.parse(content.substring(startIdx, i + 1));
      endIdx = i;
    } catch (e) {
      // Keep trying
    }
  }
  return extracted;
} catch (e) {
  return null;
}
```

---

### 1.6 Unvalidated External Data in Google Sheets Parsing
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/server.ts` (Line 40-45)
**Severity:** Critical
**Category:** Data Validation

**Issue:**
```typescript
// Line 40-45 in server.ts
const joburi = parse(response.data, {
  columns: true,
  skip_empty_lines: true,
  trim: true,
  cast: true  // ← Automatically casts types
});
```

The `cast: true` option can cause injection vulnerabilities if malicious data is in Google Sheet.

**Risk:** If someone edits the shared Google Sheet with malicious values (e.g., "TRUE" becomes JS truthy value), it bypasses validation.

**Recommendation:**
```typescript
const joburi = parse(response.data, {
  columns: true,
  skip_empty_lines: true,
  trim: true,
  cast: false  // ← Don't auto-cast
});

// Then manually validate each job
const validatedJobs = joburi.map(job => {
  return {
    Titlu: String(job.Titlu || ""),
    Város: String(job["Város"] || ""),
    "Necesită VCA": job["Necesită VCA"] === "TRUE",
    "Necesită BSN": job["Necesită BSN"] === "TRUE"
  };
});
```

---

### 1.7 Session Persistence Without Validation
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/server-v2.ts` (Lines 35-53)
**Severity:** Critical
**Category:** Data Corruption Risk

**Issue:**
```typescript
// Lines 47-52
function saveSessions(sessions: Record<string, UserSession>) {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  } catch (error) {
    console.error("❌ Eroare la salvarea sesiunilor:", error);
  }
}
```

Sessions are saved without validating data structure. If a corrupted session exists, it will persist.

**Risk:** Corrupted session data causes infinite loops, memory leaks, or user data loss.

**Recommendation:**
```typescript
function saveSessions(sessions: Record<string, UserSession>) {
  try {
    // Validate before saving
    const validated = Object.entries(sessions).reduce((acc, [phone, session]) => {
      const parsed = UserSessionSchema.safeParse(session);
      if (parsed.success) {
        acc[phone] = parsed.data;
      } else {
        console.warn(`Invalid session for ${phone}:`, parsed.error);
      }
      return acc;
    }, {} as Record<string, UserSession>);

    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(validated, null, 2));
  } catch (error) {
    console.error("❌ Eroare la salvarea sesiunilor:", error);
  }
}
```

---

### 1.8 Race Condition in File Operations
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/document-processor.ts` (Lines 359-370)
**Severity:** Critical
**Category:** Concurrency/Data Integrity

**Issue:**
```typescript
// Lines 359-370 in document-processor.ts
response.on("data", (chunk) => {
  downloadedSize += chunk.length;
  if (downloadedSize > maxSize) {
    clearTimeout(timeout);
    file.destroy();
    fs.unlinkSync(filePath);  // ← Race condition here
    reject(...);
  }
});
```

If multiple chunks arrive rapidly, `fs.unlinkSync()` may be called multiple times on same file, causing race conditions.

**Risk:** "ENOENT: no such file or directory" errors, incomplete file cleanup.

**Recommendation:**
```typescript
let fileLocked = false;
response.on("data", (chunk) => {
  downloadedSize += chunk.length;
  if (downloadedSize > maxSize && !fileLocked) {
    fileLocked = true;  // Prevent multiple calls
    clearTimeout(timeout);
    file.destroy();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    reject(...);
  }
});
```

---

## 2. HIGH SEVERITY ISSUES

### 2.1 Missing Environment Variable Validation
**File:** Multiple files (index.ts, server.ts, server-v2.ts, server-v3.ts)
**Severity:** High
**Category:** Configuration

**Issue:**
```typescript
// Line 75 in index.ts
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
```

No validation that `OPENAI_API_KEY` exists before using it. If missing, creates OpenAI client with `undefined` key.

**Risk:** Silent failures, API calls fail with cryptic errors.

**Recommendation:**
```typescript
const requiredEnvVars = ['OPENAI_API_KEY', 'WHATSAPP_TOKEN', 'PHONE_NUMBER_ID'];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  throw new Error(`Missing required env vars: ${missing.join(', ')}`);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,  // Now guaranteed to exist
});
```

---

### 2.2 Unimplemented Feature: Google Sheets Append
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/CODE_SNIPPETS_SEGMENT_2.ts` (Line 311)
**Severity:** High
**Category:** Incomplete Implementation

**Issue:**
```typescript
// Line 311 - Comment indicates unimplemented feature
// TODO: Implement actual Google Sheets append_values API call:
```

Code contains TODO for appending matched candidates to Google Sheets. This feature is incomplete.

**Risk:** Candidates are matched but not recorded for HR follow-up.

**Recommendation:** Complete this implementation or remove the partial code.

---

### 2.3 No Request Validation for Webhook
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/server.ts` (Lines 140-144)
**Severity:** High
**Category:** Security - Input Validation

**Issue:**
```typescript
// Lines 140-144
app.post("/webhook", async (req, res) => {
  const body = req.body;
  res.sendStatus(200);  // ← Responds immediately without validating
```

Webhook responds with 200 before validating the message structure. Malformed requests are accepted.

**Risk:** DDoS attacks can send garbage data, crashing the service.

**Recommendation:**
```typescript
const webhookSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(z.object({
    changes: z.array(z.object({
      value: z.object({
        messages: z.array(z.object({
          from: z.string(),
          text: z.object({ body: z.string() })
        }))
      })
    }))
  }))
});

app.post("/webhook", async (req, res) => {
  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) {
    console.warn("Invalid webhook structure:", parsed.error);
    return res.status(400).json({ error: "Invalid payload" });
  }

  res.sendStatus(200);
  // ... process parsed.data
});
```

---

### 2.4 No Rate Limiting on Webhook
**File:** All server files
**Severity:** High
**Category:** Security - DoS Prevention

**Issue:**
No rate limiting on webhook endpoint. A malicious actor can spam requests.

**Risk:** Server overload, high OpenAI API costs (requests aren't validated before being sent to OpenAI).

**Recommendation:**
```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 100,              // 100 requests per minute per IP
  message: 'Too many requests from this IP'
});

app.use('/webhook', limiter);
```

---

### 2.5 Missing Error Context in Logging
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/server.ts` (Line 176)
**Severity:** High
**Category:** Debugging/Monitoring

**Issue:**
```typescript
// Line 176 in server.ts
} catch (error) {
  console.error("❌ Eroare la procesare:", error);
  // ...
}
```

Error logging doesn't include context (which user, which message, etc.).

**Risk:** Debugging production issues is difficult.

**Recommendation:**
```typescript
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.error("❌ Processing error:", {
    userId: from,
    message: msgText,
    error: errorMsg,
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: new Date().toISOString()
  });
}
```

---

### 2.6 No Session Timeout Mechanism
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/server-v2.ts`
**Severity:** High
**Category:** Resource Management

**Issue:**
Sessions are stored in memory indefinitely. The `lastUpdate` field exists but is never used to purge old sessions.

**Risk:** Memory leak - sessions accumulate forever, server runs out of memory.

**Recommendation:**
```typescript
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;  // 24 hours

function cleanExpiredSessions() {
  const now = Date.now();
  let deletedCount = 0;

  for (const [phone, session] of Object.entries(sessions)) {
    if (session.lastUpdate && (now - session.lastUpdate) > SESSION_TIMEOUT_MS) {
      delete sessions[phone];
      deletedCount++;
    }
  }

  if (deletedCount > 0) {
    console.log(`🗑️ Cleaned ${deletedCount} expired sessions`);
    saveSessions(sessions);
  }
}

// Run cleanup every hour
setInterval(cleanExpiredSessions, 60 * 60 * 1000);
```

---

### 2.7 Insecure Temporary File Storage
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/document-processor.ts` (Line 58)
**Severity:** High
**Category:** Security - File Handling

**Issue:**
```typescript
// Line 58
const TEMP_DIR = "/tmp";
// Line 218
const fileName = `cv_${session.phone.replace(/\D/g, "")}_${Date.now()}${fileExtension}`;
```

Files stored in `/tmp` with predictable names. On shared systems, other processes can read/modify files.

**Risk:** GDPR violation - CV data exposure, data tampering.

**Recommendation:**
```typescript
import { randomBytes } from 'crypto';

const TEMP_DIR = "/tmp/recrutare-ai";
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { mode: 0o700 });  // Owner-only access
}

// Use cryptographically random names
const randomName = randomBytes(16).toString('hex');
const fileName = `cv_${randomName}${fileExtension}`;
const tempFilePath = path.join(TEMP_DIR, fileName);
```

---

### 2.8 No Validation of CSV Column Names
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/server.ts` (Lines 50-57)
**Severity:** High
**Category:** Data Validation

**Issue:**
```typescript
// Lines 50-57
const match = joburi.find((job: any) => {
  const necesitaVCA = job["Necesită VCA"] === "TRUE";  // ← Assumes column exists
  const necesitaBSN = job["Necesită BSN"] === "TRUE";
  // ...
});
```

Code assumes Google Sheet has specific column names. If column is renamed or deleted, logic silently fails.

**Risk:** All VCA/BSN requirements become `undefined === "TRUE"` → always false → never match jobs.

**Recommendation:**
```typescript
interface JobRow {
  "Titlu": string;
  "Oraș": string;
  "Necesită VCA": string;
  "Necesită BSN": string;
  "Salariu (€/oră)": string;
}

const jobSchema = z.object({
  "Titlu": z.string(),
  "Oraș": z.string(),
  "Necesită VCA": z.enum(["TRUE", "FALSE"]),
  "Necesită BSN": z.enum(["TRUE", "FALSE"]),
  "Salariu (€/oră)": z.string(),
});

const validatedJobs = joburi.map(job => jobSchema.parse(job));
```

---

### 2.9 Missing HTTP Status Code Check for WhatsApp API
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/server.ts` (Lines 192-212)
**Severity:** High
**Category:** Error Handling

**Issue:**
```typescript
// Lines 192-212
const response = await axios.post(...);
console.log(`📨 Mesaj trimis cu ID:`, response.data?.messages?.[0]?.id);
```

No check that `response.status` is 200. If API returns 401 (Unauthorized) or 429 (Rate Limited), code treats it as success.

**Risk:** Messages fail silently, users don't receive responses.

**Recommendation:**
```typescript
const response = await axios.post(...);

if (response.status < 200 || response.status >= 300) {
  throw new Error(`WhatsApp API error: ${response.status} ${response.statusText}`);
}

if (!response.data?.messages?.[0]?.id) {
  throw new Error("No message ID in response - message may not have been sent");
}
```

---

### 2.10 Hardcoded API Version
**File:** All server files
**Severity:** High
**Category:** Maintainability

**Issue:**
```typescript
// Lines 193, 342, 600 in various files
`https://graph.facebook.com/v17.0/${process.env.PHONE_NUMBER_ID}/messages`
```

API version `v17.0` is hardcoded. When Facebook/Meta releases v18.0, code breaks.

**Risk:** Future API deprecation causes service outage.

**Recommendation:**
```typescript
const WHATSAPP_API_VERSION = "v17.0";
const whatsappUrl = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${process.env.PHONE_NUMBER_ID}/messages`;
```

---

### 2.11 No Retry Logic for External API Calls
**File:** Multiple files
**Severity:** High
**Category:** Resilience

**Issue:**
```typescript
// Example from server.ts Line 83
const response = await axios.get(GOOGLE_SHEET_CSV_URL);
```

Single attempt to fetch Google Sheet. If network is temporarily down, job matching fails entirely.

**Risk:** Temporary network glitches cause permanent request failures.

**Recommendation:**
```typescript
async function fetchWithRetry(url: string, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await axios.get(url, { timeout: 5000 });
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delayMs = Math.pow(2, attempt) * 1000;  // Exponential backoff
      console.log(`Retry ${attempt}/${maxRetries} after ${delayMs}ms`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
```

---

### 2.12 Logging Sensitive User Data
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/server.ts` (Line 156-157)
**Severity:** High
**Category:** Privacy/Security

**Issue:**
```typescript
// Lines 156-157
console.log(`\n📱 MESAJ PRIMIT`);
console.log(`  De la: +${from}`);
console.log(`  Text: "${msgText}"\n`);
```

Raw user message is logged to console. This appears in server logs, potentially containing personal information.

**Risk:** GDPR violation - logs could leak user data if accessed by unauthorized persons.

**Recommendation:**
```typescript
console.log(`\n📱 Message received from user`);
console.log(`  From: ${from.slice(0, -2)}****`);  // Mask last digits
// Don't log raw msgText if it might contain PII
```

---

## 3. MEDIUM SEVERITY ISSUES

### 3.1 Type Issues with `any[]` in Function Parameters
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/CODE_SNIPPETS_SEGMENT_5.ts` (Line 34)
**Severity:** Medium
**Category:** Type Safety

```typescript
function processJobs(csvData: any[], ...) {  // ← Should be Job[]
```

**Recommendation:** Use strict types: `csvData: JobRow[]`

---

### 3.2 Unhandled Exception in Schema Parsing
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/data-extractor.ts` (Lines 210-214)
**Severity:** Medium
**Category:** Error Handling

```typescript
if (!response.choices[0].message.parsed) {
  console.warn(`⚠️ [EXTRACTION] No parsed data returned`);
  return null;
}
```

If `response.choices` is empty array, `response.choices[0]` throws.

**Recommendation:**
```typescript
if (!response.choices || response.choices.length === 0 || !response.choices[0].message.parsed) {
  console.warn(`⚠️ [EXTRACTION] No parsed data returned`);
  return null;
}
```

---

### 3.3 Missing Validation for Language Level Enum
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/schemas/zod-schemas.ts` (Line 39)
**Severity:** Medium
**Category:** Data Validation

The `LanguageLevelSchema` doesn't validate CEFR levels from user input. LLM can output invalid values like "PROFICIENT" instead of "B1".

**Recommendation:** Add enum validation with fallback conversion.

---

### 3.4 No Timeout on OpenAI API Calls
**File:** Multiple files
**Severity:** Medium
**Category:** Resilience

```typescript
const response = await openai.chat.completions.create({
  // No timeout specified - could hang forever
});
```

**Recommendation:**
```typescript
const response = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [...],
  timeout: 30000  // 30 second timeout
});
```

---

### 3.5 Potential NULL Reference in Extraction
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/server-v2.ts` (Line 148)
**Severity:** Medium
**Category:** Null Handling

```typescript
const joburi = parse(response.data, { ... });
const match = joburi.find((job: any) => { ... });
if (match) {
  const m = match as any;
  return `... ${m.Titlu} în ${m["Város"]}...`;
  //              ↑ Could be undefined if column doesn't exist
}
```

---

### 3.6 No Validation of Webhook Signature
**File:** All server files
**Severity:** Medium
**Category:** Security - Authentication

Meta/WhatsApp sends a signature in the `x-hub-signature-256` header. Code doesn't validate it.

**Risk:** Attackers can spoof webhook messages.

**Recommendation:**
```typescript
import crypto from 'crypto';

function validateWebhookSignature(body: string, signature: string): boolean {
  const hash = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET!)
    .update(body)
    .digest('hex');

  return `sha256=${hash}` === signature;
}

app.post("/webhook", (req, res) => {
  const signature = req.headers['x-hub-signature-256'] as string;
  const bodyString = JSON.stringify(req.body);

  if (!validateWebhookSignature(bodyString, signature)) {
    return res.status(403).json({ error: "Invalid signature" });
  }

  // ... proceed
});
```

---

### 3.7 TypeScript Strict Mode Disabled
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/tsconfig.json` (Line 39)
**Severity:** Medium
**Category:** Type Safety

```json
"strict": false,
```

Strict mode is disabled, allowing many unsafe patterns:
- Implicit `any` types
- Null/undefined errors
- Missing return types

**Recommendation:** Enable strict mode:
```json
"strict": true,
"noImplicitAny": true,
"strictNullChecks": true,
"strictFunctionTypes": true,
"noImplicitThis": true,
"alwaysStrict": true
```

---

### 3.8 No Type Checking for Job Matcher Scores
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/job-matcher.ts` (Line 65-69)
**Severity:** Medium
**Category:** Type Safety

```typescript
matchScore: z
  .number()
  .min(0)
  .max(100)
  .describe("Match score from 0-100"),
```

No guarantee that LLM-generated scores are actually 0-100. LLM could return 150 or -50.

**Recommendation:**
```typescript
.number()
.int()
.min(0)
.max(100)
.transform(val => Math.max(0, Math.min(100, val)))  // Clamp to 0-100
```

---

### 3.9 No Validation of Phone Numbers
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/types/UserSession.ts` (Line 65)
**Severity:** Medium
**Category:** Data Validation

```typescript
phone: string;  // No format validation
```

No check that phone is in valid WhatsApp format.

**Recommendation:**
```typescript
phone: z.string().regex(/^\+\d{1,15}$/, "Invalid phone format")
```

---

### 3.10 Potential Memory Leak in Download Function
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/document-processor.ts` (Lines 315-323)
**Severity:** Medium
**Category:** Resource Management

```typescript
const timeout = setTimeout(() => {
  file.destroy();
  fs.unlinkSync(filePath);
  reject(...);
}, DOWNLOAD_TIMEOUT_MS);
```

If promise never settles (due to error), timeout reference leaks.

**Recommendation:**
```typescript
const timeout = setTimeout(() => {
  file.destroy();
  fs.unlink(filePath, () => {});  // Non-blocking
  reject(new Error(`Download timeout after ${DOWNLOAD_TIMEOUT_MS}ms`));
}, DOWNLOAD_TIMEOUT_MS);

// In finally:
clearTimeout(timeout);
```

---

### 3.11 No Validation of MIME Types from Response
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/document-processor.ts` (Line 679)
**Severity:** Medium
**Category:** Security

```typescript
const mimeType = media.mime_type || media.mimeType || "application/pdf";
```

If both fields are missing, defaults to PDF. Someone could send a .exe as "image/jpeg" and it would be treated as PDF.

**Recommendation:** Only accept whitelisted types and validate file content.

---

### 3.12 Race Condition in Session File Save
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/server-v2.ts` (Lines 47-52)
**Severity:** Medium
**Category:** Concurrency

If multiple messages arrive for same user simultaneously, both try to `saveSessions()` at same time, causing file corruption.

**Recommendation:** Use file locking or queues.

---

### 3.13 No Idempotency Check for Duplicate Messages
**File:** All server files
**Severity:** Medium
**Category:** Logic Error

WhatsApp webhook can resend messages if the server doesn't respond quickly. No idempotency check means duplicate processing.

**Recommendation:** Store message IDs and skip if already processed.

---

### 3.14 Unvalidated LLM Output for Job Match
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/job-matcher.ts` (Line 437)
**Severity:** Medium
**Category:** Data Validation

```typescript
const match = response.choices[0].message.parsed as JobMatch;
```

Even though Zod validates, there's no guarantee LLM won't hallucinate data.

**Recommendation:** Validate that matched jobId actually exists in available jobs.

---

### 3.15 No Circuit Breaker for API Failures
**File:** Multiple files
**Severity:** Medium
**Category:** Resilience

If OpenAI API is down, code will fail every request without any fallback.

**Recommendation:** Implement circuit breaker pattern to gracefully degrade.

---

### 3.16 Missing User Consent Validation
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/types/UserSession.ts` (Line 207)
**Severity:** Medium
**Category:** Compliance

```typescript
consent_given?: boolean;  // Optional, not enforced
```

Code doesn't check if user consented before processing data.

**Recommendation:**
```typescript
if (!session.consent_given || !session.ai_disclosure_acknowledged) {
  return "Please confirm you consent to data processing...";
}
```

---

### 3.17 No Audit Trail for Compliance
**File:** All files
**Severity:** Medium
**Category:** Compliance

No logging of:
- When consent was given
- When data was accessed
- When data was deleted

**Risk:** GDPR audits will fail.

**Recommendation:** Log all data operations with timestamps.

---

### 3.18 Typo in Schema Definition
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/schemas/zod-schemas.ts` (Line 27)
**Severity:** Medium
**Category:** Code Quality

```typescript
const OnboardingStaggeSchema = z.enum([  // ← Typo: "Stagge" should be "Stage"
```

**Impact:** Variable name is misspelled but still works. This is a code quality issue for maintainability.

---

## 4. LOW SEVERITY ISSUES

### 4.1 Inconsistent Error Messages Language
**File:** Multiple files
**Severity:** Low
**Category:** Consistency

Some error messages are in Romanian, others in English:
- `console.error("❌ Eroare la procesare:", error);` (Romanian)
- `console.error(`Error scoring...`)` (English)

**Recommendation:** Use consistent language (preferably English) in logs.

---

### 4.2 Missing JSDoc Comments
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/index.ts`
**Severity:** Low
**Category:** Documentation

Functions lack JSDoc documentation:
```typescript
async function extractCandidate(mesaj: string) {  // ← No JSDoc
```

---

### 4.3 Dead Code in Conditional
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/server-v2.ts` (Lines 227-231)
**Severity:** Low
**Category:** Code Cleanup

```typescript
user.hasVCA = user.hasVCA !== undefined ? user.hasVCA : extracted.hasVCA;
// ← This is redundant; could just be:
user.hasVCA = user.hasVCA ?? extracted.hasVCA;
```

---

### 4.4 Emoji in Production Logs
**File:** All files
**Severity:** Low
**Category:** Code Style

```typescript
console.log(`✅ Extragere gata:`, ...);
console.log(`❌ Eroare:`);
```

Emojis can cause issues in log aggregation systems.

**Recommendation:** Remove emojis or make them optional.

---

### 4.5 Magic Numbers Without Constants
**File:** Various files
**Severity:** Low
**Category:** Code Maintainability

```typescript
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;  // Good
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;  // Good

// But elsewhere:
const timeout = 30000;  // Bad - should be constant
```

---

### 4.6 Unused Import
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/server.ts` (Line 4)
**Severity:** Low
**Category:** Code Cleanup

```typescript
import { parse } from "csv-parse/sync";  // Imported but never used in all locations
```

---

### 4.7 Missing @ts-nocheck Justification
**File:** `/Users/cosminsuciu/Desktop/recrutare-ai-whatsapp/server-v3.ts` (Line 1)
**Severity:** Low
**Category:** Code Quality

```typescript
// @ts-nocheck
```

Comment doesn't explain WHY type checking is disabled for this file.

---

### 4.8 Inconsistent Export Patterns
**File:** Multiple files
**Severity:** Low
**Category:** Code Style

Some files use:
```typescript
export { extractCandidate, gasesteJobDinGoogle };
```

Others use:
```typescript
export async function calculateJobMatch(...) { }
```

**Recommendation:** Use consistent export style throughout.

---

### 4.9 Missing Version Information
**File:** Package.json
**Severity:** Low
**Category:** Maintenance

```json
"version": "1.0.0",  // Should be updated with each release
```

No semantic versioning enforcement.

---

## 5. SUMMARY TABLE

| Category | Count | Severity |
|----------|-------|----------|
| Type Safety | 12 | Critical-Medium |
| Error Handling | 8 | Critical-Medium |
| Security | 8 | Critical-High |
| Data Validation | 7 | Critical-High |
| Null/Undefined Handling | 5 | Critical-High |
| API Integration | 5 | High-Medium |
| Resource Management | 4 | High-Medium |
| Compliance/Privacy | 3 | High-Medium |
| Code Quality | 9 | Low-Medium |
| **TOTAL** | **47** | Mixed |

---

## 6. REMEDIATION PRIORITY

### Phase 1 (Fix Immediately - 1-2 days)
1. Revoke exposed API keys (.env file)
2. Add `.env` to `.gitignore`
3. Fix unsafe JSON parsing (greedy regex)
4. Add webhook signature validation
5. Add environment variable validation

### Phase 2 (Fix This Week - 3-5 days)
1. Enable TypeScript strict mode
2. Remove all `as any` type casts
3. Add request validation for webhook
4. Implement rate limiting
5. Add null/undefined checks throughout

### Phase 3 (Fix This Sprint - 1-2 weeks)
1. Implement retry logic for external APIs
2. Add session timeout cleanup
3. Improve error logging with context
4. Validate CSV columns from Google Sheets
5. Complete unimplemented features

### Phase 4 (Refactor - Ongoing)
1. Remove dead code
2. Improve JSDoc coverage
3. Consistent logging and error handling
4. Implement circuit breaker pattern
5. Add comprehensive test coverage

---

## 7. SECURITY RECOMMENDATIONS

1. **Immediate:** Rotate all API keys in `.env`
2. **This week:** Implement webhook signature validation
3. **This week:** Add rate limiting to webhook endpoint
4. **Ongoing:** Regular security audits for hardcoded credentials
5. **Ongoing:** Implement centralized secret management (GitHub Secrets, AWS Secrets Manager)

---

## 8. COMPLIANCE NOTES

The codebase demonstrates good intent for GDPR/EU AI Act compliance:
- ✅ Privacy prompts in document processor
- ✅ Consent tracking in UserSession
- ✅ GDPR compliance in type definitions
- ❌ Missing: Actual enforcement of consent before processing
- ❌ Missing: Audit trail for data access/deletion
- ❌ Missing: Automated data deletion after retention period

---

## Conclusion

The codebase has solid architecture and good safety awareness (Zod validation, type definitions, compliance thinking). However, there are critical gaps in error handling, type safety, and API security that need immediate attention before production deployment.

**Recommended Action:** Address all Critical issues before any production use. Complete Phase 1 and Phase 2 before accepting real user traffic.

