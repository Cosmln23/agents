# 📱 SETUP WHATSAPP WEBHOOK - Ghid Complet

## 🎯 Scopul

Conectarea botului tău cu WhatsApp API-ul Meta, pentru a:
- ✅ Primi mesaje reale de la candidați
- ✅ Procesa automat (Extract → Match)
- ✅ Trimite oferta de job pe WhatsApp

---

## ⚙️ PASUL 1: Instalarea și Configurarea ngrok

### Ce este ngrok?

**ngrok** expune serverul tău local (localhost:3000) pe internet, iar Meta poate să-l acceseze.

### Instalare:

**macOS (cu Homebrew):**
```bash
brew install ngrok
```

**Windows/Linux:**
Descarcă de pe: https://ngrok.com/download

### Verificare:
```bash
ngrok --version
```

---

## 🚀 PASUL 2: Pornirea Serverului și ngrok

### Terminal 1: Pornește aplicația
```bash
cd ~/Desktop/recrutare-ai-whatsapp
npx ts-node server.ts
```

**Output așteptat:**
```
🚀 WEBHOOK ACTIV!
📍 Portul: 3000
🔗 URL local: http://localhost:3000

⚠️  Pentru a funcționa, trebuie să faci portul vizibil cu ngrok:
   ngrok http 3000
```

### Terminal 2: Pornește ngrok
```bash
ngrok http 3000
```

**Output așteptat:**
```
ngrok (v3.0.0)

Session Status                online
Account                       username@gmail.com
Version                       3.0.0
Region                        eu (Europe)
Forwarding                    https://abc123.ngrok-free.app -> http://localhost:3000
```

**Copiază URL-ul:** `https://abc123.ngrok-free.app`

---

## 🔐 PASUL 3: Configurarea în Meta Dashboard

### 1. Accesează Meta for Developers
- Mergi pe: https://developers.facebook.com
- Selectează aplicația WhatsApp
- Mergi la "Configuration" → "Webhooks"

### 2. Configurare Webhook

**URL-ul Webhook:**
```
https://abc123.ngrok-free.app/webhook
```

**Verify Token:**
```
codul_ales_de_tine_din_.env
```

*(Trebuie să fie identical cu `VERIFY_TOKEN` din `.env` tău)*

### 3. Selectează Subscriber Fields
Bifează:
- ✅ `messages`
- ✅ `message_template_status_update`

### 4. Salvează Configurația
Dă click "Verify and Save"

**Ar trebui să vezi în Terminal 1:**
```
✓ Meta verifică webhook-ul...
  Mode: subscribe
  Token: codul_tău
✅ Webhook verificat cu succes!
```

---

## 📊 PASUL 4: Get Your Credentials

### Unde găsești credențialele?

#### 1. **WHATSAPP_TOKEN** (Permanent Access Token)
- Meta Dashboard → "API Setup"
- "Permanent Access Token" → Copy
- Adaugă în `.env`:
```
WHATSAPP_TOKEN="EAAG......"
```

#### 2. **PHONE_NUMBER_ID**
- Meta Dashboard → "Phone numbers"
- Copy "Phone Number ID"
- Adaugă în `.env`:
```
PHONE_NUMBER_ID="123456789..."
```

#### 3. **VERIFY_TOKEN** (ales de tine)
- Alege orice cod (ex: "mysecrettoken123")
- Adaugă în `.env`:
```
VERIFY_TOKEN="mysecrettoken123"
```

### Verificare .env:
```bash
cat .env | grep WHATSAPP
```

Output:
```
WHATSAPP_TOKEN=EAAG...
PHONE_NUMBER_ID=123456789...
VERIFY_TOKEN=mysecrettoken123
```

---

## 🧪 PASUL 5: Test Complet

### Setup:
1. Terminal 1: `npx ts-node server.ts` ✅
2. Terminal 2: `ngrok http 3000` ✅
3. Webhook configurat în Meta ✅
4. Credențiale în `.env` ✅

### Trimite un test de pe telefonul tău:

**Mesaj:**
```
Salut, sunt Dan, am VCA și BSN, și vorbesc engleză.
```

### Ce se întâmplă:

**Terminal 1 (server.ts):**
```
📱 MESAJ PRIMIT
  De la: +40712345678
  Text: "Salut, sunt Dan, am VCA și BSN, și vorbesc engleză."

🤖 Agentul 2: Se extrage datele...
✅ Extragere gata: {
  "nume": "Dan",
  "hasVCA": true,
  "hasBSN": true,
  "permis": false,
  "limbi": ["engleză"]
}

💼 Agentul 3: Se cauta jobul...
📊 Am găsit 6 joburi active

📤 Se trimite răspunsul pe WhatsApp...
📨 Mesaj trimis cu ID: wamid_...

✅ Răspuns trimis cu succes!
```

