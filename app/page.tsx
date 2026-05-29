'use client';

import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Utensils,
  Car,
  Tv,
  Receipt,
  PiggyBank,
  ArrowUpRight,
  ArrowDownRight,
  User,
  LogOut,
  Calendar,
  Tag,
  Plus,
  Trash2,
  ListFilter,
  Search,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCw,
  TrendingUp,
  Wallet,
  Coins,
  ChevronRight,
  MessageSquareCode,
  ShieldCheck,
  LogIn,
  Info
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { collection, query, where, orderBy, onSnapshot, setDoc, deleteDoc, doc } from "firebase/firestore";

// Types
interface Transaction {
  id: string;
  jenis: "pengeluaran" | "pemasukan";
  item: string;
  nominal: number;
  kategori: "makanan" | "transportasi" | "tagihan" | "hiburan" | "pendapatan" | "lainnya";
  tanggal: string;
}

const INITIAL_TRANSACTIONS: Transaction[] = [
  {
    id: "tx-init-1",
    jenis: "pemasukan",
    item: "Gaji bulanan awal",
    nominal: 5000000,
    kategori: "pendapatan",
    tanggal: new Date().toISOString().split("T")[0]
  },
  {
    id: "tx-init-2",
    jenis: "pengeluaran",
    item: "Belanja dapur mingguan",
    nominal: 350000,
    kategori: "makanan",
    tanggal: new Date().toISOString().split("T")[0]
  },
  {
    id: "tx-init-3",
    jenis: "pengeluaran",
    item: "Isi bensin motor",
    nominal: 50000,
    kategori: "transportasi",
    tanggal: new Date().toISOString().split("T")[0]
  }
];

// Helper to format currency
const formatIDR = (num: number) => {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(num);
};

// Lightweight Custom Markdown Renderer to handle AI Consultation Reports safely
function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-3 text-slate-700 text-sm leading-relaxed">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        
        // Headers
        if (trimmed.startsWith("### ")) {
          return <h4 key={idx} className="text-sm font-bold text-slate-800 mt-4 border-b border-slate-100 pb-1">{trimmed.replace("### ", "")}</h4>;
        }
        if (trimmed.startsWith("## ")) {
          return <h3 key={idx} className="text-base font-extrabold text-indigo-700 mt-5 flex items-center gap-2">✨ {trimmed.replace("## ", "")}</h3>;
        }
        if (trimmed.startsWith("# ")) {
          return <h2 key={idx} className="text-lg font-black text-slate-900 border-l-4 border-indigo-600 pl-3 py-1 my-4 bg-indigo-50/50 rounded-r-xl">{trimmed.replace("# ", "")}</h2>;
        }

        // Bullet points
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          const itemText = trimmed.substring(2);
          // Highlight bold key-values
          return (
            <li key={idx} className="list-disc list-inside ml-2 pl-1 text-slate-600 font-medium">
              {parseBoldText(itemText)}
            </li>
          );
        }

        // Numbered list
        if (/^\d+\.\s/.test(trimmed)) {
          const itemText = trimmed.replace(/^\d+\.\s/, "");
          const matchNum = trimmed.match(/^\d+/);
          const num = matchNum ? matchNum[0] : "1";
          return (
            <div key={idx} className="flex gap-2.5 items-start ml-2 text-slate-600">
              <span className="font-bold text-indigo-600 text-xs shrink-0 mt-0.5 bg-indigo-50 w-5 h-5 rounded-full flex items-center justify-center">{num}</span>
              <p className="flex-1 font-medium">{parseBoldText(itemText)}</p>
            </div>
          );
        }

        // Blank lines
        if (!trimmed) {
          return <div key={idx} className="h-2"></div>;
        }

        // Normal text line
        return <p key={idx} className="font-medium text-slate-600 text-[13px]">{parseBoldText(trimmed)}</p>;
      })}
    </div>
  );
}

// Inline parser to render bold strings like **Teks**
function parseBoldText(text: string) {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      return <strong key={index} className="font-bold text-slate-800 bg-indigo-50/70 px-1 rounded text-xs">{part}</strong>;
    }
    return part;
  });
}

