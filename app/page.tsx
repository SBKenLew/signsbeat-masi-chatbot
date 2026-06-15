"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";

const STORAGE_KEY = "masi_llm_config";
function getStoredApiKey(): string {
  if (typeof window === "undefined") return "";
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}").deepseek || ""; }
  catch { return ""; }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message { role: "user" | "assistant"; content: string; }

interface SignsbeatData {
  date: string; sbScore: string; recovery: string; mildStress: string;
  stress: string; hrv: string; hr: string; deepSleep: string; totalSleep: string; goal: string;
}

interface CsvFile {
  name: string; label: string; headers: string[]; rows: Record<string, string>[];
}

type Period = "7d" | "30d" | "custom";

interface ExtractionInfo {
  rowCount: number; dateMin: string; dateMax: string; missingCols: string[];
}

// ─── Column detection map ─────────────────────────────────────────────────────

const COL_KEYS: Record<keyof Omit<SignsbeatData, "date" | "goal">, string[]> = {
  sbScore:   ["sb score", "score", "sbscore", "vitalzscore", "vitazlscore", "sb_score", "sbs"],
  recovery:  ["recovery%", "recovery %", "recovery", "pro_recovery", "pro recovery"],
  mildStress:["mildstress%", "mild stress%", "mildstress", "mild stress", "pro_mildstress", "pro mild stress"],
  stress:    ["stress%", "stress %", "stress", "pro_stress", "pro stress"],
  hrv:       ["hrv", "hrv (ms)", "heart rate variability", "rmssd", "sdnn"],
  hr:        ["resting hr", "resting heart rate", "hr (bpm)", "resting_hr", "hr", "heart rate"],
  deepSleep: ["deep sleep%", "deep sleep (%)", "deep sleep", "deepsleep%", "deepsleep", "deep_sleep"],
  totalSleep:["total sleep (hrs)", "total sleep (h)", "total sleep", "sleep duration", "sleep (hrs)", "totalsleep", "sleep hours", "total_sleep"],
};

function findCol(headers: string[], keys: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const key of keys) {
    const i = lower.findIndex((h) => h === key);
    if (i !== -1) return headers[i];
  }
  // partial match fallback
  for (const key of keys) {
    const i = lower.findIndex((h) => h.includes(key) || key.includes(h));
    if (i !== -1) return headers[i];
  }
  return null;
}

function findDateCol(headers: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const candidates = ["date", "day", "datetime", "timestamp", "time"];
  for (const c of candidates) {
    const i = lower.findIndex((h) => h === c || h.startsWith(c));
    if (i !== -1) return headers[i];
  }
  return null;
}

function parseRowDate(str: string): Date | null {
  if (!str?.trim()) return null;
  const s = str.trim();
  // ISO: YYYY-MM-DD or YYYY/MM/DD
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // DD/MM/YYYY or DD-MM-YYYY
  const p = s.split(/[\/\-\.]/);
  if (p.length === 3 && p[0].length <= 2) {
    d = new Date(`${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}`);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function avg(vals: number[]): string {
  if (!vals.length) return "";
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
}

// ─── Agents ───────────────────────────────────────────────────────────────────

const AGENTS = [
  { id: "sleep",       label: "Sleep",       icon: "🛌", color: "text-blue-400" },
  { id: "nutrition",   label: "Nutrition",   icon: "🥗", color: "text-green-400" },
  { id: "exercise",    label: "Exercise",    icon: "💪", color: "text-orange-400" },
  { id: "stress",      label: "Stress",      icon: "🧠", color: "text-purple-400" },
  { id: "biohacking",  label: "Biohacking",  icon: "⚡", color: "text-yellow-400" },
  { id: "circadian",   label: "Circadian",   icon: "🌙", color: "text-indigo-400" },
  { id: "recovery",    label: "Recovery",    icon: "🔄", color: "text-teal-400" },
  { id: "aging",       label: "Bio Aging",   icon: "🧬", color: "text-pink-400" },
  { id: "rl-recovery", label: "RL Recovery", icon: "🏆", color: "text-emerald-300" },
  { id: "rl-hormesis", label: "RL Hormesis", icon: "🔥", color: "text-red-300" },
  { id: "rl-bioage",   label: "RL Bio Age",  icon: "⏳", color: "text-violet-300" },
];

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
  const rows = lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/"/g, ""));
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });
  return { headers, rows };
}

