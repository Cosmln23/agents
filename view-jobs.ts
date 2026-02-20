import axios from "axios";
import { parse } from "csv-parse/sync";

// Link-ul tău de Google Sheets
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSO-y2ueZ1ocKYEpTrLH6sAWVDEW0y42JQV8nSp2e77s5zb0XSOnq4MgOxBZxhysXKL-JEOas5bAbq3/pub?output=csv";

async function afiseazaToateJoburile() {
  try {
    console.log("\n🔎 Accesăm baza de date Google Sheets...");
    const response = await axios.get(GOOGLE_SHEET_CSV_URL);

    const joburi = parse(response.data, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      cast: true
    });

    console.log(`✅ Am găsit ${joburi.length} joburi active.\n`);

    // Magia: afișăm totul sub formă de tabel în terminal
    console.table(joburi);
  } catch (error) {
    console.error("❌ Eroare: Nu am putut citi tabelul. Verifică dacă este 'Published to Web'.");
  }
}

afiseazaToateJoburile();
