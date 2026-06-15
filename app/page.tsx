"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

const STORAGE_KEY = "masi_llm_config";

function getStoredApiKey(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return "";
    return JSON.parse(raw).deepseek || "";
  } catch {
    return "";
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface SignsbeatData {
  date: string;
  sbScore: string;
  recovery: string;
  mildStress: string;
  stress: string;
  hrv: string;
  hr: string;
  deepSleep: string;
  totalSleep: string;
  goal: string;
}

interface CsvFile {
  name: string;
  label: string;
  headers: string[];
  rows: Record<string, string>[];
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
  // Layer 8 — RL Swarm
  { id: "rl-recovery", label: "RL Recovery", icon: "🏆", color: "text-emerald-300" },
  { id: "rl-hormesis", label: "RL Hormesis", icon: "🔥", color: "text-red-300" },
  { id: "rl-bioage",   label: "RL Bio Age",  icon: "⏳", color: "text-violet-300" },
];

// ─── CSV Parser ───────────────────────────────────────────────────────────────

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
  if (files.length === 0) return "";
  let out = "\n\n## MULTI-PERIOD CSV DATA (Layer 8 RL Input)\n";
  files.forEach((csv) => {
    out += `\n### ${csv.label} — "${csv.name}" (${csv.rows.length} rows)\n`;
    if (csv.rows.length === 0) return;
    // Date range
    const dateCol = csv.headers.find((h) => /date/i.test(h));
    if (dateCol) {
      out += `Date range: ${csv.rows[0][dateCol]} → ${csv.rows[csv.rows.length - 1][dateCol]}\n`;
    }
    // Averages for numeric columns
    const numCols = csv.headers.filter((h) => {
      const vals = csv.rows.map((r) => parseFloat(r[h])).filter((v) => !isNaN(v));
      return vals.length > csv.rows.length * 0.4;
    });
    if (numCols.length > 0) {
      out += "Column averages: ";
      numCols.slice(0, 10).forEach((col) => {
        const vals = csv.rows.map((r) => parseFloat(r[col])).filter((v) => !isNaN(v));
        const avg = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
        out += `${col}=${avg}  `;
      });
      out += "\n";
    }
    // First and last row as state snapshots
    out += `First row: ${JSON.stringify(csv.rows[0])}\n`;
    if (csv.rows.length > 1)
      out += `Last row:  ${JSON.stringify(csv.rows[csv.rows.length - 1])}\n`;
  });
  out += "\nApply T-1 rule across all CSV rows. Use RL Swarm to identify action→reward patterns across periods.\n";
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSbScoreColor(score: number) {
  if (score >= 80) return "text-sb-recovery";
  if (score >= 60) return "text-green-400";
  if (score >= 40) return "text-sb-mildstress";
  if (score >= 20) return "text-orange-500";
  return "text-sb-stress";
}

function formatMessage(text: string) {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("**") && line.endsWith("**"))
      return <p key={i} className="font-semibold text-indigo-300 mb-1">{line.slice(2, -2)}</p>;
    if (line.startsWith("- ") || line.startsWith("• "))
      return <li key={i} className="ml-4 mb-1 list-disc">{formatInline(line.slice(2))}</li>;
    if (line.startsWith("### "))
      return <p key={i} className="font-bold text-indigo-200 mt-2 mb-1">{line.slice(4)}</p>;
    if (line.startsWith("## "))
      return <p key={i} className="font-bold text-white mt-3 mb-1 text-base">{line.slice(3)}</p>;
    if (line.trim() === "") return <br key={i} />;
    return <p key={i} className="mb-1">{formatInline(line)}</p>;
  });
}

function formatInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i} className="text-indigo-300">{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
  );
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
  const [dragOver, setDragOver] = useState(false);
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
    const cycle = setInterval(() => {
      const count = Math.floor(Math.random() * 4) + 2;
      const shuffled = [...AGENTS].sort(() => Math.random() - 0.5);
      setActiveAgents(shuffled.slice(0, count).map((a) => a.id));
    }, 600);
    return () => clearInterval(cycle);
  }, [isStreaming]);

  // ── CSV handling ────────────────────────────────────────────────────────────

  function handleFiles(files: FileList) {
    Array.from(files).forEach((file) => {
      if (!file.name.toLowerCase().endsWith(".csv")) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const { headers, rows } = parseCsv(text);
        setCsvFiles((prev) => [
          ...prev,
          { name: file.name, label: `Session ${prev.length + 1}`, headers, rows },
        ]);
      };
      reader.readAsText(file);
    });
  }

  function removeCSV(idx: number) {
    setCsvFiles((prev) => {
      const updated = prev.filter((_, i) => i !== idx);
      return updated.map((f, i) => ({ ...f, label: `Session ${i + 1}` }));
    });
  }

  function updateLabel(idx: number, label: string) {
    setCsvFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, label } : f)));
  }

  // ── Session ─────────────────────────────────────────────────────────────────

  async function startSession() {
    setPhase("chat");
    const csvContext = csvSummaryForAI(csvFiles);
    const openingMessage =
      `Starting MASI session with my current Signsbeat data:\n\n` +
      `• Date: ${form.date}\n` +
      `• SB Score: ${form.sbScore || "not provided"}\n` +
      `• Recovery%: ${form.recovery || "?"}%\n` +
      `• MildStress%: ${form.mildStress || "?"}%\n` +
      `• Stress%: ${form.stress || "?"}%\n` +
      `• HRV: ${form.hrv || "not provided"} ms\n` +
      `• Resting HR: ${form.hr || "not provided"} bpm\n` +
      `• Deep Sleep: ${form.deepSleep || "not provided"}%\n` +
      `• Total Sleep: ${form.totalSleep || "not provided"} hrs\n` +
      `• Goal: ${form.goal || "general optimization"}` +
      csvContext;

    const userMsg: Message = { role: "user", content: openingMessage };
    await streamResponse([userMsg]);
  }

  async function sendMessage() {
    if (!input.trim() || isStreaming) return;
    const userMsg: Message = { role: "user", content: input.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    await streamResponse(updatedMessages);
  }

  async function streamResponse(msgs: Message[]) {
    setIsStreaming(true);
    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages((prev) => {
      // If first message (opening), include the user msg
      if (msgs.length === 1 && msgs[0].role === "user") return [msgs[0], assistantMsg];
      return [...prev, assistantMsg];
    });

    try {
      const apiKey = getStoredApiKey();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-deepseek-api-key": apiKey } : {}),
        },
        body: JSON.stringify({ messages: msgs, signsbeat: form }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "API error");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const { text } = JSON.parse(data);
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: "assistant",
                content: updated[updated.length - 1].content + text,
              };
              return updated;
            });
          } catch {}
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Connection error.";
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "assistant", content: `⚠️ ${msg}` };
        return updated;
      });
    } finally {
      setIsStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  const sbScore = parseInt(form.sbScore) || 0;
  const recovPct = parseInt(form.recovery) || 0;
  const msPct = parseInt(form.mildStress) || 0;
  const stressPct = parseInt(form.stress) || 0;

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
              <p className="text-sb-muted text-sm">Upload historical CSVs for RL pattern learning, then enter today's metrics.</p>
            </div>

            {/* ── CSV Upload ─────────────────────────────────────────── */}
            <div className="bg-sb-card border border-sb-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">CSV Data Upload</span>
                  <span className="text-xs bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 px-2 py-0.5 rounded-full">Layer 8 RL Input</span>
                </div>
                <span className="text-xs text-sb-muted">{csvFiles.length} file{csvFiles.length !== 1 ? "s" : ""} loaded</span>
              </div>

              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl px-4 py-6 flex flex-col items-center justify-center cursor-pointer transition-all ${
                  dragOver ? "border-indigo-500 bg-indigo-500/10" : "border-sb-border hover:border-indigo-500/50 hover:bg-sb-dark/50"
                }`}
              >
                <svg className="w-8 h-8 text-sb-muted mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sb-muted text-sm text-center">
                  Drop multiple CSV files here or <span className="text-indigo-400 underline">click to browse</span>
                </p>
                <p className="text-xs text-sb-muted mt-1">Upload multiple periods (weeks/months) for RL trend analysis</p>
              </div>
              <input ref={fileInputRef} type="file" accept=".csv" multiple className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)} />

              {/* File cards */}
              {csvFiles.length > 0 && (
                <div className="mt-3 space-y-2">
                  {csvFiles.map((csv, idx) => (
                    <div key={idx} className="bg-sb-dark border border-sb-border rounded-xl px-3 py-2.5 flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 text-xs font-bold flex-shrink-0">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={csv.label}
                            onChange={(e) => updateLabel(idx, e.target.value)}
                            className="bg-transparent text-white text-sm font-medium focus:outline-none w-28 border-b border-transparent focus:border-indigo-500"
                          />
                          <span className="text-xs text-sb-muted truncate">{csv.name}</span>
                        </div>
                        <p className="text-xs text-sb-muted">{csv.rows.length} rows · {csv.headers.length} columns · {csv.headers.slice(0, 4).join(", ")}{csv.headers.length > 4 ? "…" : ""}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-sb-recovery bg-sb-recovery/10 border border-sb-recovery/20 px-2 py-0.5 rounded-full">Loaded</span>
                        <button onClick={() => removeCSV(idx)} className="text-sb-muted hover:text-sb-stress transition-colors p-1">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Manual Input Form ──────────────────────────────────── */}
            <div className="bg-sb-card border border-sb-border rounded-2xl p-5 space-y-4">
              <p className="text-xs text-sb-muted uppercase tracking-wider font-medium">Today's Metrics</p>

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
                    className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500 placeholder-sb-muted" />
                </div>
              </div>

              {/* State Distribution */}
              <div>
                <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">Physiological State Distribution (%)</label>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-sb-recovery mb-1">Recovery%</label>
                    <input type="number" min={0} max={100} placeholder="e.g. 55" value={form.recovery}
                      onChange={(e) => setForm({ ...form, recovery: e.target.value })}
                      className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-recovery text-sm focus:outline-none focus:border-sb-recovery placeholder-sb-muted" />
                  </div>
                  <div>
                    <label className="block text-xs text-sb-mildstress mb-1">MildStress%</label>
                    <input type="number" min={0} max={100} placeholder="e.g. 30" value={form.mildStress}
                      onChange={(e) => setForm({ ...form, mildStress: e.target.value })}
                      className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-mildstress text-sm focus:outline-none focus:border-sb-mildstress placeholder-sb-muted" />
                  </div>
                  <div>
                    <label className="block text-xs text-sb-stress mb-1">Stress%</label>
                    <input type="number" min={0} max={100} placeholder="e.g. 15" value={form.stress}
                      onChange={(e) => setForm({ ...form, stress: e.target.value })}
                      className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-stress text-sm focus:outline-none focus:border-sb-stress placeholder-sb-muted" />
                  </div>
                </div>
                {recovPct + msPct + stressPct > 0 && (
                  <div className="mt-2 flex h-1.5 rounded-full overflow-hidden">
                    <div style={{ width: `${recovPct}%` }} className="bg-sb-recovery" />
                    <div style={{ width: `${msPct}%` }} className="bg-sb-mildstress" />
                    <div style={{ width: `${stressPct}%` }} className="bg-sb-stress" />
                  </div>
                )}
              </div>

              {/* HRV + HR */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">HRV (ms)</label>
                  <input type="number" placeholder="e.g. 42" value={form.hrv}
                    onChange={(e) => setForm({ ...form, hrv: e.target.value })}
                    className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500 placeholder-sb-muted" />
                </div>
                <div>
                  <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">Resting HR (bpm)</label>
                  <input type="number" placeholder="e.g. 58" value={form.hr}
                    onChange={(e) => setForm({ ...form, hr: e.target.value })}
                    className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500 placeholder-sb-muted" />
                </div>
              </div>

              {/* Sleep */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">Deep Sleep (%)</label>
                  <input type="number" min={0} max={100} placeholder="e.g. 18" value={form.deepSleep}
                    onChange={(e) => setForm({ ...form, deepSleep: e.target.value })}
                    className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500 placeholder-sb-muted" />
                </div>
                <div>
                  <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">Total Sleep (hrs)</label>
                  <input type="number" step="0.1" placeholder="e.g. 7.2" value={form.totalSleep}
                    onChange={(e) => setForm({ ...form, totalSleep: e.target.value })}
                    className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500 placeholder-sb-muted" />
                </div>
              </div>

              {/* Goal */}
              <div>
                <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">Session Goal</label>
                <input type="text" placeholder="e.g. Improve recovery, understand score drop, optimize sleep..."
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
            <p className="text-sb-muted text-xs">RL Swarm Active{csvFiles.length > 0 ? ` · ${csvFiles.length} CSV session${csvFiles.length > 1 ? "s" : ""} loaded` : ""}</p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          {form.sbScore && (
            <div className="flex items-center gap-1.5 bg-sb-card border border-sb-border rounded-lg px-2.5 py-1">
              <span className="text-xs text-sb-muted">SB</span>
              <span className={`text-sm font-bold ${getSbScoreColor(sbScore)}`}>{form.sbScore}</span>
            </div>
          )}
          {form.recovery && (
            <div className="flex items-center gap-1 bg-sb-card border border-sb-border rounded-lg px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-sb-recovery" />
              <span className="text-xs text-sb-recovery">{form.recovery}%</span>
            </div>
          )}
          {form.stress && parseInt(form.stress) > 0 && (
            <div className="flex items-center gap-1 bg-sb-card border border-sb-border rounded-lg px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-sb-stress" />
              <span className="text-xs text-sb-stress">{form.stress}%</span>
            </div>
          )}
          <button onClick={() => { setPhase("input"); setMessages([]); }}
            className="text-xs text-sb-muted hover:text-sb-text border border-sb-border rounded-lg px-2.5 py-1 hover:border-indigo-500 transition-colors">
            New Session
          </button>
          <Link href="/settings"
            className="flex items-center gap-1 text-xs text-sb-muted hover:text-sb-text border border-sb-border rounded-lg px-2.5 py-1 hover:border-indigo-500 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </Link>
        </div>
      </header>

      {/* Agent swarm bar */}
      <div className="border-b border-sb-border px-4 py-2 flex items-center gap-2 overflow-x-auto">
        <span className="text-xs text-sb-muted whitespace-nowrap mr-1">Active agents:</span>
        {AGENTS.map((a) => (
          <div key={a.id} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-all duration-300 whitespace-nowrap ${
            activeAgents.includes(a.id)
              ? `border-indigo-500/50 bg-indigo-500/10 ${a.color} agent-active`
              : a.id.startsWith("rl-")
              ? `border-violet-800/40 ${a.color} opacity-50`
              : "border-sb-border text-sb-muted"
          }`}>
            <span>{a.icon}</span><span>{a.label}</span>
          </div>
        ))}
      </div>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-slide-up`}>
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold mr-2 mt-0.5 flex-shrink-0">M</div>
            )}
            <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm ${
              msg.role === "user"
                ? "bg-indigo-600/20 border border-indigo-500/30 text-sb-text rounded-tr-sm"
                : "bg-sb-card border border-sb-border text-sb-text rounded-tl-sm"
            }`}>
              {msg.role === "assistant" ? (
                <div className="prose-chat leading-relaxed">
                  {formatMessage(msg.content)}
                  {isStreaming && i === messages.length - 1 && msg.content === "" && (
                    <div className="flex gap-1 items-center py-1">
                      {[0, 150, 300].map((d) => (
                        <div key={d} className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      {/* Input bar */}
      <div className="border-t border-sb-border px-4 py-3">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown} disabled={isStreaming}
            placeholder={isStreaming ? "MASI swarm is analyzing…" : "Answer the question or ask about your data…"}
            rows={1}
            className="flex-1 bg-sb-card border border-sb-border rounded-xl px-4 py-3 text-sb-text text-sm placeholder-sb-muted focus:outline-none focus:border-indigo-500 resize-none disabled:opacity-50"
            style={{ maxHeight: "120px" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }} />
          <button onClick={sendMessage} disabled={!input.trim() || isStreaming}
            className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl flex items-center justify-center transition-all">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <p className="text-center text-xs text-sb-muted mt-2">
          Pattern analysis only — not medical advice · T-1 Rule · MASI v1.0 + Layer 8 RL
        </p>
      </div>
    </div>
  );
}