function csvSummaryForAI(files: CsvFile[]): string {
  if (!files.length) return "";
  let out = "\n\n## MULTI-PERIOD CSV DATA (Layer 8 RL Input)\n";
  files.forEach((csv) => {
    out += `\n### ${csv.label} — "${csv.name}" (${csv.rows.length} rows)\n`;
    if (!csv.rows.length) return;
    const dateCol = findDateCol(csv.headers);
    if (dateCol) out += `Date range: ${csv.rows[0][dateCol]} → ${csv.rows[csv.rows.length - 1][dateCol]}\n`;
    const numCols = csv.headers.filter((h) => {
      const vals = csv.rows.map((r) => parseFloat(r[h])).filter((v) => !isNaN(v));
      return vals.length > csv.rows.length * 0.4;
    });
    if (numCols.length) {
      out += "Averages: ";
      numCols.slice(0, 10).forEach((col) => {
        const vals = csv.rows.map((r) => parseFloat(r[col])).filter((v) => !isNaN(v));
        out += `${col}=${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)}  `;
      });
      out += "\n";
    }
    out += `First row: ${JSON.stringify(csv.rows[0])}\n`;
    if (csv.rows.length > 1) out += `Last row: ${JSON.stringify(csv.rows[csv.rows.length - 1])}\n`;
  });
  out += "\nApply T-1 rule. Use RL Swarm to identify action→reward patterns.\n";
  return out;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function getSbScoreColor(score: number) {
  if (score >= 80) return "text-sb-recovery";
  if (score >= 60) return "text-green-400";
  if (score >= 40) return "text-sb-mildstress";
  if (score >= 20) return "text-orange-500";
  return "text-sb-stress";
}

function formatInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i} className="text-indigo-300">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}

function formatMessage(text: string) {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("**") && line.endsWith("**"))
      return <p key={i} className="font-semibold text-indigo-300 mb-1">{line.slice(2, -2)}</p>;
    if (line.startsWith("### "))
      return <p key={i} className="font-bold text-indigo-200 mt-2 mb-1">{line.slice(4)}</p>;
    if (line.startsWith("## "))
      return <p key={i} className="font-bold text-white mt-3 mb-1 text-base">{line.slice(3)}</p>;
    if (line.startsWith("- ") || line.startsWith("• "))
      return <li key={i} className="ml-4 mb-1 list-disc">{formatInline(line.slice(2))}</li>;
    if (line.trim() === "") return <br key={i} />;
    return <p key={i} className="mb-1">{formatInline(line)}</p>;
  });
}

