"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

const STORAGE_KEY = "masi_llm_config";

function getStoredApiKey(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return "";
    const cfg = JSON.parse(raw);
    return cfg.deepseek || "";
  } catch {
    return "";
  }
}

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
  proPositive: string;
  proNegative: string;
  hrv: string;
  hr: string;
  deepSleep: string;
  totalSleep: string;
  goal: string;
}

const AGENTS = [
  { id: "sleep", label: "Sleep", icon: "🛌", color: "text-blue-400" },
  { id: "nutrition", label: "Nutrition", icon: "🥗", color: "text-green-400" },
  { id: "exercise", label: "Exercise", icon: "💪", color: "text-orange-400" },
  { id: "stress", label: "Stress", icon: "🧠", color: "text-purple-400" },
  { id: "biohacking", label: "Biohacking", icon: "⚡", color: "text-yellow-400" },
  { id: "circadian", label: "Circadian", icon: "🌙", color: "text-indigo-400" },
  { id: "recovery", label: "Recovery", icon: "🔄", color: "text-teal-400" },
  { id: "aging", label: "Bio Aging", icon: "🧬", color: "text-pink-400" },
];

function getStateColor(type: "recovery" | "mildstress" | "stress") {
  if (type === "recovery") return "text-sb-recovery";
  if (type === "mildstress") return "text-sb-mildstress";
  return "text-sb-stress";
}

function getSbScoreColor(score: number) {
  if (score >= 80) return "text-sb-recovery";
  if (score >= 60) return "text-green-400";
  if (score >= 40) return "text-sb-mildstress";
  if (score >= 20) return "text-orange-500";
  return "text-sb-stress";
}

function formatMessage(text: string) {
  // Convert markdown-like formatting
  const lines = text.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("**") && line.endsWith("**")) {
      return (
        <p key={i} className="font-semibold text-indigo-300 mb-1">
          {line.slice(2, -2)}
        </p>
      );
    }
    if (line.startsWith("- ") || line.startsWith("• ")) {
      return (
        <li key={i} className="ml-4 mb-1 list-disc">
          {formatInline(line.slice(2))}
        </li>
      );
    }
    if (line.trim() === "") return <br key={i} />;
    return <p key={i} className="mb-1">{formatInline(line)}</p>;
  });
}

function formatInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="text-indigo-300">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

const INITIAL_FORM: SignsbeatData = {
  date: new Date().toISOString().split("T")[0],
  sbScore: "",
  recovery: "",
  mildStress: "",
  stress: "",
  proPositive: "",
  proNegative: "",
  hrv: "",
  hr: "",
  deepSleep: "",
  totalSleep: "",
  goal: "",
};

