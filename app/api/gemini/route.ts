import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

// Helper function to call Gemini with fallback models in case of 503 (Service Unavailable) or high-demand errors
async function generateContentWithFallback(
  ai: GoogleGenAI,
  model: string,
  contents: any,
  config?: any
) {
  try {
    return await ai.models.generateContent({
      model,
      contents,
      config,
    });
  } catch (firstError: any) {
    console.warn(`Primary model ${model} failed (possibly 503 or high demand), attempting fallback. Error details:`, firstError);
    
    // Determine the backup models to try
    const fallbacks = ["gemini-3.1-flash-lite", "gemini-flash-latest"];
    
    for (const backupModel of fallbacks) {
      if (backupModel === model) continue;
      try {
        console.log(`Attempting fallback with model: ${backupModel}`);
        const response = await ai.models.generateContent({
          model: backupModel,
          contents,
          config,
        });
        return response;
      } catch (backupError: any) {
        console.error(`Fallback model ${backupModel} also failed:`, backupError);
      }
    }
    
    // If all fail, throw the original error
    throw firstError;
  }
}

export async function POST(req: NextRequest) {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      return NextResponse.json(
        { error: "Kunci API (GEMINI_API_KEY) tidak terkonfigurasi. Harap konfigurasikan via menu Settings." },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ 
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    const { action, payload } = await req.json();

    if (action === "extract") {
      const prompt = `
Kamu adalah API asisten keuangan yang hanya merespons menggunakan JSON murni.
Tugasmu adalah mengekstrak data dari input pengguna ke dalam bentuk Array of Objects.

Aturan ketat:
1. JANGAN berikan teks pengantar, penutup, atau format markdown (seperti \`\`\`json). Langsung mulai dengan tanda [ dan akhiri dengan ].
2. Nilai "nominal" harus berupa angka integer tanpa titik atau koma (contoh: 20000, bukan "20.000").
3. Kategori yang diizinkan hanya: "makanan", "transportasi", "tagihan", "hiburan", "pendapatan", "lainnya".
4. Jenis transaksi hanya: "pengeluaran" atau "pemasukan".
5. PENTING: Ekstraksilah SEMUA transaksi yang disebutkan oleh Pengguna (baik pengeluaran maupun pemasukan). Jangan hanya mengekstrak salah satu tipe saja atau hanya mengambil 1 item saja. Jika pengguna menuliskan pemasukan sekaligus pengeluaran secara bersamaan, catat keduanya sebagai elemen terpisah dalam array JSON.

Format output yang diharapkan:
[
  {
    "jenis": "pengeluaran",
    "item": "nama barang/jasa",
    "nominal": 0,
    "kategori": "makanan"
  }
]

Input Pengguna: "${payload}"
`;

      const response = await generateContentWithFallback(ai, "gemini-3.5-flash", prompt);

      const responseText = response.text || "[]";
      let cleaned = responseText.trim();
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.substring(7);
      }
      if (cleaned.endsWith("```")) {
        cleaned = cleaned.substring(0, cleaned.length - 3);
      }
      cleaned = cleaned.trim();

      try {
        const parsed = JSON.parse(cleaned);
        return NextResponse.json({ data: parsed });
      } catch (parseErr) {
        console.error("Failed parsing LLM response as JSON. Raw was:", responseText);
        // Attempt a fallback parse or return error
        return NextResponse.json({ error: "Format respons AI tidak valid. Harap coba lagi.", raw: responseText }, { status: 422 });
      }
    } else if (action === "review") {
      const transactions = payload;
      const prompt = `
Kamu adalah Konsultan Keuangan Pribadi yang cerdas, bijaksana, ramah, dan profesional.
Berdasarkan log transaksi keuangan pengguna berikut, berikan analisis mendalam, masukan yang konstruktif, serta saran praktis dalam Bahasa Indonesia yang santun dan memotivasi.

Log Transaksi Keuangan:
${JSON.stringify(transactions, null, 2)}

Format laporan ulasan Anda dalam format Markdown yang indah, rapi, dan mudah dibaca (gunakan poin, bullet, tabel, atau sub-judul tebal seperlunya). Analisis terperinci meliputi:
1. Ringkasan total pendapatan, total pengeluaran, dan rasio tabungan.
2. Identifikasi kategori pengeluaran terbesar dan analisis pola konsumsi.
3. Rekomendasi konkret tindakan hemat serta tips alokasi anggaran (misalnya model penganggaran 50/30/20).
Tambahkan kata-kata penyemangat di bagian akhir agar pengguna termotivasi mencatat keuangan. Jaga agar visual terlihat elegan saat dirender.
`;

      const response = await generateContentWithFallback(ai, "gemini-3.5-flash", prompt);

      return NextResponse.json({ text: response.text || "Gagal menghasilkan ulasan keuangan." });
    }

    return NextResponse.json({ error: "Aksi tidak valid atau tidak didukung." }, { status: 400 });
  } catch (error: any) {
    console.error("API Route Error:", error);
    return NextResponse.json(
      { error: "Terjadi kesalahan internal pada server AI: " + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