const INITIAL_FORM: SignsbeatData = {
  date: new Date().toISOString().split("T")[0],
  sbScore: "", recovery: "", mildStress: "", stress: "",
  hrv: "", hr: "", deepSleep: "", totalSleep: "", goal: "",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function MASIChatbot() {
  const [phase, setPhase] = useState<"input" | "chat">("input");
  const [form, setForm] = useState<SignsbeatData>(INITIAL_FORM);
  const [csvFiles, setCsvFiles] = useState<CsvFile[]>([]);
  const [period, setPeriod] = useState<Period>("7d");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [extractInfo, setExtractInfo] = useState<ExtractionInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeAgents, setActiveAgents] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (!isStreaming) { setActiveAgents([]); return; }
    const id = setInterval(() => {
      const n = Math.floor(Math.random() * 4) + 2;
      setActiveAgents([...AGENTS].sort(() => Math.random() - 0.5).slice(0, n).map((a) => a.id));
    }, 600);
    return () => clearInterval(id);
  }, [isStreaming]);

  // ── Extract & fill from CSV ─────────────────────────────────────────────────

  const extractAndFill = useCallback(() => {
    if (!csvFiles.length) return;

    // Merge all rows from all files
    type TaggedRow = { row: Record<string, string>; headers: string[] };
    const allTagged: TaggedRow[] = csvFiles.flatMap((csv) =>
      csv.rows.map((row) => ({ row, headers: csv.headers }))
    );

    // Determine date range to filter
    const now = new Date();
    let fromDate: Date | null = null;
    let toDate: Date | null = null;

    if (period === "7d") {
      fromDate = new Date(now); fromDate.setDate(fromDate.getDate() - 7);
      toDate = now;
    } else if (period === "30d") {
      fromDate = new Date(now); fromDate.setDate(fromDate.getDate() - 30);
      toDate = now;
    } else {
      fromDate = dateFrom ? new Date(dateFrom) : null;
      toDate = dateTo ? new Date(dateTo) : null;
    }

    // Filter rows by date if possible
    let filtered: TaggedRow[] = allTagged;
    const allDateCols = csvFiles.map((csv) => findDateCol(csv.headers));
    const hasDates = allDateCols.some(Boolean);

    if (hasDates && (fromDate || toDate)) {
      filtered = allTagged.filter(({ row, headers }) => {
        const dc = findDateCol(headers);
        if (!dc) return true; // include if no date col
        const d = parseRowDate(row[dc] ?? "");
        if (!d) return true;
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
        return true;
      });
    }

    if (!filtered.length) filtered = allTagged; // fallback: use all

    // Collect numeric values per field
    const vals: Record<keyof Omit<SignsbeatData, "date" | "goal">, number[]> = {
      sbScore: [], recovery: [], mildStress: [], stress: [],
      hrv: [], hr: [], deepSleep: [], totalSleep: [],
    };
    const missingCols: string[] = [];

    (Object.keys(COL_KEYS) as (keyof typeof COL_KEYS)[]).forEach((field) => {
      // Try to find the column across all unique header sets
      const seenHdrs = new Set<string>();
      const headerSets = csvFiles
        .map((c) => c.headers.join("|"))
        .filter((s) => { if (seenHdrs.has(s)) return false; seenHdrs.add(s); return true; })
        .map((s) => s.split("|"));
      let found = false;
      headerSets.forEach((headers) => {
        const col = findCol(headers, COL_KEYS[field]);
        if (col) {
          found = true;
          filtered.forEach(({ row, headers: rh }) => {
            const c2 = findCol(rh, COL_KEYS[field]);
            if (!c2) return;
            const v = parseFloat(row[c2]);
            if (!isNaN(v)) vals[field].push(v);
          });
        }
      });
      if (!found) missingCols.push(field);
    });

    // Date range info
    const parsedDates = filtered
      .flatMap(({ row, headers }) => {
        const dc = findDateCol(headers);
        return dc ? [parseRowDate(row[dc] ?? "")] : [];
      })
      .filter(Boolean) as Date[];
    const dateMin = parsedDates.length
      ? parsedDates.reduce((a, b) => (a < b ? a : b)).toISOString().split("T")[0]
      : "";
    const dateMax = parsedDates.length
      ? parsedDates.reduce((a, b) => (a > b ? a : b)).toISOString().split("T")[0]
      : "";

    // Fill form
    setForm((prev) => ({
      ...prev,
      sbScore:   vals.sbScore.length   ? avg(vals.sbScore)   : prev.sbScore,
      recovery:  vals.recovery.length  ? avg(vals.recovery)  : prev.recovery,
      mildStress:vals.mildStress.length? avg(vals.mildStress): prev.mildStress,
      stress:    vals.stress.length    ? avg(vals.stress)    : prev.stress,
      hrv:       vals.hrv.length       ? avg(vals.hrv)       : prev.hrv,
      hr:        vals.hr.length        ? avg(vals.hr)        : prev.hr,
      deepSleep: vals.deepSleep.length ? avg(vals.deepSleep) : prev.deepSleep,
      totalSleep:vals.totalSleep.length? avg(vals.totalSleep): prev.totalSleep,
    }));

    setExtractInfo({ rowCount: filtered.length, dateMin, dateMax, missingCols });
  }, [csvFiles, period, dateFrom, dateTo]);

  // Auto-extract whenever CSV or period changes
  useEffect(() => { if (csvFiles.length) extractAndFill(); }, [csvFiles, period, dateFrom, dateTo, extractAndFill]);

  // ── CSV file handling ───────────────────────────────────────────────────────

  function handleFiles(files: FileList) {
    Array.from(files).forEach((file) => {
      if (!file.name.toLowerCase().endsWith(".csv")) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const { headers, rows } = parseCsv(e.target?.result as string);
        setCsvFiles((prev) => [...prev, { name: file.name, label: `Session ${prev.length + 1}`, headers, rows }]);
      };
      reader.readAsText(file);
    });
  }

  function removeCSV(idx: number) {
    setCsvFiles((prev) => {
      const next = prev.filter((_, i) => i !== idx).map((f, i) => ({ ...f, label: `Session ${i + 1}` }));
      if (!next.length) { setExtractInfo(null); setForm(INITIAL_FORM); }
      return next;
    });
  }

  function updateLabel(idx: number, label: string) {
    setCsvFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, label } : f)));
  }

  // ── Chat ────────────────────────────────────────────────────────────────────

  async function startSession() {
    setPhase("chat");
    const csvContext = csvSummaryForAI(csvFiles);
    const periodLabel = period === "7d" ? "Last 7 days" : period === "30d" ? "Last 30 days" : `${dateFrom} → ${dateTo}`;
    const openingMessage =
      `Starting MASI session — metrics averaged from ${extractInfo ? `${extractInfo.rowCount} CSV rows (${periodLabel})` : "manual input"}:\n\n` +
      `• Date: ${form.date}\n• SB Score: ${form.sbScore || "?"}\n` +
      `• Recovery%: ${form.recovery || "?"}%\n• MildStress%: ${form.mildStress || "?"}%\n• Stress%: ${form.stress || "?"}%\n` +
      `• HRV: ${form.hrv || "?"} ms\n• Resting HR: ${form.hr || "?"} bpm\n` +
      `• Deep Sleep: ${form.deepSleep || "?"}%\n• Total Sleep: ${form.totalSleep || "?"} hrs\n` +
      `• Goal: ${form.goal || "general optimization"}` + csvContext;

    await streamResponse([{ role: "user", content: openingMessage }]);
  }

  async function sendMessage() {
    if (!input.trim() || isStreaming) return;
    const updated = [...messages, { role: "user" as const, content: input.trim() }];
    setMessages(updated); setInput("");
    await streamResponse(updated);
  }

  async function streamResponse(msgs: Message[]) {
    setIsStreaming(true);
    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages((prev) =>
      msgs.length === 1 && msgs[0].role === "user" ? [msgs[0], assistantMsg] : [...prev, assistantMsg]
    );

    try {
      const apiKey = getStoredApiKey();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { "x-deepseek-api-key": apiKey } : {}) },
        body: JSON.stringify({ messages: msgs, signsbeat: form }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "API error"); }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const { text } = JSON.parse(data);
            setMessages((prev) => {
              const u = [...prev];
              u[u.length - 1] = { role: "assistant", content: u[u.length - 1].content + text };
              return u;
            });
          } catch {}
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Connection error.";
      setMessages((prev) => { const u = [...prev]; u[u.length - 1] = { role: "assistant", content: `⚠️ ${msg}` }; return u; });
    } finally {
      setIsStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  const sbScore = parseInt(form.sbScore) || 0;
  const recovPct = parseFloat(form.recovery) || 0;
  const msPct = parseFloat(form.mildStress) || 0;
  const stressPct = parseFloat(form.stress) || 0;

  // ── INPUT PHASE ─────────────────────────────────────────────────────────────

  if (phase === "input") {
    return (
      <div className="min-h-screen bg-sb-dark flex flex-col">
        <header className="border-b border-sb-border px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">SB</div>
            <div>
              <h1 className="text-white font-semibold text-sm tracking-wide">Signsbeat MASI</h1>
              <p className="text-sb-muted text-xs">Multi-Agent Swarm Intelligence + RL Layer 8</p>
            </div>
          </div>
          <Link href="/settings" className="flex items-center gap-1.5 text-xs text-sb-muted hover:text-sb-text border border-sb-border hover:border-indigo-500 rounded-lg px-3 py-1.5 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            API Settings
          </Link>
        </header>

        <main className="flex-1 flex items-start justify-center px-4 py-8 overflow-y-auto">
          <div className="w-full max-w-2xl space-y-4">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/30 rounded-full text-indigo-400 text-xs mb-3">
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse" />
                Layers 1–8 Active · Dynamic Survey + RL Swarm
              </div>
              <h2 className="text-2xl font-bold text-white mb-1">Enter Your Signsbeat Data</h2>
              <p className="text-sb-muted text-sm">Upload CSVs to auto-fill metrics, or enter values manually.</p>
            </div>

            {/* ── CSV Upload ─────────────────────────────────────────── */}
            <div className="bg-sb-card border border-sb-border rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">CSV Data Upload</span>
                  <span className="text-xs bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 px-2 py-0.5 rounded-full">Layer 8 RL</span>
                </div>
                <span className="text-xs text-sb-muted">{csvFiles.length} file{csvFiles.length !== 1 ? "s" : ""}</span>
              </div>

              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl px-4 py-5 flex flex-col items-center justify-center cursor-pointer transition-all ${
                  dragOver ? "border-indigo-500 bg-indigo-500/10" : "border-sb-border hover:border-indigo-500/50"
                }`}
              >
                <svg className="w-7 h-7 text-sb-muted mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sb-muted text-sm text-center">Drop CSV files or <span className="text-indigo-400 underline">click to browse</span></p>
                <p className="text-xs text-sb-muted mt-0.5">Multiple files supported — metrics auto-filled from selected period</p>
              </div>
              <input ref={fileInputRef} type="file" accept=".csv" multiple className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)} />

              {/* File cards */}
              {csvFiles.length > 0 && (
                <div className="space-y-2">
                  {csvFiles.map((csv, idx) => (
                    <div key={idx} className="bg-sb-dark border border-sb-border rounded-xl px-3 py-2.5 flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 text-xs font-bold flex-shrink-0">{idx + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <input type="text" value={csv.label} onChange={(e) => updateLabel(idx, e.target.value)}
                            className="bg-transparent text-white text-sm font-medium focus:outline-none w-28 border-b border-transparent focus:border-indigo-500" />
                          <span className="text-xs text-sb-muted truncate">{csv.name}</span>
                        </div>
                        <p className="text-xs text-sb-muted">{csv.rows.length} rows · {csv.headers.slice(0, 4).join(", ")}{csv.headers.length > 4 ? "…" : ""}</p>
                      </div>
                      <button onClick={() => removeCSV(idx)} className="text-sb-muted hover:text-sb-stress transition-colors p-1">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Period selector ──────────────────────────────── */}
              {csvFiles.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs text-sb-muted uppercase tracking-wider">Analysis Period</p>
                  <div className="flex gap-2">
                    {([["7d", "7 Days"], ["30d", "1 Month"], ["custom", "Custom"]] as [Period, string][]).map(([val, label]) => (
                      <button key={val} onClick={() => setPeriod(val)}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all border ${
                          period === val
                            ? "bg-indigo-600 border-indigo-500 text-white"
                            : "bg-sb-dark border-sb-border text-sb-muted hover:border-indigo-500/50 hover:text-sb-text"
                        }`}>{label}</button>
                    ))}
                  </div>

                  {period === "custom" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-sb-muted mb-1">From</label>
                        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                          className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500" />
                      </div>
                      <div>
                        <label className="block text-xs text-sb-muted mb-1">To</label>
                        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                          className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500" />
                      </div>
                    </div>
                  )}

                  {/* Extraction result banner */}
                  {extractInfo && (
                    <div className="flex items-start gap-2 bg-sb-recovery/5 border border-sb-recovery/20 rounded-xl px-3 py-2.5">
                      <svg className="w-4 h-4 text-sb-recovery mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <div className="flex-1">
                        <p className="text-xs text-sb-recovery font-medium">
                          Metrics auto-filled from {extractInfo.rowCount} rows
                          {extractInfo.dateMin && ` · ${extractInfo.dateMin} → ${extractInfo.dateMax}`}
                        </p>
                        {extractInfo.missingCols.length > 0 && (
                          <p className="text-xs text-sb-muted mt-0.5">
                            Columns not detected: {extractInfo.missingCols.join(", ")} — fill manually below
                          </p>
                        )}
                      </div>
                      <button onClick={extractAndFill}
                        className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 rounded px-2 py-0.5 flex-shrink-0">
                        Recalculate
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Manual / Auto-filled Metrics ──────────────────────── */}
            <div className="bg-sb-card border border-sb-border rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-sb-muted uppercase tracking-wider font-medium">Metrics</p>
                {extractInfo && <span className="text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full">Auto-filled from CSV</span>}
              </div>

              {/* Date + SB Score */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">Date</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">SB Score (0–100)</label>
                  <input type="number" min={0} max={100} placeholder="e.g. 68" value={form.sbScore}
                    onChange={(e) => setForm({ ...form, sbScore: e.target.value })}
                    className={`w-full bg-sb-dark border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none placeholder-sb-muted ${form.sbScore && extractInfo ? "border-indigo-500/50" : "border-sb-border focus:border-indigo-500"}`} />
                </div>
              </div>

              {/* State Distribution */}
              <div>
                <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">Physiological State Distribution (%)</label>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    ["recovery",   "Recovery%",   "text-sb-recovery",   "focus:border-sb-recovery"],
                    ["mildStress", "MildStress%",  "text-sb-mildstress", "focus:border-sb-mildstress"],
                    ["stress",     "Stress%",      "text-sb-stress",     "focus:border-sb-stress"],
                  ] as [keyof SignsbeatData, string, string, string][]).map(([key, label, textCls, focusCls]) => (
                    <div key={key}>
                      <label className={`block text-xs mb-1 ${textCls}`}>{label}</label>
                      <input type="number" min={0} max={100} placeholder="e.g. —" value={form[key]}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                        className={`w-full bg-sb-dark border rounded-lg px-3 py-2 text-sm placeholder-sb-muted focus:outline-none ${textCls} ${form[key] && extractInfo ? "border-indigo-500/40" : `border-sb-border ${focusCls}`}`} />
                    </div>
                  ))}
                </div>
                {recovPct + msPct + stressPct > 0 && (
                  <div className="mt-2 flex h-1.5 rounded-full overflow-hidden">
                    <div style={{ width: `${recovPct}%` }} className="bg-sb-recovery transition-all" />
                    <div style={{ width: `${msPct}%` }} className="bg-sb-mildstress transition-all" />
                    <div style={{ width: `${stressPct}%` }} className="bg-sb-stress transition-all" />
                  </div>
                )}
                {recovPct + msPct + stressPct > 0 && (
                  <div className="flex justify-between mt-1">
                    <span className="text-xs text-sb-recovery">{recovPct.toFixed(1)}%</span>
                    <span className="text-xs text-sb-mildstress">{msPct.toFixed(1)}%</span>
                    <span className="text-xs text-sb-stress">{stressPct.toFixed(1)}%</span>
                  </div>
                )}
              </div>

              {/* HRV + HR */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">HRV (ms)</label>
                  <input type="number" placeholder="e.g. 42" value={form.hrv}
                    onChange={(e) => setForm({ ...form, hrv: e.target.value })}
                    className={`w-full bg-sb-dark border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none placeholder-sb-muted ${form.hrv && extractInfo ? "border-indigo-500/50" : "border-sb-border focus:border-indigo-500"}`} />
                </div>
                <div>
                  <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">Resting HR (bpm)</label>
                  <input type="number" placeholder="e.g. 58" value={form.hr}
                    onChange={(e) => setForm({ ...form, hr: e.target.value })}
                    className={`w-full bg-sb-dark border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none placeholder-sb-muted ${form.hr && extractInfo ? "border-indigo-500/50" : "border-sb-border focus:border-indigo-500"}`} />
                </div>
              </div>

              {/* Sleep */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">Deep Sleep (%)</label>
                  <input type="number" min={0} max={100} placeholder="e.g. 18" value={form.deepSleep}
                    onChange={(e) => setForm({ ...form, deepSleep: e.target.value })}
                    className={`w-full bg-sb-dark border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none placeholder-sb-muted ${form.deepSleep && extractInfo ? "border-indigo-500/50" : "border-sb-border focus:border-indigo-500"}`} />
                </div>
                <div>
                  <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">Total Sleep (hrs)</label>
                  <input type="number" step="0.1" placeholder="e.g. 7.2" value={form.totalSleep}
                    onChange={(e) => setForm({ ...form, totalSleep: e.target.value })}
                    className={`w-full bg-sb-dark border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none placeholder-sb-muted ${form.totalSleep && extractInfo ? "border-indigo-500/50" : "border-sb-border focus:border-indigo-500"}`} />
                </div>
              </div>

              {/* Goal */}
              <div>
                <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">Session Goal</label>
                <input type="text" placeholder="e.g. Improve recovery, understand score drop, optimize sleep…"
                  value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })}
                  className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500 placeholder-sb-muted" />
              </div>

              <button onClick={startSession} disabled={!form.sbScore && !form.recovery}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all text-sm">
                Activate MASI Swarm →
              </button>
              <p className="text-xs text-sb-muted text-center">SB Score or State Distribution required to begin</p>
            </div>

            {/* Agent preview */}
            <div className="grid grid-cols-4 gap-2">
              {AGENTS.map((a) => (
                <div key={a.id} className="bg-sb-card border border-sb-border rounded-lg px-2 py-2 flex items-center gap-1.5">
                  <span className="text-sm">{a.icon}</span>
                  <span className={`text-xs ${a.id.startsWith("rl-") ? a.color + " font-medium" : "text-sb-muted"}`}>{a.label}</span>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── CHAT PHASE ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-sb-dark flex flex-col">
      <header className="border-b border-sb-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">SB</div>
          <div>
            <h1 className="text-white font-semibold text-sm">Signsbeat MASI</h1>
            <p className="text-sb-muted text-xs">
              RL Swarm Active{csvFiles.length > 0 ? ` · ${csvFiles.length} CSV · ${period === "7d" ? "7-day" : period === "30d" ? "30-day" : "custom"} avg` : ""}
            </p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          {form.sbScore && (
            <div className="flex items-center gap-1.5 bg-sb-card border border-sb-border rounded-lg px-2.5 py-1">
              <span className="text-xs text-sb-muted">SB</span>
              <span className={`text-sm font-bold ${getSbScoreColor(sbScore)}`}>{form.sbScore}</span>
            </div>
          )}
          {form.recovery && <div className="flex items-center gap-1 bg-sb-card border border-sb-border rounded-lg px-2.5 py-1"><span className="w-1.5 h-1.5 rounded-full bg-sb-recovery" /><span className="text-xs text-sb-recovery">{form.recovery}%</span></div>}
          {form.stress && parseInt(form.stress) > 0 && <div className="flex items-center gap-1 bg-sb-card border border-sb-border rounded-lg px-2.5 py-1"><span className="w-1.5 h-1.5 rounded-full bg-sb-stress" /><span className="text-xs text-sb-stress">{form.stress}%</span></div>}
          <button onClick={() => { setPhase("input"); setMessages([]); }} className="text-xs text-sb-muted hover:text-sb-text border border-sb-border rounded-lg px-2.5 py-1 hover:border-indigo-500 transition-colors">New Session</button>
          <Link href="/settings" className="flex items-center gap-1 text-xs text-sb-muted hover:text-sb-text border border-sb-border rounded-lg px-2.5 py-1 hover:border-indigo-500 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </Link>
        </div>
      </header>

      {/* Agent bar */}
      <div className="border-b border-sb-border px-4 py-2 flex items-center gap-2 overflow-x-auto">
        <span className="text-xs text-sb-muted whitespace-nowrap mr-1">Active agents:</span>
        {AGENTS.map((a) => (
          <div key={a.id} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-all duration-300 whitespace-nowrap ${
            activeAgents.includes(a.id) ? `border-indigo-500/50 bg-indigo-500/10 ${a.color} agent-active`
            : a.id.startsWith("rl-") ? `border-violet-800/40 ${a.color} opacity-50`
            : "border-sb-border text-sb-muted"
          }`}><span>{a.icon}</span><span>{a.label}</span></div>
        ))}
      </div>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-slide-up`}>
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold mr-2 mt-0.5 flex-shrink-0">M</div>
            )}
            <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm ${msg.role === "user" ? "bg-indigo-600/20 border border-indigo-500/30 text-sb-text rounded-tr-sm" : "bg-sb-card border border-sb-border text-sb-text rounded-tl-sm"}`}>
              {msg.role === "assistant" ? (
                <div className="prose-chat leading-relaxed">
                  {formatMessage(msg.content)}
                  {isStreaming && i === messages.length - 1 && msg.content === "" && (
                    <div className="flex gap-1 items-center py-1">
                      {[0, 150, 300].map((d) => <div key={d} className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                    </div>
                  )}
                </div>
              ) : <p className="whitespace-pre-wrap">{msg.content}</p>}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      {/* Input */}
      <div className="border-t border-sb-border px-4 py-3">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown} disabled={isStreaming}
            placeholder={isStreaming ? "MASI swarm is analyzing…" : "Answer the question or ask about your data…"}
            rows={1}
            className="flex-1 bg-sb-card border border-sb-border rounded-xl px-4 py-3 text-sb-text text-sm placeholder-sb-muted focus:outline-none focus:border-indigo-500 resize-none disabled:opacity-50"
            style={{ maxHeight: "120px" }}
            onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px"; }} />
          <button onClick={sendMessage} disabled={!input.trim() || isStreaming}
            className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 rounded-xl flex items-center justify-center transition-all">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <p className="text-center text-xs text-sb-muted mt-2">Pattern analysis only — not medical advice · T-1 Rule · MASI v1.0 + Layer 8 RL</p>
      </div>
    </div>
  );
}
