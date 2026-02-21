/**
 * MESSAGES CONFIGURATION (Enterprise-Ready)
 * 
 * 🛡️ THE TEMPLATE RULE: 
 * De fiecare dată când modifici un mesaj, asigură-te că păstrezi variabilele 
 * în forma de variabilă (funcții cu argumente), pentru ca datele din cod
 * (ex: din CV) să fie injectate corect în mesaj!
 * 
 * Zero Riscuri: Modifici textele aici fără să atingi logica de programare.
 */

export const BotMessages = {
    // 1. Onboarding & GDPR
    welcomeGDPR: `Salutare! 👋 Sunt asistentul tău digital de recrutare. Misiunea mea este să îți găsesc jobul potrivit cât mai repede.\n\nConform normelor GDPR, am nevoie de acordul tău pentru a-ți procesa informațiile și a te ajuta în procesul de angajare.\n\nEști de acord să începem? (Scrie DA sau NU)`,

    // 2. Momentul de "Prezentare" (Alegeri profil)
    presentationOptions: `Perfect! Mulțumesc pentru încredere. ✨\n\nPentru a-ți crea profilul de candidat, avem două variante:\n\n📄 Trimite-mi CV-ul tău (PDF sau poză) și mă ocup eu de restul.\n\n✍️ Povestește-mi tu despre studiile, experiența și abilitățile tale tehnice.\n\nCum preferi să procedăm?`,

    // 3. Respingere GDPR
    consentRejected: `Înțeleg. Fără acordul tău, nu pot procesa informații personale. Dacă de schimbi ideea, poți contacta echipa HR. 👋`,

    // 4. Reminder Consimțământ
    promptConsent: `Te rog răspunde cu "DA" dacă ești de acord, sau "NU" dacă refuzi. 🙏`,

    // 5. Feedback-ul după citirea CV-ului
    cvFeedback: (name: string, domain: string, experience: string, mobility: string, skills: string) =>
        `Am analizat CV-ul tău, ${name}! 📄 Văd că ai o experiență solidă și variată în ${domain}, mai ales în rolul de ${experience}.\n\nIată ce am reținut din parcursul tău:\n\n🏢 Experiență recentă: ${experience}.\n\n🌍 Mobilitate: Ai lucrat cu succes în ${mobility}.\n\n🏗️ Expertiză: ${skills}.\n\nEste corect sau dorești să mai adăugăm ceva la experiența ta?`,

    // 6. Erori Documente
    cvExtractionFailed: `⚠️ Nu am putut extrage detalii din document. Încearcă cu un alt format (PDF/JPG).`,
    cvDownloadFailed: `❌ Nu am reușit să descarc documentul tău. Te rog să-l trimiți din nou sau încearcă formatul PDF.`,

    // 7. Salvare date noi din text
    dataRecorded: `✅ Mulțumesc! Am înregistrat informația.`,

    // 8. Profil Completat -> Job Găsit (legacy - kept for compatibility)
    profileComplete: `🚀 PERFECT! Am găsit joburi potrivite pentru tine!\n\nEchipa HR te va contacta în curând cu detalii. 📞`,

    // 9. Sistem (Rate Limit)
    rateLimitExceeded: `Too many messages. Please wait a moment.`,

    // ============================================
    // ETAPA: QUALIFICATION (Stage: waiting_qualification)
    // Întrebări logistice după citirea CV-ului
    // ============================================

    // 10. Întrebări de calificare logistică
    qualificationQuestions: (name: string) =>
        `Excelent, ${name}! 🎯 Pe baza CV-ului tău, am identificat câteva poziții care s-ar potrivi perfect experienței tale.\n\nÎnainte să îți trimit matching-ul complet, am nevoie de două detalii logistice esențiale:\n\n📅 1. Când este cea mai apropiată dată la care poți începe un nou job?\n   (Scrie: "Imediat", "Preaviz 2 săptămâni", sau data exactă)\n\n🏠 2. Ai nevoie de cazare oferită de agenție sau ai locuință proprie în zonă?\n   (Scrie: "Da, cazare" sau "Nu, am locuință")\n\nRăspunde la ambele întrebări și continuăm! 👇`,

    // ============================================
    // ETAPA: DISPATCH CONSENT (Stage: waiting_dispatch_consent)
    // Prezentare joburi + consimțământ GDPR transfer date
    // ============================================

    // 11. Prezentare joburi potrivite + cerere consimțământ transfer
    jobMatchesFound: (name: string, jobsList: string, availability: string, accommodation: string) =>
        `🚀 Am verificat baza noastră de joburi active, ${name}!\n\n${jobsList}\n\n📋 Profilul tău:\n• Disponibilitate: ${availability}\n• Cazare: ${accommodation}\n\n─────────────────────\n⚖️ TRANSFER DATE (GDPR Art. 44)\nPentru a trimite dosarul tău către Departamentul de Recrutare, am nevoie de consimțământul tău explicit.\n\nEști de acord să trimitem profilul tău complet (fără CV original) echipei noastre de recruteri? (DA/NU)`,

    // 12. Când nu se găsesc joburi potrivite
    noJobsFound: (name: string) =>
        `${name}, am analizat profilul tău cu atenție, dar în acest moment nu avem poziții deschise care să se potrivească 100% cu experiența ta.\n\nVom păstra profilul tău în baza de date și te vom contacta de îndată ce apare o oportunitate potrivită.\n\nMulțumim pentru încredere! 🤝`,

    // ============================================
    // ETAPA: DISPATCHED (Stage: dispatched)
    // Confirmare trimitere + așteptare recrutor
    // ============================================

    // 13. Confirmare dispatch cu succes
    dispatchConfirmed: (name: string, agencyName: string) =>
        `✅ Gata, ${name}! Dosarul tău a fost trimis cu prioritate către echipa de recrutare ${agencyName}.\n\n📞 Un consultant de recrutare va analiza profilul tău și te va contacta direct pe acest număr de WhatsApp în maxim 24 de ore pentru a discuta detaliile.\n\n🔐 Datele tale sunt protejate conform GDPR. Ai consimțit la transferul datelor în data de astăzi și poți retrage consimțământul oricând.\n\nSucces, ${name}! O zi excelentă! 🌟`,

    // 14. Dacă user refuză dispatch
    dispatchRefused: `Înțeleg perfect. Profilul tău rămâne în siguranță la noi și nu va fi trimis nicăieri fără acordul tău.\n\nDacă te răzgândești, scrie oricând "DA" pentru a relua procesul. 🤝`,
};
