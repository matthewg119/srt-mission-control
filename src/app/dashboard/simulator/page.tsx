"use client";

// SMS Simulator — 6 phone slots to test the voice bot in a sandbox, plus a
// per-phone flip switch that turns a phone into a training surface.
//
// TEST mode:  type as the merchant, the bot replies using the REAL draft logic
//             (generateDraft) with live persona + voice retrieval. Nothing is sent;
//             everything lives in sim_* tables.
// TRAIN mode: see/curate the real example pairs ("the other side"), teach the bot by
//             editing its last draft into a golden example, and edit the persona live.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Smartphone,
  Send,
  RotateCcw,
  Star,
  ChevronDown,
  ChevronUp,
  Save,
  Trash2,
  Sparkles,
  ImagePlus,
  Check,
  Radio,
  ExternalLink,
} from "lucide-react";

type Stage = number | null;

interface SimMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  is_golden: boolean;
  edited_from: string | null;
  created_at: string;
}

interface Phone {
  id: string;
  phone_slot: number;
  label: string;
  stage: Stage;
  mode: "test" | "train";
  messages: SimMessage[];
}

interface VoiceExample {
  id: string;
  source: string;
  incoming: string;
  reply: string;
  char_len: number | null;
  is_golden: boolean;
  is_active: boolean;
}

const STAGE_LABELS: Record<string, string> = {
  null: "Adaptive",
  "1": "1 · Soft Pitch",
  "2": "2 · Wisdom Window",
  "3": "3 · UW Drama",
  "4": "4 · Close",
};

const teal = "#00C9A7";

