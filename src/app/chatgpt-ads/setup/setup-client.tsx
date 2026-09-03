"use client";

// One screen, every field on it. The opposite shape to the funnel on purpose.
//
// The funnel is one question per screen because the thing that kills it is friction from
// somebody who has not decided anything yet. This is somebody who already chose to set
// themselves up, sitting down to it, and for them a stack of five short fields is faster than
// five taps. /onboarding's funnel-client.tsx makes the same call for the same reason.
//
// NO HONEYPOT AND NO TIME TRAP. A token-gated form has no public entry point to spam: you
// cannot reach this page without an HMAC that only the server can mint. Adding them here
// would be friction bought with nothing.

import { useState } from "react";
import { SETUP_COPY, SETUP_FIELDS, type SetupField } from "@/lib/chatgpt-ads/setup";
import { formatPhoneUS } from "@/lib/clients/normalize";

const CARD = "rounded-xl bg-white/5 p-6 sm:p-8";
const CTA =
  "w-full rounded-lg bg-[#00C9A7] px-6 py-3.5 font-bold text-[#04252b] disabled:opacity-50";
const INPUT_BASE =
  "w-full rounded-lg border bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[#00C9A7] ";

export function SetupForm({
  leadId,
  businessName,
}: {
  leadId: string;
  businessName: string | null;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className={CARD}>
        <h1 className="mb-3 text-2xl font-bold">{SETUP_COPY.doneHeading}</h1>
        <p className="text-white/70">{SETUP_COPY.doneBody}</p>
      </div>
    );
  }

  async function submit() {
    const found: Record<string, string> = {};
    for (const f of SETUP_FIELDS) {
      const v = (values[f.key] ?? "").trim();
      if (f.required && !v) found[f.key] = "This one is needed.";
      // A required field typed as punctuation is the garbage this is here to stop.
      else if (f.required && !/[a-z0-9]{2}/i.test(v)) found[f.key] = "That does not look like a real answer.";
    }
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/chatgpt-ads/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, values }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setSaveError(json.error || "That did not send. Try once more.");
        setSaving(false);
        return;
      }
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch {
      setSaveError("That did not send. Check your connection and try once more.");
    }
    setSaving(false);
  }

  return (
    <div className={CARD}>
      <h1 className="mb-2 text-xl font-bold sm:text-2xl">{SETUP_COPY.heading}</h1>
      <p className="mb-6 text-sm text-white/60">
        {businessName ? `${businessName}. ` : ""}
        {SETUP_COPY.body}
      </p>

      <div className="space-y-5">
        {SETUP_FIELDS.map((f) => (
          <Field
            key={f.key}
            def={f}
            value={values[f.key] ?? ""}
            error={errors[f.key]}
            onChange={(v) => {
              setValues((p) => ({ ...p, [f.key]: v }));
              setErrors((p) => (p[f.key] ? { ...p, [f.key]: "" } : p));
            }}
          />
        ))}
      </div>

      {saveError && <p className="mt-5 text-sm text-red-300">{saveError}</p>}

      <button type="button" onClick={submit} disabled={saving} className={`mt-8 ${CTA}`}>
        {saving ? "Sending" : SETUP_COPY.cta}
      </button>
    </div>
  );
}

function Field({
  def,
  value,
  error,
  onChange,
}: {
  def: SetupField;
  value: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">
        {def.label}
        {def.required && <span className="ml-1 text-[#00C9A7]">*</span>}
      </label>
      {def.help && <p className="mb-2 text-xs text-white/45">{def.help}</p>}
      <input
        type={def.kind === "tel" ? "tel" : "text"}
        inputMode={def.kind === "tel" ? "tel" : undefined}
        autoComplete={def.kind === "tel" ? "tel" : undefined}
        maxLength={def.kind === "tel" ? 14 : undefined}
        placeholder={def.placeholder}
        className={INPUT_BASE + (error ? "border-red-400/60" : "border-white/15")}
        value={value}
        onChange={(e) => onChange(def.kind === "tel" ? formatPhoneUS(e.target.value) : e.target.value)}
      />
      {error && <p className="mt-1.5 text-xs text-red-300">{error}</p>}
    </div>
  );
}