**Pe telefonul tău (WhatsApp):**
```
🚀 MATCH GĂSIT! Salut Dan, am un post de Stivuitorist în Eindhoven la 17€/oră. Te interesează?
```

---

## 🐛 Debugging: Erori Comune

### ❌ "Token incorect"
```
❌ Token incorect!
```

**Soluție:**
- Verifică dacă `VERIFY_TOKEN` din `.env` = cu cel din Meta Dashboard
- Restart server-ul

### ❌ "Nu primesc mesaje"
Verifică:
1. ngrok rulează? (`ngrok http 3000`)
2. URL-ul din Meta e corect? (ex: `https://abc123.ngrok-free.app/webhook`)
3. Webhook e în stare "active" în Meta?

```bash
# Restart totul:
# Terminal 1:
Ctrl+C
npx ts-node server.ts

# Terminal 2:
Ctrl+C
ngrok http 3000
```

### ❌ "Eroare la trimiterea mesajului"
```
❌ Eroare la trimiterea mesajului pe WhatsApp: 401
```

**Soluție:**
- `WHATSAPP_TOKEN` expirat? → Get new token din Meta
- `PHONE_NUMBER_ID` gresit? → Copy din dashboard din nou

### ❌ "Mesaj primit dar nu răspunde"
Verifică .env:
```bash
echo $OPENAI_API_KEY
echo $WHATSAPP_TOKEN
```

Dacă nu apare nimic → `dotenv.config()` nu încarcă .env

Soluție:
```bash
# Restart cu dotenv manual
export $(cat .env | xargs)
npx ts-node server.ts
```

---

## 📈 PASUL 6: Monitoring & Logs

### Cum citesc mesajele în timp real?

**Terminal 1 (server.ts):**
```
👁️ Monitorare live a mesajelor
```

Fiecare mesaj va arăta:
```
📱 MESAJ PRIMIT
  De la: +40712345678
  Text: "..."

[Agenții procesează]

✅ Răspuns trimis cu succes!
```

### Salvează logs în fișier:

```bash
npx ts-node server.ts > bot-logs.txt 2>&1 &
```

Apoi citește:
```bash
tail -f bot-logs.txt
```

---

## 🔒 Securitate: Best Practices

### 1. Protejează VERIFY_TOKEN
- ❌ Nu-l pushai pe GitHub
- ✅ Păstrează-l în `.env` (din fișierul `.gitignore`)

### 2. Restricții IP (Optional)
În Meta Dashboard, setează IP whitelist (doar de la serverul tău)

### 3. Rate Limiting
Adaugă în viitorul `server.ts`:
```typescript
import rateLimit from "express-rate-limit";

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100 // 100 requests per 15 min
});

app.use(limiter);
```

---

## 📦 DEPLOYMENT (Producție)

Când vrei să treci din localhost pe un server real:

### 1. Host-ul de Cloud
- Heroku, Railway, Render, AWS, DigitalOcean
- Deploy aplicația pe cloud

### 2. Configurare Webhook
- URL: `https://yourserver.com/webhook` (fără ngrok)
- Same VERIFY_TOKEN

### 3. Variabile de Mediu
```
WHATSAPP_TOKEN=...
PHONE_NUMBER_ID=...
VERIFY_TOKEN=...
OPENAI_API_KEY=...
PORT=3000
```

### 4. SSL Certificate
Asigură-te că serverul are HTTPS (certificat SSL valid)

---

## ✅ Checklist Final

- [ ] ngrok instalat și rulează
- [ ] Server rulează (`npx ts-node server.ts`)
- [ ] ngrok URL configurat în Meta
- [ ] VERIFY_TOKEN setat în `.env` și Meta
- [ ] WHATSAPP_TOKEN adăugat în `.env`
- [ ] PHONE_NUMBER_ID adăugat în `.env`
- [ ] Webhook în stare "active" în Meta
- [ ] Test: trimis mesaj, primit răspuns ✅

---

## 📞 Support

Dacă ceva nu merge:
1. Verifică logs în Terminal 1
2. Restart server + ngrok
3. Verifica credențialele în Meta Dashboard
4. Test din nou

---

**Gata!** Bot-ul tău e LIVE! 🎉

Acum primești mesaje REALE și răspunzi AUTOMAT! 🚀