export default function SimulatorPage() {
  const [dataMode, setDataMode] = useState<"demo" | "real">("demo");
  const [phones, setPhones] = useState<Phone[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalVoice, setTotalVoice] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/simulator/conversations");
    const data = await res.json();
    setPhones(data.phones ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    fetch("/api/voice-examples?limit=1")
      .then((r) => r.json())
      .then((d) => setTotalVoice(d.total ?? 0))
      .catch(() => {});
  }, [load]);

  const updatePhone = (id: string, patch: Partial<Phone>) =>
    setPhones((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const resetBoard = async () => {
    await fetch("/api/simulator/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset" }),
    });
    load();
  };

  const isReal = dataMode === "real";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <HeaderLogo />
          <div>
            <h1 className="text-xl font-semibold text-white">SalesTwin 3.0</h1>
            <p className="text-xs text-[rgba(255,255,255,0.4)]">
              {isReal ? (
                "Live conversations · replies send straight to the lead"
              ) : (
                <>
                  Sandbox · nothing is sent
                  {totalVoice != null && ` · ${totalVoice.toLocaleString()} voice examples in training data`}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MacBridgeStatus />
          <button
            onClick={() => setDataMode(isReal ? "demo" : "real")}
            title={isReal ? "Switch to the demo sandbox" : "Switch to live conversations"}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg text-[rgba(255,255,255,0.6)] hover:text-white hover:bg-[rgba(255,255,255,0.1)]"
          >
            <Radio size={13} className={isReal ? "text-[#00C9A7]" : ""} />
            {isReal ? "Real" : "Demo"}
          </button>
          {!isReal && (
            <button
              onClick={resetBoard}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg text-[rgba(255,255,255,0.6)] hover:text-white hover:bg-[rgba(255,255,255,0.1)]"
            >
              <RotateCcw size={13} /> Reset all
            </button>
          )}
        </div>
      </div>

      {isReal ? (
        <RealMode />
      ) : loading ? (
        <p className="text-sm text-[rgba(255,255,255,0.4)]">Loading phones…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {phones.map((phone) => (
            <PhoneCard
              key={phone.id}
              phone={phone}
              onChange={(patch) => updatePhone(phone.id, patch)}
              onReloadVoiceCount={() =>
                fetch("/api/voice-examples?limit=1")
                  .then((r) => r.json())
                  .then((d) => setTotalVoice(d.total ?? 0))
                  .catch(() => {})
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Phone card ────────────────────────────────────────────────────────────────

function PhoneCard({
  phone,
  onChange,
  onReloadVoiceCount,
}: {
  phone: Phone;
  onChange: (patch: Partial<Phone>) => void;
  onReloadVoiceCount: () => void;
}) {
  const setStage = async (stage: Stage) => {
    onChange({ stage });
    await fetch("/api/simulator/conversations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: phone.id, stage }),
    });
  };

  const setMode = async (mode: "test" | "train") => {
    onChange({ mode });
    await fetch("/api/simulator/conversations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: phone.id, mode }),
    });
  };

  return (
    <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] flex flex-col overflow-hidden" style={{ height: "560px" }}>
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-[rgba(255,255,255,0.06)] flex items-center gap-2">
        <span className="text-xs font-semibold text-white">{phone.label}</span>
        <select
          value={String(phone.stage)}
          onChange={(e) => setStage(e.target.value === "null" ? null : Number(e.target.value))}
          className="ml-auto bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-2 py-1 text-[11px] text-[rgba(255,255,255,0.7)] focus:outline-none focus:border-[#00C9A7]"
        >
          {Object.entries(STAGE_LABELS).map(([val, label]) => (
            <option key={val} value={val} className="bg-[#0a0a0a]">
              {label}
            </option>
          ))}
        </select>
        <FlipSwitch mode={phone.mode} onToggle={() => setMode(phone.mode === "test" ? "train" : "test")} />
      </div>

      {phone.mode === "test" ? (
        <TestMode phone={phone} onChange={onChange} />
      ) : (
        <TrainMode phone={phone} onReloadVoiceCount={onReloadVoiceCount} />
      )}
    </div>
  );
}

function FlipSwitch({ mode, onToggle }: { mode: "test" | "train"; onToggle: () => void }) {
  const isTrain = mode === "train";
  return (
    <button
      onClick={onToggle}
      title="Flip between Test and Train"
      className="relative inline-flex items-center h-6 rounded-full px-1 transition-colors"
      style={{ width: "92px", background: isTrain ? "rgba(245,166,35,0.25)" : "rgba(0,201,167,0.18)" }}
    >
      <span
        className="absolute top-0.5 bottom-0.5 rounded-full transition-all"
        style={{
          width: "44px",
          left: isTrain ? "46px" : "2px",
          background: isTrain ? "#F5A623" : teal,
        }}
      />
      <span className="relative z-10 flex-1 text-[9px] font-bold text-[#0a0a0a]" style={{ opacity: isTrain ? 0.4 : 1 }}>
        TEST
      </span>
      <span className="relative z-10 flex-1 text-[9px] font-bold text-[#0a0a0a]" style={{ opacity: isTrain ? 1 : 0.4 }}>
        TRAIN
      </span>
    </button>
  );
}

// ─── Test mode (run a sandbox conversation) ──────────────────────────────────────

function TestMode({ phone, onChange }: { phone: Phone; onChange: (patch: Partial<Phone>) => void }) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [debug, setDebug] = useState<{ examples: { incoming: string; reply: string }[]; personaSource: string; followup: { days: number; reason: string } | null } | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    // Optimistic inbound bubble.
    const tempId = `temp-${Date.now()}`;
    onChange({
      messages: [
        ...phone.messages,
        { id: tempId, direction: "inbound", body: text, is_golden: false, edited_from: null, created_at: new Date().toISOString() },
      ],
    });
    try {
      const res = await fetch("/api/simulator/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simConversationId: phone.id, inbound: text }),
      });
      const data = await res.json();
      const next = phone.messages.filter((m) => m.id !== tempId);
      if (data.inbound) next.push(data.inbound);
      if (data.outbound) next.push(data.outbound);
      onChange({ messages: next });
      setDebug({ examples: data.voiceExamples ?? [], personaSource: data.personaSource ?? "?", followup: data.suggestedFollowup ?? null });
    } catch {
      // leave optimistic bubble; user can retry
    }
    setSending(false);
  };

  const resetThread = async () => {
    await fetch("/api/simulator/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset", id: phone.id }),
    });
    onChange({ messages: [] });
    setDebug(null);
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {phone.messages.length === 0 ? (
          <p className="text-[11px] text-[rgba(255,255,255,0.3)] text-center pt-6">
            Type as the merchant to test the bot’s reply.
          </p>
        ) : (
          phone.messages.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-start" : "justify-end"}`}>
              <div
                className="rounded-xl px-3 py-2 text-[12px] whitespace-pre-wrap"
                style={{
                  maxWidth: "82%",
                  background: m.direction === "outbound" ? teal : "rgba(255,255,255,0.08)",
                  color: m.direction === "outbound" ? "#0a0a0a" : "#fff",
                }}
              >
                {m.body}
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-xl px-3 py-2 bg-[rgba(255,255,255,0.05)]">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00C9A7] animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#00C9A7] animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#00C9A7] animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Debug: retrieved voice examples */}
      {debug && (
        <div className="border-t border-[rgba(255,255,255,0.06)] px-3 py-1.5">
          <button
            onClick={() => setShowDebug((s) => !s)}
            className="flex items-center gap-1 text-[10px] text-[rgba(255,255,255,0.4)] hover:text-[#00C9A7]"
          >
            {showDebug ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
            persona: {debug.personaSource} · {debug.examples.length} voice matches
            {debug.followup && ` · 📅 follow-up in ${debug.followup.days}d`}
          </button>
          {showDebug && (
            <div className="mt-1.5 space-y-1 max-h-28 overflow-y-auto">
              {debug.examples.map((ex, i) => (
                <div key={i} className="text-[10px] leading-snug text-[rgba(255,255,255,0.45)]">
                  <span className="text-[rgba(255,255,255,0.3)]">↳ </span>
                  {ex.incoming.slice(0, 40)} → <span className="text-[#00C9A7]">{ex.reply.slice(0, 40)}</span>
                </div>
              ))}
              {debug.examples.length === 0 && <p className="text-[10px] text-[rgba(255,255,255,0.3)]">no matches</p>}
            </div>
          )}
        </div>
      )}

      <div className="p-2.5 border-t border-[rgba(255,255,255,0.06)] flex gap-1.5 items-end">
        <button onClick={resetThread} title="Clear thread" className="p-2 rounded-lg text-[rgba(255,255,255,0.4)] hover:text-white hover:bg-[rgba(255,255,255,0.06)]">
          <RotateCcw size={13} />
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Message as merchant…"
          className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-[12px] text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7] resize-none"
          style={{ maxHeight: "80px" }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || sending}
          className="p-2 bg-[#00C9A7] text-[#0a0a0a] rounded-lg hover:opacity-90 disabled:opacity-40"
        >
          <Send size={14} />
        </button>
      </div>
    </>
  );
}

// ─── Train mode (curate + teach + persona) ───────────────────────────────────────

type TrainTab = "teach" | "examples" | "persona" | "tune";

const TRAIN_TAB_LABELS: Record<TrainTab, string> = {
  teach: "Teach",
  examples: "Example pairs",
  persona: "Persona",
  tune: "AI Tune",
};

function TrainMode({ phone, onReloadVoiceCount }: { phone: Phone; onReloadVoiceCount: () => void }) {
  const [tab, setTab] = useState<TrainTab>("teach");
  return (
    <>
      <div className="flex border-b border-[rgba(255,255,255,0.06)] text-[10px]">
        {(["teach", "examples", "persona", "tune"] as TrainTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 transition-colors ${
              tab === t ? "text-[#F5A623] border-b-2 border-[#F5A623]" : "text-[rgba(255,255,255,0.4)] hover:text-white"
            }`}
          >
            {TRAIN_TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === "teach" && <TeachTab phone={phone} onReloadVoiceCount={onReloadVoiceCount} />}
        {tab === "examples" && <ExamplesTab onReloadVoiceCount={onReloadVoiceCount} />}
        {tab === "persona" && <PersonaTab stage={phone.stage} />}
        {tab === "tune" && <TuneTab stage={phone.stage} />}
      </div>
    </>
  );
}

function TeachTab({ phone, onReloadVoiceCount }: { phone: Phone; onReloadVoiceCount: () => void }) {
  const lastOutbound = [...phone.messages].reverse().find((m) => m.direction === "outbound");
  const lastInbound = [...phone.messages].reverse().find((m) => m.direction === "inbound");
  const [draft, setDraft] = useState(lastOutbound?.body ?? "");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(lastOutbound?.body ?? "");
    setSaved(false);
  }, [lastOutbound?.id, lastOutbound?.body]);

  if (!lastOutbound || !lastInbound) {
    return (
      <p className="text-[11px] text-[rgba(255,255,255,0.35)] p-4 text-center">
        Run a message in Test mode first, then flip here to teach the bot a better reply.
      </p>
    );
  }

  const teach = async () => {
    // Persist the edit on the sim message, then promote it as a golden example.
    if (draft.trim() && draft.trim() !== lastOutbound.body) {
      await fetch("/api/simulator/messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lastOutbound.id, action: "edit", body: draft.trim() }),
      });
    }
    await fetch("/api/simulator/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: lastOutbound.id, action: "promote" }),
    });
    setSaved(true);
    onReloadVoiceCount();
  };

  return (
    <div className="p-3 space-y-3">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-[rgba(255,255,255,0.3)] mb-1">Merchant said</p>
        <div className="rounded-lg bg-[rgba(255,255,255,0.05)] px-3 py-2 text-[12px] text-white whitespace-pre-wrap">
          {lastInbound.body}
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-[rgba(255,255,255,0.3)] mb-1">
          Teach the ideal reply (edit the bot’s draft)
        </p>
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
          rows={4}
          className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-[12px] text-white focus:outline-none focus:border-[#F5A623] resize-none"
        />
      </div>
      <button
        onClick={teach}
        disabled={!draft.trim()}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-[#F5A623] text-[#0a0a0a] rounded-lg font-semibold hover:opacity-90 disabled:opacity-40"
      >
        <Star size={12} /> Save as golden example
      </button>
      {saved && <span className="ml-2 text-[11px] text-[#00C9A7]">Saved — the bot will mimic this.</span>}
    </div>
  );
}

function ExamplesTab({ onReloadVoiceCount }: { onReloadVoiceCount: () => void }) {
  const [search, setSearch] = useState("");
  const [examples, setExamples] = useState<VoiceExample[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "40" });
    if (q.trim()) params.set("search", q.trim());
    const res = await fetch(`/api/voice-examples?${params}`);
    const data = await res.json();
    setExamples(data.examples ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search), 250);
    return () => clearTimeout(t);
  }, [search, load]);

  const patch = async (id: string, action: string, extra: Record<string, unknown> = {}) => {
    const res = await fetch("/api/voice-examples", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, ...extra }),
    });
    const data = await res.json();
    if (action === "deactivate") {
      setExamples((prev) => prev.filter((e) => e.id !== id));
      onReloadVoiceCount();
    } else if (data.example) {
      setExamples((prev) => prev.map((e) => (e.id === id ? data.example : e)));
    }
  };

  return (
    <div className="p-3 space-y-2">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search the other side…"
        className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-1.5 text-[12px] text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#F5A623]"
      />
      {loading && <p className="text-[11px] text-[rgba(255,255,255,0.3)]">Searching…</p>}
      {examples.map((ex) => (
        <div key={ex.id} className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-2">
          <p className="text-[11px] text-[rgba(255,255,255,0.5)]">
            <span className="text-[rgba(255,255,255,0.3)]">Them: </span>
            {ex.incoming}
          </p>
          <p className="text-[11px] text-white mt-0.5">
            <span className="text-[rgba(255,255,255,0.3)]">Matthew: </span>
            {ex.reply}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <button
              onClick={() => patch(ex.id, "golden", { value: !ex.is_golden })}
              className={`inline-flex items-center gap-1 text-[10px] ${ex.is_golden ? "text-[#F5A623]" : "text-[rgba(255,255,255,0.35)] hover:text-[#F5A623]"}`}
            >
              <Star size={11} fill={ex.is_golden ? "#F5A623" : "none"} /> {ex.is_golden ? "Golden" : "Mark golden"}
            </button>
            <button
              onClick={() => patch(ex.id, "deactivate")}
              className="inline-flex items-center gap-1 text-[10px] text-[rgba(255,255,255,0.35)] hover:text-[#E74C3C]"
            >
              <Trash2 size={11} /> Remove
            </button>
            <span className="ml-auto text-[9px] text-[rgba(255,255,255,0.25)]">{ex.source}</span>
          </div>
        </div>
      ))}
      {!loading && examples.length === 0 && (
        <p className="text-[11px] text-[rgba(255,255,255,0.3)] text-center py-3">No examples found.</p>
      )}
    </div>
  );
}

interface PersonaRow {
  id: string;
  stage: number | null;
  prompt: string;
  version: number;
}

function PersonaTab({ stage }: { stage: Stage }) {
  const [rows, setRows] = useState<PersonaRow[]>([]);
  const [prompt, setPrompt] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  const stageKey = stage == null ? "Adaptive / base" : STAGE_LABELS[String(stage)];

  const load = useCallback(async () => {
    const res = await fetch("/api/persona");
    const data = await res.json();
    const persona: PersonaRow[] = data.persona ?? [];
    setRows(persona);
    const match = persona.find((r) => (r.stage ?? null) === (stage ?? null));
    setPrompt(match?.prompt ?? "");
    setLoaded(true);
  }, [stage]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    await fetch("/api/persona", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, prompt }),
    });
    setSaved(true);
    load();
  };

  const current = rows.find((r) => (r.stage ?? null) === (stage ?? null));

  return (
    <div className="p-3 space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-[rgba(255,255,255,0.3)]">
        Persona prompt · {stageKey}
        {current && <span className="ml-1 text-[rgba(255,255,255,0.25)]">v{current.version}</span>}
      </p>
      {!loaded ? (
        <p className="text-[11px] text-[rgba(255,255,255,0.3)]">Loading…</p>
      ) : (
        <>
          {rows.length === 0 && (
            <p className="text-[10px] text-[rgba(255,255,255,0.35)] leading-snug">
              No DB persona yet — the bot uses the built-in default for this stage. Save here to override it live.
            </p>
          )}
          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setSaved(false);
            }}
            rows={10}
            placeholder="Write the system prompt for this stage…"
            className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-[11px] text-white focus:outline-none focus:border-[#F5A623] resize-none leading-relaxed"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={!prompt.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-[#F5A623] text-[#0a0a0a] rounded-lg font-semibold hover:opacity-90 disabled:opacity-40"
            >
              <Save size={12} /> Save persona
            </button>
            {saved && <span className="text-[11px] text-[#00C9A7]">Live — next draft uses it.</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Phase B: AI persona tuner (meta-chat with optional screenshot) ──────────────

interface TuneMsg {
  role: "user" | "assistant";
  content: string;
  proposal?: { prompt: string; style_profile?: Record<string, unknown> } | null;
}

function TuneTab({ stage }: { stage: Stage }) {
  const [currentPrompt, setCurrentPrompt] = useState<string>("");
  const [messages, setMessages] = useState<TuneMsg[]>([]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageType, setImageType] = useState<string>("image/png");
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);

  const stageKey = stage == null ? "Adaptive / base" : STAGE_LABELS[String(stage)];

  useEffect(() => {
    fetch("/api/persona")
      .then((r) => r.json())
      .then((d) => {
        const row = (d.persona ?? []).find((r: PersonaRow) => (r.stage ?? null) === (stage ?? null));
        setCurrentPrompt(row?.prompt ?? "");
      })
      .catch(() => {});
  }, [stage]);

  const pickImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setImage(reader.result as string);
      setImageType(file.type || "image/png");
    };
    reader.readAsDataURL(file);
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && !image) || busy) return;
    setBusy(true);
    const nextMsgs: TuneMsg[] = [...messages, { role: "user", content: text || "(screenshot)" }];
    setMessages(nextMsgs);
    setInput("");
    const sentImage = image;
    setImage(null);
    try {
      const res = await fetch("/api/persona/metachat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage,
          currentPrompt,
          messages: nextMsgs.map((m) => ({ role: m.role, content: m.content })),
          imageBase64: sentImage ?? undefined,
          imageMediaType: imageType,
        }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply ?? "(no reply)", proposal: data.proposal ?? null }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong." }]);
    }
    setBusy(false);
  };

  const applyProposal = async (proposal: { prompt: string; style_profile?: Record<string, unknown> }) => {
    await fetch("/api/persona", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, prompt: proposal.prompt, style_profile: proposal.style_profile ?? null, updated_by: "ai-tune" }),
    });
    setCurrentPrompt(proposal.prompt);
    setApplied(true);
    setTimeout(() => setApplied(false), 2500);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-1.5 border-b border-[rgba(255,255,255,0.06)] flex items-center gap-1.5">
        <Sparkles size={12} className="text-[#F5A623]" />
        <span className="text-[10px] text-[rgba(255,255,255,0.4)]">Tune persona · {stageKey}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <p className="text-[11px] text-[rgba(255,255,255,0.35)] leading-snug">
            Describe how the bot should sound, or paste a screenshot of texts to imitate. I’ll propose a new persona you can apply live.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className="rounded-xl px-3 py-2 text-[11px] whitespace-pre-wrap"
              style={{
                maxWidth: "88%",
                background: m.role === "user" ? teal : "rgba(255,255,255,0.06)",
                color: m.role === "user" ? "#0a0a0a" : "#fff",
              }}
            >
              {m.content}
              {m.proposal && (
                <div className="mt-2 pt-2 border-t border-[rgba(0,0,0,0.15)]">
                  <p className="text-[9px] uppercase tracking-wider opacity-60 mb-1">Proposed persona</p>
                  <p className="text-[10px] leading-snug opacity-90 max-h-24 overflow-y-auto">{m.proposal.prompt}</p>
                  <button
                    onClick={() => applyProposal(m.proposal!)}
                    className="mt-2 inline-flex items-center gap-1 px-2 py-1 text-[10px] bg-[#0a0a0a] text-white rounded-md hover:opacity-90"
                  >
                    <Check size={11} /> Apply live
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="text-[10px] text-[rgba(255,255,255,0.35)]">Thinking…</p>}
        {applied && <p className="text-[10px] text-[#00C9A7]">Applied — next draft uses it.</p>}
      </div>
      <div className="p-2.5 border-t border-[rgba(255,255,255,0.06)] space-y-1.5">
        {image && <p className="text-[10px] text-[#00C9A7]">screenshot attached</p>}
        <div className="flex gap-1.5 items-end">
          <label className="p-2 rounded-lg text-[rgba(255,255,255,0.4)] hover:text-white hover:bg-[rgba(255,255,255,0.06)] cursor-pointer">
            <ImagePlus size={13} />
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && pickImage(e.target.files[0])}
            />
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="How should it sound?"
            className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-[12px] text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#F5A623] resize-none"
            style={{ maxHeight: "80px" }}
          />
          <button
            onClick={send}
            disabled={busy || (!input.trim() && !image)}
            className="p-2 bg-[#F5A623] text-[#0a0a0a] rounded-lg hover:opacity-90 disabled:opacity-40"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Header logo (falls back to the phone glyph if the asset is missing) ─────────

function HeaderLogo() {
  const [ok, setOk] = useState(true);
  return (
    <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[rgba(0,201,167,0.1)] border border-[rgba(0,201,167,0.2)] overflow-hidden">
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/srt-logo.png" alt="SRT" className="w-6 h-6 object-contain" onError={() => setOk(false)} />
      ) : (
        <Smartphone size={20} className="text-[#00C9A7]" />
      )}
    </div>
  );
}

// ─── Mac bridge status pill ──────────────────────────────────────────────────────

function MacBridgeStatus() {
  const [state, setState] = useState<{ status: string; seconds_since: number | null } | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/imessage/status");
        const data = await res.json();
        if (alive) setState({ status: data.status ?? "offline", seconds_since: data.seconds_since ?? null });
      } catch {
        if (alive) setState({ status: "offline", seconds_since: null });
      }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const online = state?.status === "online";
  const color = online ? "#00C9A7" : "#E74C3C";
  const label = online
    ? `Mac bridge: Online${state?.seconds_since != null ? ` (${state.seconds_since}s ago)` : ""}`
    : "Mac bridge: Offline";

  return (
    <span
      title={label}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg text-[rgba(255,255,255,0.6)]"
    >
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

// ─── Real mode (live conversations) ──────────────────────────────────────────────

interface RealConversation {
  id: string;
  phone: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  zoho_lead_id: string | null;
  outcome: string;
  has_reply: boolean;
  last_message: { body: string; direction: string; created_at: string } | null;
}

function RealMode() {
  const [convs, setConvs] = useState<RealConversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/sms/conversations");
        const data = await res.json();
        if (alive) setConvs(data.conversations ?? []);
      } catch {
        // keep the prior list on a transient failure
      }
      if (alive) setLoading(false);
    };
    load();
    const t = setInterval(load, 6000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (loading) {
    return <p className="text-sm text-[rgba(255,255,255,0.4)]">Loading conversations…</p>;
  }
  if (convs.length === 0) {
    return (
      <p className="text-sm text-[rgba(255,255,255,0.4)]">
        No live conversations yet. They appear here as leads text in.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {convs.map((conv) => (
        <RealConversationCard key={conv.id} conv={conv} />
      ))}
    </div>
  );
}

interface RealMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  created_at: string;
}

interface PendingBubble {
  id: string;
  body: string;
}

function RealConversationCard({ conv }: { conv: RealConversation }) {
  const [messages, setMessages] = useState<RealMessage[]>([]);
  const [pending, setPending] = useState<PendingBubble[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDead = conv.outcome === "dead";

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/sms/conversations/${conv.id}/messages`);
        const data = await res.json();
        const msgs: RealMessage[] = data.messages ?? [];
        if (!alive) return;
        setMessages(msgs);
        // Drop optimistic bubbles once a real outbound row with the same body lands.
        setPending((prev) =>
          prev.filter((p) => !msgs.some((m) => m.direction === "outbound" && m.body.trim() === p.body.trim()))
        );
      } catch {
        // keep prior thread on a transient failure
      }
    };
    load();
    const t = setInterval(load, 6000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [conv.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending]);

  const send = async () => {
    const body = input.trim();
    if (!body || sending || isDead) return;
    setSending(true);
    setError(null);
    setInput("");
    const tempId = `pending-${Date.now()}`;
    setPending((prev) => [...prev, { id: tempId, body }]);
    try {
      const res = await fetch(`/api/sms/conversations/${conv.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setPending((prev) => prev.filter((p) => p.id !== tempId));
        setError(data.error ?? "Send failed");
      }
    } catch {
      setPending((prev) => prev.filter((p) => p.id !== tempId));
      setError("Send failed");
    }
    setSending(false);
  };

  return (
    <div
      className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] flex flex-col overflow-hidden"
      style={{ height: "560px" }}
    >
      {/* Header: lead name, read-only */}
      <div className="px-3 py-2.5 border-b border-[rgba(255,255,255,0.06)] flex items-center gap-2">
        <span className="text-xs font-semibold text-white">{conv.display_name}</span>
        {isDead && (
          <span className="ml-auto text-[9px] uppercase tracking-wider text-[#E74C3C]">Dead</span>
        )}
      </div>

      {/* Thread (read-only) */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && pending.length === 0 ? (
          <p className="text-[11px] text-[rgba(255,255,255,0.3)] text-center pt-6">No messages yet.</p>
        ) : (
          <>
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-start" : "justify-end"}`}>
                <div
                  className="rounded-xl px-3 py-2 text-[12px] whitespace-pre-wrap"
                  style={{
                    maxWidth: "82%",
                    background: m.direction === "outbound" ? teal : "rgba(255,255,255,0.08)",
                    color: m.direction === "outbound" ? "#0a0a0a" : "#fff",
                  }}
                >
                  {m.body}
                </div>
              </div>
            ))}
            {pending.map((p) => (
              <div key={p.id} className="flex justify-start">
                <div
                  className="rounded-xl px-3 py-2 text-[12px] whitespace-pre-wrap opacity-60"
                  style={{ maxWidth: "82%", background: teal, color: "#0a0a0a" }}
                >
                  {p.body}
                  <span className="block text-[9px] mt-0.5 opacity-70">sending…</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Composer (real send) */}
      <div className="p-2.5 border-t border-[rgba(255,255,255,0.06)]">
        {error && <p className="text-[10px] text-[#E74C3C] mb-1.5">{error}</p>}
        {isDead ? (
          <p className="text-[11px] text-[rgba(255,255,255,0.4)] text-center py-1">
            Conversation is marked dead. Replies are off.
          </p>
        ) : (
          <div className="flex gap-1.5 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Reply to the lead…"
              className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-[12px] text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7] resize-none"
              style={{ maxHeight: "80px" }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || sending}
              className="p-2 bg-[#00C9A7] text-[#0a0a0a] rounded-lg hover:opacity-90 disabled:opacity-40"
            >
              <Send size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