export default function MASIChatbot() {
  const [phase, setPhase] = useState<"input" | "chat">("input");
  const [form, setForm] = useState<SignsbeatData>(INITIAL_FORM);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeAgents, setActiveAgents] = useState<string[]>([]);
  const [agentPhase, setAgentPhase] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cycle active agents during streaming to show "swarm thinking"
  useEffect(() => {
    if (!isStreaming) {
      setActiveAgents([]);
      return;
    }
    const cycle = setInterval(() => {
      setAgentPhase((p) => (p + 1) % AGENTS.length);
      const count = Math.floor(Math.random() * 3) + 2;
      const shuffled = [...AGENTS].sort(() => Math.random() - 0.5);
      setActiveAgents(shuffled.slice(0, count).map((a) => a.id));
    }, 600);
    return () => clearInterval(cycle);
  }, [isStreaming]);

  async function startSession() {
    setPhase("chat");
    const openingMessage =
      `I'm starting my MASI session. Here are my Signsbeat metrics:\n\n` +
      `• Date: ${form.date}\n` +
      `• SB Score: ${form.sbScore || "not provided"}\n` +
      `• Pro_Recovery: ${form.recovery || "?"}%\n` +
      `• Pro_MildStress: ${form.mildStress || "?"}%\n` +
      `• Pro_Stress: ${form.stress || "?"}%\n` +
      `• Pro_Positive: ${form.proPositive || "not provided"}\n` +
      `• Pro_Negative: ${form.proNegative || "not provided"}\n` +
      `• HRV: ${form.hrv || "not provided"} ms\n` +
      `• Resting HR: ${form.hr || "not provided"} bpm\n` +
      `• Deep Sleep: ${form.deepSleep || "not provided"}%\n` +
      `• Total Sleep: ${form.totalSleep || "not provided"} hrs\n` +
      `• My goal: ${form.goal || "general optimization"}`;

    const userMsg: Message = { role: "user", content: openingMessage };
    const updatedMessages = [userMsg];
    setMessages(updatedMessages);
    await streamResponse(updatedMessages);
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
    setMessages((prev) => [...prev, assistantMsg]);

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

      if (!res.ok) throw new Error("API error");

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
          if (line.startsWith("data: ")) {
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
      }
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: "Connection error. Please try again.",
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const sbScore = parseInt(form.sbScore) || 0;
  const recovPct = parseInt(form.recovery) || 0;
  const msPct = parseInt(form.mildStress) || 0;
  const stressPct = parseInt(form.stress) || 0;

  if (phase === "input") {
    return (
      <div className="min-h-screen bg-sb-dark flex flex-col">
        {/* Header */}
        <header className="border-b border-sb-border px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
              SB
            </div>
            <div>
              <h1 className="text-white font-semibold text-sm tracking-wide">
                Signsbeat MASI
              </h1>
              <p className="text-sb-muted text-xs">
                Multi-Agent Swarm Intelligence
              </p>
            </div>
          </div>
          <Link
            href="/settings"
            className="flex items-center gap-1.5 text-xs text-sb-muted hover:text-sb-text border border-sb-border hover:border-indigo-500 rounded-lg px-3 py-1.5 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            API Settings
          </Link>
        </header>

        {/* Input Form */}
        <main className="flex-1 flex items-start justify-center px-4 py-10 overflow-y-auto">
          <div className="w-full max-w-2xl">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/30 rounded-full text-indigo-400 text-xs mb-4">
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse" />
                Layer 5 — Dynamic Survey Swarm
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">
                Enter Your Signsbeat Data
              </h2>
              <p className="text-sb-muted text-sm">
                The MASI swarm will analyze your physiological state and guide
                you with adaptive, targeted questions.
              </p>
            </div>

            <div className="bg-sb-card border border-sb-border rounded-2xl p-6 space-y-5">
              {/* Date + Goal */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">
                    Date
                  </label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">
                    SB Score (0–100)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    placeholder="e.g. 68"
                    value={form.sbScore}
                    onChange={(e) =>
                      setForm({ ...form, sbScore: e.target.value })
                    }
                    className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500 placeholder-sb-muted"
                  />
                </div>
              </div>

              {/* Pro_State */}
              <div>
                <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">
                  Pro_State Distribution (%)
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-sb-recovery mb-1">
                      Pro_Recovery
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="e.g. 55"
                      value={form.recovery}
                      onChange={(e) =>
                        setForm({ ...form, recovery: e.target.value })
                      }
                      className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-recovery text-sm focus:outline-none focus:border-sb-recovery placeholder-sb-muted"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-sb-mildstress mb-1">
                      Pro_MildStress
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="e.g. 30"
                      value={form.mildStress}
                      onChange={(e) =>
                        setForm({ ...form, mildStress: e.target.value })
                      }
                      className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-mildstress text-sm focus:outline-none focus:border-sb-mildstress placeholder-sb-muted"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-sb-stress mb-1">
                      Pro_Stress
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="e.g. 15"
                      value={form.stress}
                      onChange={(e) =>
                        setForm({ ...form, stress: e.target.value })
                      }
                      className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-stress text-sm focus:outline-none focus:border-sb-stress placeholder-sb-muted"
                    />
                  </div>
                </div>
                {recovPct + msPct + stressPct > 0 && (
                  <div className="mt-2 flex h-1.5 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${recovPct}%` }}
                      className="bg-sb-recovery"
                    />
                    <div
                      style={{ width: `${msPct}%` }}
                      className="bg-sb-mildstress"
                    />
                    <div
                      style={{ width: `${stressPct}%` }}
                      className="bg-sb-stress"
                    />
                  </div>
                )}
              </div>

              {/* Pro_Positive / Negative */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-sb-positive mb-1.5 uppercase tracking-wider">
                    Pro_Positive
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    placeholder="e.g. 0.72"
                    value={form.proPositive}
                    onChange={(e) =>
                      setForm({ ...form, proPositive: e.target.value })
                    }
                    className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500 placeholder-sb-muted"
                  />
                </div>
                <div>
                  <label className="block text-xs text-sb-negative mb-1.5 uppercase tracking-wider">
                    Pro_Negative
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    placeholder="e.g. 0.28"
                    value={form.proNegative}
                    onChange={(e) =>
                      setForm({ ...form, proNegative: e.target.value })
                    }
                    className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500 placeholder-sb-muted"
                  />
                </div>
              </div>

              {/* Biometrics */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">
                    HRV (ms)
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 42"
                    value={form.hrv}
                    onChange={(e) => setForm({ ...form, hrv: e.target.value })}
                    className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500 placeholder-sb-muted"
                  />
                </div>
                <div>
                  <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">
                    Resting HR (bpm)
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 58"
                    value={form.hr}
                    onChange={(e) => setForm({ ...form, hr: e.target.value })}
                    className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500 placeholder-sb-muted"
                  />
                </div>
              </div>

              {/* Sleep */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">
                    Deep Sleep (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    placeholder="e.g. 18"
                    value={form.deepSleep}
                    onChange={(e) =>
                      setForm({ ...form, deepSleep: e.target.value })
                    }
                    className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500 placeholder-sb-muted"
                  />
                </div>
                <div>
                  <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">
                    Total Sleep (hrs)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="e.g. 7.2"
                    value={form.totalSleep}
                    onChange={(e) =>
                      setForm({ ...form, totalSleep: e.target.value })
                    }
                    className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500 placeholder-sb-muted"
                  />
                </div>
              </div>

              {/* Goal */}
              <div>
                <label className="block text-xs text-sb-muted mb-1.5 uppercase tracking-wider">
                  What is your goal for this session?
                </label>
                <input
                  type="text"
                  placeholder="e.g. Improve recovery, understand why my score dropped, optimize sleep..."
                  value={form.goal}
                  onChange={(e) => setForm({ ...form, goal: e.target.value })}
                  className="w-full bg-sb-dark border border-sb-border rounded-lg px-3 py-2 text-sb-text text-sm focus:outline-none focus:border-indigo-500 placeholder-sb-muted"
                />
              </div>

              <button
                onClick={startSession}
                disabled={!form.sbScore && !form.recovery}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all text-sm"
              >
                Activate MASI Swarm →
              </button>

              <p className="text-xs text-sb-muted text-center">
                At least SB Score or Pro_State percentages are required to begin
              </p>
            </div>

            {/* Agent preview */}
            <div className="mt-6 grid grid-cols-4 gap-2">
              {AGENTS.map((a) => (
                <div
                  key={a.id}
                  className="bg-sb-card border border-sb-border rounded-lg px-2 py-2 flex items-center gap-1.5"
                >
                  <span className="text-base">{a.icon}</span>
                  <span className="text-xs text-sb-muted">{a.label}</span>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sb-dark flex flex-col">
      {/* Header */}
      <header className="border-b border-sb-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
            SB
          </div>
          <div>
            <h1 className="text-white font-semibold text-sm">
              Signsbeat MASI
            </h1>
            <p className="text-sb-muted text-xs">Dynamic Survey Swarm — Active</p>
          </div>
        </div>

        {/* Score summary chips */}
        <div className="hidden sm:flex items-center gap-2">
          {form.sbScore && (
            <div className="flex items-center gap-1.5 bg-sb-card border border-sb-border rounded-lg px-2.5 py-1">
              <span className="text-xs text-sb-muted">SB</span>
              <span className={`text-sm font-bold ${getSbScoreColor(sbScore)}`}>
                {form.sbScore}
              </span>
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
          <button
            onClick={() => {
              setPhase("input");
              setMessages([]);
            }}
            className="text-xs text-sb-muted hover:text-sb-text border border-sb-border rounded-lg px-2.5 py-1 hover:border-indigo-500 transition-colors"
          >
            New Session
          </button>
          <Link
            href="/settings"
            className="flex items-center gap-1 text-xs text-sb-muted hover:text-sb-text border border-sb-border rounded-lg px-2.5 py-1 hover:border-indigo-500 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </Link>
        </div>
      </header>

      {/* Agent swarm indicator */}
      <div className="border-b border-sb-border px-4 py-2 flex items-center gap-2 overflow-x-auto">
        <span className="text-xs text-sb-muted whitespace-nowrap mr-1">
          Active agents:
        </span>
        {AGENTS.map((a) => (
          <div
            key={a.id}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-all duration-300 whitespace-nowrap ${
              activeAgents.includes(a.id)
                ? "border-indigo-500/50 bg-indigo-500/10 " + a.color + " agent-active"
                : "border-sb-border text-sb-muted"
            }`}
          >
            <span>{a.icon}</span>
            <span>{a.label}</span>
          </div>
        ))}
      </div>

      {/* Chat messages */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-slide-up`}
          >
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold mr-2 mt-0.5 flex-shrink-0">
                M
              </div>
            )}
            <div
              className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm ${
                msg.role === "user"
                  ? "bg-indigo-600/20 border border-indigo-500/30 text-sb-text rounded-tr-sm"
                  : "bg-sb-card border border-sb-border text-sb-text rounded-tl-sm"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="prose-chat leading-relaxed">
                  {formatMessage(msg.content)}
                  {isStreaming && i === messages.length - 1 && msg.content === "" && (
                    <div className="flex gap-1 items-center py-1">
                      <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
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

      {/* Input area */}
      <div className="border-t border-sb-border px-4 py-3">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            placeholder={
              isStreaming
                ? "MASI swarm is analyzing..."
                : "Answer the question above, or ask anything about your data..."
            }
            rows={1}
            className="flex-1 bg-sb-card border border-sb-border rounded-xl px-4 py-3 text-sb-text text-sm placeholder-sb-muted focus:outline-none focus:border-indigo-500 resize-none disabled:opacity-50"
            style={{ maxHeight: "120px" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl flex items-center justify-center transition-all"
          >
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </div>
        <p className="text-center text-xs text-sb-muted mt-2">
          Pattern analysis only — not medical advice · T-1 Rule applied · Signsbeat MASI v1.0
        </p>
      </div>
    </div>
  );
}