export default function Home() {
  const { user, loading: authLoading, loginWithGoogle, logout } = useAuth();
  
  // Custom states for login UI
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [mounted, setMounted] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isDbLoading, setIsDbLoading] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isSavingManual, setIsSavingManual] = useState(false);
  const isSyncing = isSavingAll || isSavingManual || isResetting;
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("semua");
  const [selectedType, setSelectedType] = useState<string>("semua");

  // Multi-item preview parser modal
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [parsedPreviewItems, setParsedPreviewItems] = useState<Omit<Transaction, "id" | "tanggal">[]>([]);

  // Manual transaction addition
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualItem, setManualItem] = useState("");
  const [manualNominal, setManualNominal] = useState("");
  const [manualJenis, setManualJenis] = useState<"pengeluaran" | "pemasukan">("pengeluaran");
  const [manualKategori, setManualKategori] = useState<"makanan" | "transportasi" | "tagihan" | "hiburan" | "pendapatan" | "lainnya">("makanan");

  // Deletion interaction confirmation
  const [itemToDelete, setItemToDelete] = useState<Transaction | null>(null);

  // Logout confirmation modal state
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // AI Financial Advisor Report modal
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [isLoadingReview, setIsLoadingReview] = useState(false);
  const [aiReviewText, setAiReviewText] = useState<string | null>(null);

  // 1. Mount effect to enable rendering & load local cache asynchronously
  useEffect(() => {
    const handler = setTimeout(() => {
      setMounted(true);
      if (!user) {
        const stored = localStorage.getItem("pintar_keuangan_txs");
        if (stored) {
          try {
            setTransactions(JSON.parse(stored));
          } catch (err) {
            setTransactions(INITIAL_TRANSACTIONS);
          }
        } else {
          setTransactions(INITIAL_TRANSACTIONS);
        }
      }
    }, 10);
    return () => clearTimeout(handler);
  }, [user]);

  // 2. Activated Real-Time Firebase Synchronization for active user session
  useEffect(() => {
    if (!mounted) return;

    if (!user) {
      setIsDbLoading(false);
      return;
    }

    // Clear previous sessions or older transaction datasets immediately
    setTransactions([]);
    setIsDbLoading(true);

    const q = query(
      collection(db, "transactions"),
      where("userId", "==", user.uid),
      orderBy("tanggal", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const dbTxs: Transaction[] = [];
      snapshot.forEach((snapDoc) => {
        const d = snapDoc.data();
        dbTxs.push({
          id: snapDoc.id,
          jenis: d.jenis as "pengeluaran" | "pemasukan",
          item: d.item,
          nominal: d.nominal,
          kategori: d.kategori as any,
          tanggal: d.tanggal
        });
      });
      setTransactions(dbTxs);
      setIsDbLoading(false);
    }, (err) => {
      setIsDbLoading(false);
      handleFirestoreError(err, OperationType.LIST, "transactions");
    });

    return () => unsubscribe();
  }, [user, mounted]);

  // Update storage whenever transactions change (offline fallback only)
  const saveTransactions = (updated: Transaction[]) => {
    setTransactions(updated);
    if (typeof window !== "undefined") {
      localStorage.setItem("pintar_keuangan_txs", JSON.stringify(updated));
    }
  };

  // UI Auth Loading Spinner
  if (!mounted || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F1F5F9] text-indigo-600">
        <div className="flex flex-col items-center gap-4 bg-white p-8 rounded-3xl shadow-xl border border-slate-100 max-w-[320px] text-center">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          <div>
            <p className="font-display font-bold text-sm tracking-wide text-slate-800">Menghubungkan Akun...</p>
            <p className="text-[10px] text-slate-400 mt-1">Mengamankan enkripsi kredensial keuangan Anda</p>
          </div>
        </div>
      </div>
    );
  }

  // Submit AI sentence extractor
  const handleAISubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "extract",
          payload: inputText.trim()
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Gagal menghubungi modul server AI.");
      }

      const parsedData = result.data;
      if (Array.isArray(parsedData) && parsedData.length > 0) {
        setParsedPreviewItems(parsedData);
        setShowPreviewModal(true);
      } else {
        throw new Error("Sistem AI gagal mendeteksi adanya transaksi terstruktur dari kalimat Anda. Coba tuliskan nominal denga jelas (contoh: membeli sayur 10 ribu atau dapet bonus 100000).");
      }
    } catch (err: any) {
      setError(err.message || "Gagal menghubungkan sistem AI.");
    } finally {
      setIsLoading(false);
    }
  };

  // Launch AI Advisor review process
  const handleAIAdvisorReview = async () => {
    setIsLoadingReview(true);
    setAiReviewText(null);
    setShowReviewModal(true);
    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "review",
          payload: transactions
        })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Gagal mendapatkan respons ulasan AI.");
      }
      setAiReviewText(result.text);
    } catch (err: any) {
      setAiReviewText(`### Gagal Memproses Laporan\n\n${err.message || "Terjadi kesalahan koneksi saat memanggil asisten cerdas."}`);
    } finally {
      setIsLoadingReview(false);
    }
  };

  // Confirm and save parsed preview items
  const handleConfirmAddAll = async () => {
    const todayStr = new Date().toISOString().split("T")[0];
    const itemsToSave = [...parsedPreviewItems];

    // Close modal instantly and clear preview state
    setShowPreviewModal(false);
    setParsedPreviewItems([]);
    setInputText("");

    if (itemsToSave.length === 0) return;

    if (user) {
      setIsSavingAll(true);
      setError(null);
      try {
        const baseTime = Date.now();
        const promises = itemsToSave.map((item, i) => {
          const txId = `tx-ai-${baseTime}-${i}`;
          return setDoc(doc(db, "transactions", txId), {
            id: txId,
            userId: user.uid,
            jenis: item.jenis,
            item: item.item || "Barang Tanpa Nama",
            nominal: Math.round(item.nominal),
            kategori: item.kategori || "lainnya",
            tanggal: todayStr
          });
        });
        await Promise.all(promises);
      } catch (err: any) {
        setError(err.message || "Gagal menyimpan beberapa transaksi ke Firestore.");
      } finally {
        setIsSavingAll(false);
      }
    } else {
      const baseTime = Date.now();
      const freshTransactions: Transaction[] = itemsToSave.map((item, index) => ({
        id: `tx-ai-${baseTime}-${index}`,
        jenis: item.jenis,
        item: item.item || "Barang Tanpa Nama",
        nominal: item.nominal,
        kategori: item.kategori || "lainnya",
        tanggal: todayStr
      }));

      const updatedList = [...freshTransactions, ...transactions];
      saveTransactions(updatedList);
    }
  };

  // Confirm item deletion
  const handleConfirmDelete = async () => {
    if (itemToDelete) {
      const tempItem = itemToDelete;
      // Close the delete modal immediately
      setItemToDelete(null);

      if (user) {
        try {
          await deleteDoc(doc(db, "transactions", tempItem.id));
        } catch (err: any) {
          setError("Gagal menghapus transaksi dari Firestore.");
        }
      } else {
        const remaining = transactions.filter(t => t.id !== tempItem.id);
        saveTransactions(remaining);
      }
    }
  };

  // Reset entire transaction log
  const handleResetHistory = async () => {
    const isConfirmed = confirm("Apakah Anda yakin ingin menghapus seluruh catatan transaksi keuangan?");
    if (isConfirmed) {
      if (user) {
        setIsResetting(true);
        setError(null);
        try {
          const deletePromises = transactions.map(t => deleteDoc(doc(db, "transactions", t.id)));
          await Promise.all(deletePromises);
        } catch (err: any) {
          setError("Gagal mereset semua data di Firestore.");
        } finally {
          setIsResetting(false);
        }
      } else {
        saveTransactions([]);
      }
      setSearchQuery("");
      setSelectedCategory("semua");
      setSelectedType("semua");
    }
  };

  // Manual submission handler
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualItem.trim() || !manualNominal) {
      alert("Harap isi semua kolom.");
      return;
    }

    const value = parseInt(manualNominal.replace(/\D/g, ""), 10);
    if (isNaN(value) || value <= 0) {
      alert("Nominal harus berupa angka positif.");
      return;
    }

    const txId = `tx-manual-${Date.now()}`;
    const todayStr = new Date().toISOString().split("T")[0];

    const itemToSave = manualItem;
    const nominalToSave = value;
    const jenisToSave = manualJenis;
    const kategoriToSave = manualKategori;

    // Reset manual form fields and close popup immediately
    setShowManualForm(false);
    setManualItem("");
    setManualNominal("");
    setManualJenis("pengeluaran");
    setManualKategori("makanan");

    if (user) {
      setIsSavingManual(true);
      try {
        await setDoc(doc(db, "transactions", txId), {
          id: txId,
          userId: user.uid,
          jenis: jenisToSave,
          item: itemToSave,
          nominal: nominalToSave,
          kategori: kategoriToSave,
          tanggal: todayStr
        });
      } catch (err: any) {
        alert("Gagal menambahkan transaksi.");
      } finally {
        setIsSavingManual(false);
      }
    } else {
      const newTx: Transaction = {
        id: txId,
        jenis: jenisToSave,
        item: itemToSave,
        nominal: nominalToSave,
        kategori: kategoriToSave,
        tanggal: todayStr
      };

      saveTransactions([newTx, ...transactions]);
    }
  };

  // Compute stats totals
  const totalIncome = transactions
    .filter(t => t.jenis === "pemasukan")
    .reduce((acc, curr) => acc + curr.nominal, 0);

  const totalExpense = transactions
    .filter(t => t.jenis === "pengeluaran")
    .reduce((acc, curr) => acc + curr.nominal, 0);

  const currentBalance = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : 0;

  // Category statistics helper
  const categorySummary = transactions
    .filter(t => t.jenis === "pengeluaran")
    .reduce((acc, curr) => {
      acc[curr.kategori] = (acc[curr.kategori] || 0) + curr.nominal;
      return acc;
    }, {} as Record<string, number>);

  const sortedCategories = Object.keys(categorySummary)
    .map(key => ({
      category: key,
      total: categorySummary[key],
      pct: totalExpense > 0 ? (categorySummary[key] / totalExpense) * 100 : 0
    }))
    .sort((a, b) => b.total - a.total);

  // Filter transactions based on active triggers
  const filteredTransactions = transactions.filter(t => {
    const matchesSearch = t.item.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "semua" || t.kategori === selectedCategory;
    const matchesType = selectedType === "semua" || t.jenis === selectedType;
    return matchesSearch && matchesCategory && matchesType;
  });

  // Render beautiful auth page if no active user session
  if (!user) {
    return (
      <div className="relative min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-indigo-50/30 font-sans text-slate-700 flex items-center justify-center p-4 sm:p-8" id="pintar-root-div">
        {/* Decorative subtle ambient background blobs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-200/40 rounded-full blur-3xl pointer-events-none -translate-x-1/2 -translate-y-1/2"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-100/30 rounded-full blur-3xl pointer-events-none translate-x-1/2 translate-y-1/2"></div>
        
        <div className="relative w-full max-w-md md:max-w-5xl md:min-h-[660px] bg-white border border-slate-200/80 flex flex-col md:flex-row shadow-[0_32px_80px_rgba(15,23,42,0.08)] overflow-hidden rounded-3xl transition-all duration-300" id="auth-viewport-frame">
          
          {/* Left Pane: Decorative dashboard features for desktop view */}
          <div className="hidden md:flex md:w-1/2 p-12 bg-indigo-950 text-white flex-col justify-between relative overflow-hidden select-none" id="auth-decor-pane">
            {/* Ambient gradients */}
            <div className="absolute top-0 right-0 p-12 w-80 h-80 bg-gradient-to-br from-indigo-500/20 to-purple-500/15 rounded-full blur-3xl pointer-events-none"></div>
            <div className="absolute -bottom-10 -left-10 p-12 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none"></div>
            
            {/* Logo */}
            <div className="flex items-center gap-3.5 relative z-10">
              <div className="p-2.5 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 shadow-lg shadow-white/5">
                <Sparkles className="w-5 h-5 text-indigo-300" />
              </div>
              <div>
                <h2 className="font-display font-black text-xl leading-none tracking-tight text-white">KeuanganPintar</h2>
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[9px] text-emerald-300 font-bold uppercase tracking-wider mt-1.5">
                  <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse"></span>
                  Asisten AI Aktif
                </div>
              </div>
            </div>

            {/* Feature lists designed as modern card-pills */}
            <div className="space-y-6 my-auto max-w-sm relative z-10">
              <h3 className="font-display font-semibold text-[26px] leading-tight text-white tracking-tight">
                Mencatat keuangan semudah mengirim pesan obrolan.
              </h3>
              
              <div className="space-y-4 text-xs font-light text-slate-300">
                <div className="flex items-start gap-4 p-3 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-colors">
                  <div className="w-6 h-6 rounded-full bg-indigo-550 border border-indigo-400 text-white flex items-center justify-center shrink-0 font-bold text-[10px] shadow-sm">1</div>
                  <div className="flex-1">
                    <p className="font-bold text-white text-[13px] tracking-tight">Ekstraksi Pintar AI</p>
                    <p className="mt-1 leading-relaxed text-slate-300 text-[11px]">Cukup ketik kalimat bebas. AI akan langsung mengurai item, jenis, nominal, dan kategori secara tepat.</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4 p-3 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-colors">
                  <div className="w-6 h-6 rounded-full bg-indigo-550 border border-indigo-400 text-white flex items-center justify-center shrink-0 font-bold text-[10px] shadow-sm">2</div>
                  <div className="flex-1">
                    <p className="font-bold text-white text-[13px] tracking-tight">Sinkronisasi Cloud Aman</p>
                    <p className="mt-1 leading-relaxed text-slate-300 text-[11px]">Seluruh database disimpan rapi di Firebase Firestore, tersinkronisasi murni lintas semua peranti Anda.</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4 p-3 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-colors">
                  <div className="w-6 h-6 rounded-full bg-indigo-550 border border-indigo-400 text-white flex items-center justify-center shrink-0 font-bold text-[10px] shadow-sm">3</div>
                  <div className="flex-1">
                    <p className="font-bold text-white text-[13px] tracking-tight">Review Advisor AI</p>
                    <p className="mt-1 leading-relaxed text-slate-300 text-[11px]">Konsultasikan statistik keuangan Anda kapan pun dengan kecerdasan buatan untuk merangkum pola konsumsi bulanan.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer credentials */}
            <div className="text-[10px] text-slate-400 flex items-center gap-1.5 relative z-10">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse-slow"></span>
              <span>© 2026 KeuanganPintar • Enkripsi SSL Keamanan Tinggi</span>
            </div>
          </div>

          {/* Right Pane: Interactive Auth Login Only Google Container */}
          <div className="w-full md:w-1/2 p-6 sm:p-12 flex flex-col justify-between bg-white" id="auth-form-pane">
            
            {/* Branding header on Mobile */}
            <div className="flex md:hidden items-center justify-between border-b pb-4 border-slate-100 mb-4" id="auth-mobile-header">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-indigo-600 animate-pulse-slow" />
                </div>
                <div>
                  <h1 className="font-display font-black text-sm text-slate-800 tracking-tight">KeuanganPintar</h1>
                  <p className="text-[8px] text-slate-450 font-bold uppercase tracking-widest leading-none mt-0.5">Sistem Catat AI Aman</p>
                </div>
              </div>
              <div className="px-2 py-0.5 rounded-full bg-indigo-50 text-[9px] font-bold text-indigo-600">
                PRO v1.2
              </div>
            </div>

            <div className="my-auto space-y-8 py-8 px-2" id="auth-interactive-body">
              <div className="space-y-3.5 text-center md:text-left">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-100/60 text-[10px] text-emerald-700 font-bold mb-1">
                  🔒 Keamanan Cloud Terjamin
                </div>
                <h3 className="font-display font-black text-3.5xl text-slate-800 tracking-tight leading-none">
                  Masuk ke Akun Anda
                </h3>
                <p className="text-xs text-slate-500 font-normal leading-relaxed max-w-sm">
                  Kelola, analisis, dan sinkronkan seluruh catatan keuangan pintar Anda menggunakan otentikasi Google yang aman.
                </p>
              </div>

              {/* Error Display */}
              {authError && (
                <div className="p-3.5 bg-rose-50 border border-rose-150 rounded-2xl text-xs text-rose-700 font-medium flex items-start gap-2.5 shadow-sm animate-fade-in" id="auth-error-block">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <span className="flex-1 leading-relaxed">{authError}</span>
                  <button onClick={() => setAuthError(null)} className="text-rose-450 hover:text-rose-600 p-0.5 hover:bg-rose-100 rounded transition-colors self-start">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Unique Prominent Google Button */}
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={async () => {
                    setAuthActionLoading(true);
                    setAuthError(null);
                    try {
                      await loginWithGoogle();
                    } catch (err: any) {
                      setAuthError(err.message || "Gagal masuk menggunakan Google popup.");
                    } finally {
                      setAuthActionLoading(false);
                    }
                  }}
                  disabled={authActionLoading}
                  className="w-full py-4 px-5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-xs rounded-2xl transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-3 shadow-lg shadow-slate-900/10 cursor-pointer"
                  id="btn-google-auth"
                >
                  {authActionLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Menghubungkan layanan Google...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                        <path fill="#EA4335" d="M12 5.04c1.65 0 3.13.57 4.3 1.69l3.22-3.22C17.56 1.84 14.99 1 12 1 7.35 1 3.39 3.65 1.51 7.5l3.86 3C6.28 7.57 8.91 5.04 12 5.04z" />
                        <path fill="#4285F4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.35H12v4.51h6.46c-.29 1.48-1.14 2.73-2.4 3.58l3.73 2.89c2.18-2.01 3.7-4.97 3.7-8.63z" />
                        <path fill="#FBBC05" d="M5.37 13.92c-.24-.72-.37-1.49-.37-2.28s.13-1.56.37-2.28V6.36H1.51C.55 8.28 0 10.42 0 12.68s.55 4.4 1.51 6.32l3.86-3.08z" />
                        <path fill="#34A853" d="M12 23c3.24 0 5.97-1.07 7.96-2.91l-3.73-2.89c-1.1.74-2.51 1.18-4.23 1.18-3.09 0-5.72-2.53-6.63-5.46l-3.86 3C3.39 19.85 7.35 23 12 23z" />
                      </svg>
                      <span>Masuk atau Daftar dengan Google</span>
                    </>
                  )}
                </button>

                <p className="text-[10px] text-slate-400 font-normal leading-relaxed text-center max-w-xs mx-auto">
                  KeuanganPintar menggunakan otentikasi Google OAuth berstandar tinggi. Kami tidak pernah melihat atau menyimpan kata sandi Google Anda.
                </p>
              </div>
            </div>

          </div>

        </div>
      </div>
    );
  }

  // Category visual icons map helper
  const getCategoryIcon = (kat: string) => {
    switch (kat) {
      case "makanan":
        return <Utensils className="w-4 h-4 text-emerald-600" />;
      case "transportasi":
        return <Car className="w-4 h-4 text-blue-600" />;
      case "tagihan":
        return <Receipt className="w-4 h-4 text-amber-600" />;
      case "hiburan":
        return <Tv className="w-4 h-4 text-purple-600" />;
      case "pendapatan":
        return <TrendingUp className="w-4 h-4 text-indigo-600" />;
      default:
        return <Tag className="w-4 h-4 text-slate-500" />;
    }
  };

  const getCategoryBadgeClass = (kat: string) => {
    switch (kat) {
      case "makanan":
        return "bg-emerald-50 text-emerald-800 border-emerald-100";
      case "transportasi":
        return "bg-blue-50 text-blue-800 border-blue-100";
      case "tagihan":
        return "bg-amber-50 text-amber-800 border-amber-100";
      case "hiburan":
        return "bg-purple-50 text-purple-800 border-purple-100";
      case "pendapatan":
        return "bg-indigo-50 text-indigo-800 border-indigo-100";
      default:
        return "bg-slate-50 text-slate-800 border-slate-100";
    }
  };

  return (
    <div className="relative min-h-screen bg-[#F1F5F9] font-sans text-slate-700 flex flex-col items-center justify-start p-0 sm:py-6" id="pintar-root-div">
      
      {/* Top Banner Branding / Navbar header */}
      <header className="w-full max-w-6xl bg-white border border-slate-150 px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 shadow-sm sm:rounded-3xl mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-indigo-550 text-white flex items-center justify-center shadow-md bg-indigo-600">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display font-black text-lg text-slate-800 tracking-tight leading-none">KeuanganPintar</h1>
            <p className="text-[9px] text-slate-400 font-bold tracking-widest uppercase mt-1 flex items-center gap-1">
              {isSyncing ? (
                <span className="w-1.5 h-1.5 rounded-full border border-indigo-550 border-t-transparent animate-spin inline-block shrink-0"></span>
              ) : (
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shrink-0"></span>
              )}
              {isSyncing ? "Mensinkronisasi Data..." : "Pencatat Keuangan AI • Terhubung"}
            </p>
          </div>
        </div>

        {/* User context information details & Logout handling */}
        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200/80 p-2 pl-3 pr-2 rounded-2xl hover:border-indigo-150 transition-colors">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs select-none shadow-xs">
              {user?.email?.charAt(0).toUpperCase() || "U"}
            </div>
            <div className="text-left hidden md:block">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none">Pengguna Aktif</p>
              <p className="text-xs font-bold text-slate-700 mt-1 max-w-[150px] truncate" title={user?.email || ""}>{user?.email}</p>
            </div>
          </div>
          <button
            onClick={() => setShowLogoutModal(true)}
            className="px-3.5 py-1.5 bg-rose-50 text-rose-700 hover:text-white hover:bg-rose-600 border border-rose-100 hover:border-rose-600 rounded-xl transition-all duration-200 shadow-sm flex items-center gap-1.5 text-xs font-bold group cursor-pointer active:scale-95"
            id="btn-header-logout"
            title="Keluar dari akun cloud"
          >
            <LogOut className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            <span>Keluar</span>
          </button>
        </div>
      </header>

      {/* Main Grid Content Panels Layout */}
      <main className="w-full max-w-6xl px-0 sm:px-4 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* LEFT COLUMN PANEL: AI INPUT, SUMMARY STATS, AND ALLOCATION BAR CHART */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* AI Sentences Core Parser Tool Form box */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <div className="flex justify-between items-start gap-4">
              <div>
                <h3 className="font-display font-extrabold text-sm text-slate-800 tracking-tight flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  Ketik Catatan Keuangan Anda (AI Extractor)
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Asisten AI kami akan otomatis membedah tulisan Anda secara cerdas.</p>
              </div>

              {/* Reset database button */}
              <button
                onClick={handleResetHistory}
                className="text-[10px] font-bold text-slate-450 hover:text-rose-500 bg-slate-50 hover:bg-rose-50 border border-slate-200 px-2.5 py-1.5 rounded-xl transition-colors cursor-pointer hover:border-rose-200"
              >
                Hapus Semua Data
              </button>
            </div>

            {/* Error notifications */}
            {error && (
              <div className="p-3 bg-amber-50 border border-amber-150 rounded-2xl text-xs text-amber-700 flex items-start gap-2 animate-pulse">
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="flex-1 font-medium">{error}</p>
                <button onClick={() => setError(null)} className="font-bold hover:text-amber-900 ml-1">×</button>
              </div>
            )}

            <form onSubmit={handleAISubmit} className="space-y-3">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Contoh: 'Kemarin beli pulsa 50rb di minimarket, dikasih uang jajan sama ibu 200rb, tadi malam makan seblak 15rb'"
                rows={3}
                disabled={isLoading}
                className="w-full text-xs font-medium p-4 bg-slate-550/10 border border-slate-200 rounded-2xl outline-none focus:border-indigo-650 focus:ring-1 focus:ring-indigo-100 bg-slate-50 text-slate-800 resize-none placeholder-slate-400 transition-all font-sans leading-relaxed"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isLoading || !inputText.trim()}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-2xl shadow-md cursor-pointer transition-all active:scale-98 flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Sedang Dianalisis oleh AI...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      Ekstrak Otomatis via AI
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setShowManualForm(true)}
                  className="px-4 py-3 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-2xl transition-all cursor-pointer flex items-center gap-1.5 active:scale-98"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Tambah Manual
                </button>
              </div>
            </form>
          </div>

          {/* FINANCIAL TOTAL STATS STRIP BANNER ARRAYS */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            
            {/* Wallet Savings Balance */}
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3 flex flex-col justify-between">
              <div className="flex justify-between items-center">
                <div className="p-2 rounded-2xl bg-indigo-50 border border-indigo-100">
                  <Wallet className="w-4 h-4 text-indigo-600" />
                </div>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${currentBalance >= 0 ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-rose-50 text-rose-700 border-rose-100"}`}>
                  Sisa Bersih
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-450 uppercase tracking-widest block">Sisa Saldo</span>
                <strong className={`font-display text-lg font-black tracking-tight block ${currentBalance >= 0 ? "text-slate-800" : "text-rose-600"}`}>
                  {formatIDR(currentBalance)}
                </strong>
              </div>
            </div>

            {/* Total Income */}
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3 flex flex-col justify-between">
              <div className="flex justify-between items-center">
                <div className="p-2 rounded-2xl bg-emerald-50 border border-emerald-100">
                  <ArrowUpRight className="w-4 h-4 text-emerald-600" />
                </div>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-50 border border-slate-150 text-slate-500">
                  Pemasukan
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-450 uppercase tracking-widest block">Total Masuk</span>
                <strong className="font-display text-lg font-black tracking-tight text-emerald-600 block">
                  {formatIDR(totalIncome)}
                </strong>
              </div>
            </div>

            {/* Total Expense */}
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3 flex flex-col justify-between">
              <div className="flex justify-between items-center">
                <div className="p-2 rounded-2xl bg-rose-50 border border-rose-100">
                  <ArrowDownRight className="w-4 h-4 text-rose-600" />
                </div>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-50 border border-slate-150 text-slate-500">
                  Pengeluaran
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-450 uppercase tracking-widest block">Total Keluar</span>
                <strong className="font-display text-lg font-black tracking-tight text-rose-600 block">
                  {formatIDR(totalExpense)}
                </strong>
              </div>
            </div>

          </div>

          {/* AI ADVISOR CONSULTANT BANNER TRIGGER BUTTON */}
          <div className="bg-gradient-to-tr from-indigo-850 to-indigo-650 bg-indigo-900 border border-indigo-950 text-white rounded-3xl p-5 shadow-lg flex flex-col sm:flex-row justify-between items-center gap-4 relative overflow-hidden select-none">
            <div className="absolute top-0 right-0 p-8 w-40 h-40 bg-white/5 rounded-full blur-2xl pointer-events-none"></div>
            <div className="space-y-1.5 text-center sm:text-left z-10">
              <h4 className="font-display font-extrabold text-sm text-white flex items-center justify-center sm:justify-start gap-1.5">
                <MessageSquareCode className="w-4 h-4 text-indigo-300 animate-pulse" />
                Ingin Ulasan Keuangan Mendalam?
              </h4>
              <p className="text-[10px] text-indigo-200 max-w-sm">Evaluasi rasio pemasukan dan alokasi dana secara langsung dengan bantuan Konsultan AI Pribadi Anda.</p>
            </div>
            
            <button
              onClick={handleAIAdvisorReview}
              className="px-5 py-2.5 bg-white text-indigo-900 hover:bg-indigo-50 font-black text-xs rounded-2xl shadow-md transition-all cursor-pointer active:scale-95 flex items-center gap-1 shrink-0 z-10"
              id="btn-trigger-review"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              Minta Analisis Keuangan AI
            </button>
          </div>

          {/* DECORATIVE PORTION ALLOCATION TRACKER */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <div>
              <h3 className="font-display font-extrabold text-sm text-slate-800 tracking-tight">Alokasi Kas Keluar per Kategori</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Analisis bagian pengeluaran dana berdasarkan nominal.</p>
            </div>

            {sortedCategories.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                Belum ada pengeluaran tercatat untuk mengalkulasi visualisasi diagram alokasi.
              </div>
            ) : (
              <div className="space-y-3">
                {sortedCategories.map((cat, idx) => (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-700 capitalize flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-200 flex items-center justify-center">{getCategoryIcon(cat.category)}</span>
                        {cat.category}
                      </span>
                      <div className="text-right">
                        <span className="font-display font-bold text-slate-800">{formatIDR(cat.total)} </span>
                        <strong className="text-[10px] text-indigo-600 font-bold ml-1.5">({cat.pct.toFixed(1)}%)</strong>
                      </div>
                    </div>
                    {/* Linear responsive color progress bar */}
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        style={{ width: `${cat.pct}%` }}
                        className={`h-full rounded-full transition-all duration-500 ${
                          cat.category === "makanan" ? "bg-emerald-500" :
                          cat.category === "transportasi" ? "bg-blue-500" :
                          cat.category === "tagihan" ? "bg-amber-500" :
                          cat.category === "hiburan" ? "bg-purple-500" : "bg-slate-400"
                        }`}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* RIGHT COLUMN PANEL: INTERACTIVE TRANSACTION FILTER AND STREAM LINE FEED */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Filters & Transaction Log Feed container */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-display font-black text-sm text-slate-800 tracking-tight">Daftar Transaksi</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Daftar murni transaksi yang terekam.</p>
              </div>
              <div className="text-right sm:text-right shrink-0">
                <span className="text-[9px] font-bold text-slate-450 uppercase tracking-widest block">Total Rekaman</span>
                <strong className="font-display font-black text-indigo-600 text-xs mt-0.5 block">{filteredTransactions.length} dari {transactions.length} Item</strong>
              </div>
            </div>

            {/* Quick search input field */}
            <div className="space-y-2.5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cari deskripsi item..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 focus:bg-white border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 outline-none rounded-xl text-xs font-semibold text-slate-800 transition-all placeholder-slate-400"
                />
              </div>

              {/* Advanced category filters and jenis picker */}
              <div className="grid grid-cols-2 gap-2 text-[10px] font-bold">
                <div className="space-y-1">
                  <label className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400 block pl-0.5">Kategori</label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl outline-none text-slate-700 font-bold transition-all"
                  >
                    <option value="semua">Semua Kategori</option>
                    <option value="makanan">Makanan</option>
                    <option value="transportasi">Transportasi</option>
                    <option value="tagihan">Tagihan</option>
                    <option value="hiburan">Hiburan</option>
                    <option value="pendapatan">Pendapatan</option>
                    <option value="lainnya">Lainnya</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400 block pl-0.5">Aliran Kas</label>
                  <select
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl outline-none text-slate-700 font-bold transition-all"
                  >
                    <option value="semua">Semua Arus</option>
                    <option value="pengeluaran">Pengeluaran</option>
                    <option value="pemasukan">Pemasukan</option>
                  </select>
                </div>
              </div>
            </div>

            {/* List Feed */}
            {isDbLoading ? (
              <div className="space-y-3 py-10 text-center bg-slate-50 border border-dashed border-slate-150 rounded-2xl">
                <div className="relative w-8 h-8 mx-auto">
                  <div className="absolute inset-0 rounded-full border-2 border-slate-100"></div>
                  <div className="absolute inset-0 rounded-full border-2 border-t-indigo-600 animate-spin"></div>
                </div>
                <p className="text-[11px] text-slate-500 font-bold">Sinkronisasi data cloud...</p>
                <p className="text-[9px] text-slate-400">Mengamankan enkripsi transaksi Anda</p>
              </div>
            ) : filteredTransactions.length === 0 ? (
              <div className="text-center py-12 px-6 border border-dashed border-slate-150 rounded-2xl bg-slate-500/5">
                <p className="text-xs text-slate-450 font-bold">Tidak Menemukan Transaksi</p>
                <p className="text-[10px] text-slate-400 mt-1 max-w-[200px] mx-auto">Sesuaikan filter pencarian atau tulis catatan transaksi baru via asisten AI.</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
                {filteredTransactions.map((tx) => (
                  <div 
                    key={tx.id} 
                    className="bg-slate-50 hover:bg-slate-100 border border-slate-150 rounded-2xl p-3 flex justify-between items-center gap-3 transition-all hover:shadow-xs group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-white border border-slate-200 rounded-xl flex items-center justify-center shadow-xs">
                        {getCategoryIcon(tx.kategori)}
                      </div>
                      <div className="space-y-0.5">
                        <h4 className="text-xs font-extrabold text-slate-800 leading-none capitalize">{tx.item}</h4>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded border capitalize ${getCategoryBadgeClass(tx.kategori)}`}>
                            {tx.kategori}
                          </span>
                          <span className="text-[8.5px] text-slate-400 font-mono flex items-center gap-0.5">
                            <Calendar className="w-2.5 h-2.5" />
                            {tx.tanggal}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <strong className={`font-display text-xs font-black tracking-tight ${tx.jenis === "pemasukan" ? "text-emerald-600" : "text-slate-850"}`}>
                        {tx.jenis === "pemasukan" ? "+" : "-"}{formatIDR(tx.nominal)}
                      </strong>

                      {/* Trash action */}
                      <button
                        onClick={() => setItemToDelete(tx)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100 duration-150 cursor-pointer"
                        title="Hapus item"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </main>

      {/* FOOTER SYSTEM DESIGN LINES */}
      <footer className="w-full max-w-6xl mt-12 py-6 border-t border-slate-200 text-center space-y-2 select-none px-4">
        <p className="text-[10px] text-slate-450 font-bold uppercase tracking-widest flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          Arsitektur Terenkripsi SSL dengan Database Awan Kriptografis
        </p>
        <p className="text-[9px] text-slate-400 font-bold">Aplikasi Pencatat Keuangan Pintar AI didukung oleh Firebase Firestore & Gemini 2.5 Flash.</p>
      </footer>

      {/* MODAL SECTION 1: MANUAL TRANSACTION CREATOR OVERLAY */}
      {showManualForm && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowManualForm(false);
          }}
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in animate-duration-150"
        >
          <div className="bg-white border border-slate-250 rounded-3xl w-full max-w-sm p-6 shadow-2xl relative space-y-4" id="modal-manual-tx">
            <button 
              onClick={() => setShowManualForm(false)}
              className="absolute top-4 right-4 p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-500 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div>
              <h3 className="font-display font-black text-sm text-slate-800 tracking-tight flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-indigo-600" />
                Catat Transaksi Manual
              </h3>
              <p className="text-[10px] text-slate-400">Silakan masukkan data transaksi keuangan secara terperinci.</p>
            </div>

            <form onSubmit={handleManualSubmit} className="space-y-3.5">
              
              {/* Jenis picker */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Tipe Aliran Kas</label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setManualJenis("pengeluaran");
                      if (manualKategori === "pendapatan") setManualKategori("makanan");
                    }}
                    className={`py-2 px-3 border rounded-xl font-bold transition-all text-center ${manualJenis === "pengeluaran" ? "bg-slate-800 border-slate-800 text-white shadow-sm" : "bg-white border-slate-200 text-slate-650 hover:bg-slate-50"}`}
                  >
                    Pengeluaran
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setManualJenis("pemasukan");
                      setManualKategori("pendapatan");
                    }}
                    className={`py-2 px-3 border rounded-xl font-bold transition-all text-center ${manualJenis === "pemasukan" ? "bg-indigo-600 border-indigo-600 text-white shadow-sm" : "bg-white border-slate-200 text-slate-650 hover:bg-slate-50"}`}
                  >
                    Pemasukan
                  </button>
                </div>
              </div>

              {/* Item Description Name */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Deskripsi Barang/Jasa</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Makan siang nasi goreng"
                  value={manualItem}
                  onChange={(e) => setManualItem(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-250 focus:bg-white focus:border-indigo-500 outline-none rounded-xl text-xs text-slate-800 font-semibold transition-colors"
                />
              </div>

              {/* Nominal Price */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Nominal (Rupiah)</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: 15.000"
                  value={manualNominal}
                  onChange={(e) => {
                    // Stripping non-numbers and format dynamically
                    const digits = e.target.value.replace(/\D/g, "");
                    if (digits) {
                      setManualNominal(new Intl.NumberFormat("id-ID").format(parseInt(digits, 10)));
                    } else {
                      setManualNominal("");
                    }
                  }}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-250 focus:bg-white focus:border-indigo-500 outline-none rounded-xl text-xs text-slate-800 font-semibold transition-colors font-mono"
                />
              </div>

              {/* Kategori list */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Kategori Alokasi</label>
                <select
                  value={manualKategori}
                  onChange={(e) => setManualKategori(e.target.value as any)}
                  disabled={manualJenis === "pemasukan"}
                  className="w-full p-2 bg-slate-50 border border-slate-250 focus:border-indigo-500 rounded-xl outline-none text-xs text-slate-750 font-bold transition-all disabled:opacity-50"
                >
                  <option value="makanan">Makanan</option>
                  <option value="transportasi">Transportasi</option>
                  <option value="tagihan">Tagihan</option>
                  <option value="hiburan">Hiburan</option>
                  <option value="pendapatan" disabled={manualJenis === "pengeluaran"}>Pendapatan (Hanya Pemasukan)</option>
                  <option value="lainnya">Lainnya</option>
                </select>
              </div>

              <button
                type="submit"
                className="w-full python-btn-color py-3 text-xs text-white bg-indigo-600 hover:bg-indigo-700 font-bold rounded-xl shadow-md transition-all active:scale-95 cursor-pointer mt-4 text-center"
              >
                Simpan Transaksi Masuk/Keluar
              </button>

            </form>
          </div>
        </div>
      )}

      {/* MODAL SECTION 2: AI BATCH PREVIEW EDIT DIALOG IN INDONESIAN */}
      {showPreviewModal && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setParsedPreviewItems([]);
              setShowPreviewModal(false);
            }
          }}
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in animate-duration-150"
        >
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-lg p-5 sm:p-6 shadow-2xl relative space-y-4" id="modal-ai-preview">
            
            <div>
              <h3 className="font-display font-black text-sm text-slate-800 tracking-tight flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                Konfirmasi Ekstraksi Pencatatan AI
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Silakan periksa, edit detail deskripsi, kategori, atau nominal sebelum dimasukkan ke database murni.</p>
            </div>

            {/* List and editable input parameters */}
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {parsedPreviewItems.map((item, index) => (
                <div key={index} className="bg-slate-50 border border-slate-200 p-3 rounded-2xl space-y-2.5">
                   <div className="flex gap-2 text-xs font-bold justify-between items-center">
                    <span className="text-[10px] text-slate-400">Modul #{index + 1}</span>
                    {/* Select Jenis change */}
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          const updated = [...parsedPreviewItems];
                          updated[index].jenis = "pengeluaran";
                          if (updated[index].kategori === "pendapatan") updated[index].kategori = "makanan";
                          setParsedPreviewItems(updated);
                        }}
                        className={`px-2 py-0.5 rounded text-[8.5px] border ${item.jenis === "pengeluaran" ? "bg-slate-800 border-slate-800 text-white font-black" : "bg-white text-slate-500 border-slate-200"}`}
                      >
                        Pengeluaran
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = [...parsedPreviewItems];
                          updated[index].jenis = "pemasukan";
                          updated[index].kategori = "pendapatan";
                          setParsedPreviewItems(updated);
                        }}
                        className={`px-2 py-0.5 rounded text-[8.5px] border ${item.jenis === "pemasukan" ? "bg-indigo-600 border-indigo-600 text-white font-black" : "bg-white text-slate-500 border-slate-200"}`}
                      >
                        Pemasukan
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-2">
                    {/* Item Description parameter */}
                    <div className="col-span-12 sm:col-span-5 space-y-1">
                      <label className="text-[8px] font-bold tracking-widest text-slate-400 uppercase block pl-0.5">Keterangan Item</label>
                      <input
                        type="text"
                        value={item.item}
                        onChange={(e) => {
                          const updated = [...parsedPreviewItems];
                          updated[index].item = e.target.value;
                          setParsedPreviewItems(updated);
                        }}
                        className="w-full text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 focus:border-indigo-500 rounded-lg p-1.5 outline-none"
                      />
                    </div>

                    {/* Price Nominal parameter */}
                    <div className="col-span-6 sm:col-span-4 space-y-1">
                      <label className="text-[8px] font-bold tracking-widest text-slate-400 uppercase block pl-0.5">Nominal (Rupiah)</label>
                      <input
                        type="number"
                        value={item.nominal}
                        onChange={(e) => {
                          const updated = [...parsedPreviewItems];
                          updated[index].nominal = parseFloat(e.target.value) || 0;
                          setParsedPreviewItems(updated);
                        }}
                        className="w-full text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 focus:border-indigo-500 rounded-lg p-1.5 outline-none font-mono"
                      />
                    </div>

                    {/* Kategori select */}
                    <div className="col-span-6 sm:col-span-3 space-y-1">
                      <label className="text-[8px] font-bold tracking-widest text-slate-400 uppercase block pl-0.5">Kategori</label>
                      <select
                        value={item.kategori}
                        disabled={item.jenis === "pemasukan"}
                        onChange={(e) => {
                          const updated = [...parsedPreviewItems];
                          updated[index].kategori = e.target.value as any;
                          setParsedPreviewItems(updated);
                        }}
                        className="w-full text-[10px] font-black text-slate-700 bg-white border border-slate-200 focus:border-indigo-500 rounded-lg p-1.5 outline-none"
                      >
                        <option value="makanan">Makanan</option>
                        <option value="transportasi">Transportasi</option>
                        <option value="tagihan">Tagihan</option>
                        <option value="hiburan">Hiburan</option>
                        <option value="pendapatan" disabled={item.jenis === "pengeluaran"}>Pendapatan</option>
                        <option value="lainnya">Lainnya</option>
                      </select>
                    </div>

                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  setParsedPreviewItems([]);
                  setShowPreviewModal(false);
                }}
                className="flex-1 py-2.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer text-center"
              >
                Batalkan
              </button>
              <button
                type="button"
                onClick={handleConfirmAddAll}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 font-bold text-xs text-white rounded-xl shadow-md transition-all active:scale-95 cursor-pointer text-center flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Catat ke Database murni
              </button>
            </div>
            
          </div>
        </div>
      )}

      {/* MODAL SECTION 3: DELETION CONFIRMATION DIALOG */}
      {itemToDelete && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setItemToDelete(null);
          }}
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in animate-duration-150"
        >
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm p-6 shadow-2xl relative space-y-4" id="modal-delete-confirmation">
            <button 
              onClick={() => setItemToDelete(null)}
              className="absolute top-4 right-4 p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-500 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="text-center space-y-3 pt-3">
              <div className="w-12 h-12 bg-rose-50 border border-rose-100 text-rose-600 rounded-full mx-auto flex items-center justify-center">
                <Trash2 className="w-5 h-5 animate-bounce" />
              </div>

              <div>
                <h3 className="font-display font-black text-sm text-slate-800 tracking-tight">Hapus Catatan Transaksi?</h3>
                <p className="text-[10px] text-slate-400 mt-1">Apakah Anda benar-benar yakin ingin menghapus catatan <strong>&quot;{itemToDelete.item}&quot; ({formatIDR(itemToDelete.nominal)})</strong> secara permanen?</p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setItemToDelete(null)}
                className="flex-1 py-2.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer text-center"
              >
                Kembali
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-md transition-all active:scale-95 cursor-pointer text-center"
              >
                Hapus Permanen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL SECTION 4: AI FINANCIAL DIAGNOSTICS ADVISOR INSIGHTS */}
      {showReviewModal && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowReviewModal(false);
          }}
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in animate-duration-150"
        >
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-2xl p-5 sm:p-7 shadow-2xl relative space-y-4 max-h-[90vh] flex flex-col" id="modal-ai-review">
            
            <button 
              onClick={() => setShowReviewModal(false)}
              className="absolute top-4 right-4 p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-500 transition-colors z-10"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="shrink-0 flex items-center gap-3 pb-3 border-b border-slate-100">
              <div className="p-2.5 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-black text-base text-slate-800 tracking-tight leading-none">Analisis Evaluasi Keuangan AI</h3>
                <p className="text-[10px] text-slate-400 mt-1">Konsultasi pribadi bersama asisten kecerdasan buatan terlatih.</p>
              </div>
            </div>

            {/* AI Advisor Response Report Block */}
            <div className="flex-1 overflow-y-auto min-h-[300px] border border-slate-150 rounded-2xl bg-slate-50/50 p-4 font-sans leading-relaxed">
              {isLoadingReview ? (
                <div className="flex flex-col items-center justify-center gap-4 min-h-[250px] text-center">
                  <div className="w-10 h-10 border-4 border-indigo-650 border-t-transparent text-indigo-600 rounded-full animate-spin"></div>
                  <div>
                    <h5 className="font-bold text-slate-800 text-xs">Menganalisis Pola keuangan Anda...</h5>
                    <p className="text-[10px] text-slate-400 mt-1 max-w-sm">Mengevaluasi pembelanjaan arus kas masuk, memproses rasio tabungan, dan memformulasikan rekomendasi alokasi bulanan khusus.</p>
                  </div>
                </div>
              ) : aiReviewText ? (
                <div className="animate-fade-in whitespace-pre-wrap">
                  <MarkdownRenderer content={aiReviewText} />
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400 text-xs shrink-0 self-center">
                  Tidak dapat memproses laporan. Silakan periksa kembali server.
                </div>
              )}
            </div>

            {/* Bottom Close Dialog button */}
            <div className="shrink-0 pt-2 border-t border-slate-150 flex justify-end">
              <button
                onClick={() => setShowReviewModal(false)}
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-150 text-slate-700 hover:text-slate-850 border border-slate-200 font-extrabold text-xs rounded-xl transition-all cursor-pointer active:scale-95"
              >
                Tutup Konsultasi
              </button>
            </div>

          </div>
        </div>
      )}

      {/* MODAL SECTION 5: ACCOUNT LOGOUT CONFIRMATION DIALOG */}
      {showLogoutModal && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLogoutModal(false);
          }}
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in animate-duration-150"
        >
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm p-6 shadow-2xl relative space-y-4" id="modal-logout-confirmation">
            <button 
              onClick={() => setShowLogoutModal(false)}
              className="absolute top-4 right-4 p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-500 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="text-center space-y-3 pt-3">
              <div className="w-12 h-12 bg-rose-50 border border-rose-100 text-rose-600 rounded-full mx-auto flex items-center justify-center shadow-xs">
                <LogOut className="w-5 h-5" />
              </div>

              <div>
                <h3 className="font-display font-black text-sm text-slate-800 tracking-tight">Keluar dari Akun Cloud?</h3>
                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                  Apakah Anda benar-benar ingin keluar dari sesi <strong>{user?.email}</strong>? Catatan keuangan cloud Anda akan tetap aman tersimpan, namun Anda perlu masuk kembali nanti untuk mensinkronisasi data.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 py-2.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer text-center active:scale-98"
              >
                Batal
              </button>
              <button
                onClick={async () => {
                  setShowLogoutModal(false);
                  await logout();
                }}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-md transition-all active:scale-95 cursor-pointer text-center"
              >
                Ya, Keluar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
