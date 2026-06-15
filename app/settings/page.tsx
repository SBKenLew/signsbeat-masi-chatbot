"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const PROVIDERS = [
  {
    id: "deepseek",
    name: "DeepSeek",
    logo: "◎",
    color: "from-blue-500 to-cyan-500",
    border: "border-blue-500/40",
    placeholder: "sk-...",
    docsUrl: "https://platform.deepseek.com/api_keys",
    description: "DeepSeek-V3 — default MASI engine",
  },
  {
    id: "openai",
    name: "OpenAI",
    logo: "⬡",
    color: "from-green-500 to-teal-500",
    border: "border-green-500/40",
    placeholder: "sk-proj-...",
    docsUrl: "https://platform.openai.com/api-keys",
    description: "GPT-4o / GPT-4 Turbo",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    logo: "✦",
    color: "from-orange-500 to-red-500",
    border: "border-orange-500/40",
    placeholder: "sk-ant-api03-...",
    docsUrl: "https://console.anthropic.com/",
    description: "Claude Sonnet",
  },
];

type ProviderId = "deepseek" | "openai" | "anthropic";

interface StoredKeys {
  deepseek: string;
  openai: string;
  anthropic: string;
  active: ProviderId;
}

const STORAGE_KEY = "masi_llm_config";

function loadConfig(): StoredKeys {
  if (typeof window === "undefined")
    return { deepseek: "", openai: "", anthropic: "", active: "deepseek" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { deepseek: "", openai: "", anthropic: "", active: "deepseek" };
    return JSON.parse(raw);
  } catch {
    return { deepseek: "", openai: "", anthropic: "", active: "deepseek" };
  }
}

export default function SettingsPage() {
  const router = useRouter();
  const [config, setConfig] = useState<StoredKeys>({
    deepseek: "",
    openai: "",
    anthropic: "",
    active: "deepseek",
  });
  const [showKey, setShowKey] = useState<Record<ProviderId, boolean>>({
    deepseek: false,
    openai: false,
    anthropic: false,
  });
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setConfig(loadConfig());
    setMounted(true);
  }, []);

  function handleSave() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleClear(id: ProviderId) {
    const updated = { ...config, [id]: "" };
    setConfig(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }

  function maskKey(key: string) {
    if (!key) return "";
    if (key.length <= 8) return "•".repeat(key.length);
    return key.slice(0, 6) + "•".repeat(Math.min(key.length - 10, 20)) + key.slice(-4);
  }

  const activeProvider = PROVIDERS.find((p) => p.id === config.active)!;

  if (!mounted) return null;

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
            <p className="text-sb-muted text-xs">API Settings</p>
          </div>
        </div>
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-1.5 text-xs text-sb-muted hover:text-sb-text border border-sb-border hover:border-indigo-500 rounded-lg px-3 py-1.5 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to MASI
        </button>
      </header>

      <main className="flex-1 px-4 py-10 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Page title */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/30 rounded-full text-indigo-400 text-xs mb-4">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              LLM Configuration
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">API Key Settings</h2>
            <p className="text-sb-muted text-sm">
              Your API keys are stored locally in your browser. They are never sent to any server other than the selected AI provider.
            </p>
          </div>

          {/* Active provider badge */}
          <div className="bg-sb-card border border-sb-border rounded-2xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${activeProvider.color} flex items-center justify-center text-white font-bold text-sm`}>
                {activeProvider.logo}
              </div>
              <div>
                <p className="text-white text-sm font-medium">Active Provider</p>
                <p className="text-sb-muted text-xs">{activeProvider.name} — {activeProvider.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${config[config.active] ? "bg-sb-recovery animate-pulse" : "bg-sb-stress"}`} />
              <span className={`text-xs ${config[config.active] ? "text-sb-recovery" : "text-sb-stress"}`}>
                {config[config.active] ? "Key set" : "No key"}
              </span>
            </div>
          </div>

          {/* Provider cards */}
          {PROVIDERS.map((provider) => {
            const id = provider.id as ProviderId;
            const isActive = config.active === id;
            const hasKey = !!config[id];
            const isVisible = showKey[id];

            return (
              <div
                key={id}
                className={`bg-sb-card border rounded-2xl p-5 transition-all ${
                  isActive ? `${provider.border} shadow-lg` : "border-sb-border"
                }`}
              >
                {/* Provider header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${provider.color} flex items-center justify-center text-white font-bold`}>
                      {provider.logo}
                    </div>
                    <div>
                      <p className="text-white font-medium text-sm">{provider.name}</p>
                      <p className="text-sb-muted text-xs">{provider.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasKey && (
                      <span className="flex items-center gap-1 text-xs text-sb-recovery bg-sb-recovery/10 border border-sb-recovery/20 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-sb-recovery" />
                        Saved
                      </span>
                    )}
                    <button
                      onClick={() => setConfig({ ...config, active: id })}
                      className={`text-xs px-3 py-1 rounded-lg border transition-all ${
                        isActive
                          ? `bg-gradient-to-r ${provider.color} border-transparent text-white font-medium`
                          : "border-sb-border text-sb-muted hover:border-indigo-500 hover:text-sb-text"
                      }`}
                    >
                      {isActive ? "Active" : "Set Active"}
                    </button>
                  </div>
                </div>

                {/* Key input */}
                <div className="space-y-2">
                  <label className="block text-xs text-sb-muted uppercase tracking-wider">
                    API Key
                  </label>
                  <div className="relative flex items-center gap-2">
                    <input
                      type={isVisible ? "text" : "password"}
                      value={config[id]}
                      onChange={(e) => setConfig({ ...config, [id]: e.target.value })}
                      placeholder={provider.placeholder}
                      autoComplete="off"
                      spellCheck={false}
                      className="flex-1 bg-sb-dark border border-sb-border rounded-xl px-4 py-2.5 text-sb-text text-sm font-mono focus:outline-none focus:border-indigo-500 placeholder-sb-muted pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey({ ...showKey, [id]: !isVisible })}
                      className="absolute right-3 text-sb-muted hover:text-sb-text transition-colors"
                      title={isVisible ? "Hide key" : "Show key"}
                    >
                      {isVisible ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>

                  {/* Masked preview + actions */}
                  {hasKey && (
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-sb-muted font-mono">
                        {maskKey(config[id])}
                      </p>
                      <button
                        onClick={() => handleClear(id)}
                        className="text-xs text-sb-stress hover:text-red-400 transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                  )}

                  {/* Docs link */}
                  <p className="text-xs text-sb-muted">
                    Get your key from{" "}
                    <span className="text-indigo-400 underline cursor-default">
                      {provider.docsUrl}
                    </span>
                  </p>
                </div>
              </div>
            );
          })}

          {/* Save button */}
          <button
            onClick={handleSave}
            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold py-3 rounded-xl transition-all text-sm flex items-center justify-center gap-2"
          >
            {saved ? (
              <>
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Saved to browser
              </>
            ) : (
              "Save Settings"
            )}
          </button>

          {/* Security note */}
          <div className="bg-sb-card border border-sb-border rounded-xl p-4 flex gap-3">
            <svg className="w-4 h-4 text-sb-muted mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <div>
              <p className="text-xs text-sb-muted leading-relaxed">
                <span className="text-sb-text font-medium">Security notice:</span> Keys are saved in <code className="text-indigo-400 bg-indigo-500/10 px-1 rounded">localStorage</code> on this device only. They are passed to the API route at runtime and never logged or stored server-side. Clear your browser data to remove them.
              </p>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
