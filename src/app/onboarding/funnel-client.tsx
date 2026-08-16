"use client";

// One step per screen, saved on every advance.
//
// RESUMABLE IS THE POINT. This is ten minutes of a clinic owner's day, taken in gaps
// between patients. Every "Continue" writes to the server before the next screen
// renders, so closing the tab on step 4 costs nothing. The server decides where they
// resume; this component only asks to be told.
//
// Validation reuses src/lib/medspa/validate.ts unchanged. It is pure and isomorphic and
// already handles the cases a hand-rolled check gets wrong (O'Brien, Jean-Luc, phone
// numbers with a leading 1, 555 area codes).

import { useState } from "react";
import { INTAKE_STEPS, TOTAL_STEPS, COMPLETION_COPY, type FieldDef } from "@/config/client-intake";
import { clean, validEmail, normalizePhone } from "@/lib/medspa/validate";
import { normalizeAddress } from "@/lib/clients/normalize";

type Values = Record<string, unknown>;

interface Props {
  token: string;
  clinicName: string;
  initialValues: Values;
  /** 1-based step to open on. 0 means already finished. */
  startStep: number;
  alreadyComplete: boolean;
}

function fieldError(field: FieldDef, raw: unknown): string | null {
  const isMulti = field.kind === "multiselect";
  const value = isMulti ? (Array.isArray(raw) ? raw : []) : clean(raw, 4000);

  if (field.required) {
    if (isMulti ? (value as string[]).length === 0 : !value) return "This one is needed.";
  }
  if (!field.required && (isMulti ? (value as string[]).length === 0 : !value)) return null;

  if (field.kind === "email" && !validEmail(value as string)) {
    return "That email address does not look right.";
  }
  if (field.kind === "tel" && !normalizePhone(value as string)) {
    return "That phone number does not look right.";
  }
  if (field.kind === "url" && !/\./.test(value as string)) {
    return "That website does not look right.";
  }
  return null;
}

export function OnboardingFunnel({
  token,
  clinicName,
  initialValues,
  startStep,
  alreadyComplete,
}: Props) {
  const [values, setValues] = useState<Values>(initialValues);
  const [step, setStep] = useState(alreadyComplete ? 0 : Math.max(1, startStep));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Off screen rather than display:none, and never autofilled. Same approach as the
  // med spa funnel: a hidden input is the first thing a smart bot skips.
  const [trap, setTrap] = useState("");

  if (step === 0) return <Done />;

  const def = INTAKE_STEPS[step - 1];

  const set = (key: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: "" } : prev));
  };

  async function advance() {
    const found: Record<string, string> = {};
    for (const field of def.fields) {
      const err = fieldError(field, values[field.key]);
      if (err) found[field.key] = err;
    }
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }

    setSaving(true);
    setSaveError(null);

    const payload: Values = {};
    for (const field of def.fields) {
      const raw = values[field.key];
      payload[field.key] =
        field.kind === "multiselect"
          ? raw
          : field.key.startsWith("address_")
            ? normalizeAddress(clean(raw, 4000))
            : clean(raw, 4000);
    }

    try {
      const res = await fetch("/api/onboarding/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, step, values: payload, company_url_hp: trap }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setSaveError(json.error || "That did not save. Try once more.");
        setSaving(false);
        return;
      }
      setStep(step >= TOTAL_STEPS ? 0 : step + 1);
      window.scrollTo({ top: 0 });
    } catch {
      setSaveError("That did not save. Check your connection and try once more.");
    }
    setSaving(false);
  }

  return (
    <div className="rounded-xl bg-white/5 p-6 sm:p-8">
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-xs text-white/50">
          <span>{clinicName}</span>
          <span>
            Step {step} of {TOTAL_STEPS}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#00C9A7] transition-all"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      <h1 className="mb-2 text-xl font-bold sm:text-2xl">{def.title}</h1>
      {def.blurb && <p className="mb-6 text-sm text-white/60">{def.blurb}</p>}

      <div className="space-y-5">
        {def.fields.map((field) => (
          <Field
            key={field.key}
            def={field}
            value={values[field.key]}
            error={errors[field.key]}
            onChange={(v) => set(field.key, v)}
          />
        ))}
      </div>

      <input
        type="text"
        name="company_url_hp"
        value={trap}
        onChange={(e) => setTrap(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      {saveError && <p className="mt-5 text-sm text-red-300">{saveError}</p>}

      <div className="mt-8 flex items-center gap-3">
        {step > 1 && (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            className="rounded-lg px-4 py-3 text-sm text-white/60 hover:text-white"
          >
            Back
          </button>
        )}
        <button
          type="button"
          onClick={advance}
          disabled={saving}
          className="flex-1 rounded-lg bg-[#00C9A7] px-6 py-3.5 font-bold text-[#04252b] disabled:opacity-60"
        >
          {saving ? "Saving" : step >= TOTAL_STEPS ? "Finish" : "Continue"}
        </button>
      </div>
    </div>
  );
}

function Field({
  def,
  value,
  error,
  onChange,
}: {
  def: FieldDef;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) {
  const base =
    "w-full rounded-lg border bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[#00C9A7] " +
    (error ? "border-red-400/60" : "border-white/15");

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">
        {def.label}
        {def.required && <span className="ml-1 text-[#00C9A7]">*</span>}
      </label>
      {def.help && <p className="mb-2 text-xs text-white/45">{def.help}</p>}

      {def.kind === "textarea" && (
        <textarea
          rows={4}
          className={base}
          placeholder={def.placeholder}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {def.kind === "select" && (
        <select
          className={base}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose one</option>
          {def.options?.map((o) => (
            <option key={o} value={o} className="bg-[#0B1426]">
              {o}
            </option>
          ))}
        </select>
      )}

      {def.kind === "yesno" && (
        <div className="flex gap-3">
          {["Yes", "No"].map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onChange(o)}
              className={
                "flex-1 rounded-lg border px-4 py-3 text-sm " +
                (value === o
                  ? "border-[#00C9A7] bg-[#00C9A7]/15 font-semibold"
                  : "border-white/15 bg-white/5")
              }
            >
              {o}
            </button>
          ))}
        </div>
      )}

      {def.kind === "multiselect" && (
        <div className="flex flex-wrap gap-2">
          {def.options?.map((o) => {
            const list = Array.isArray(value) ? (value as string[]) : [];
            const on = list.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => onChange(on ? list.filter((x) => x !== o) : [...list, o])}
                className={
                  "rounded-full border px-4 py-2 text-sm " +
                  (on
                    ? "border-[#00C9A7] bg-[#00C9A7]/15 font-semibold"
                    : "border-white/15 bg-white/5")
                }
              >
                {o}
              </button>
            );
          })}
        </div>
      )}

      {["text", "email", "tel", "url"].includes(def.kind) && (
        <input
          type={def.kind === "url" ? "text" : def.kind}
          inputMode={def.kind === "tel" ? "tel" : undefined}
          className={base}
          placeholder={def.placeholder}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {error && <p className="mt-1.5 text-xs text-red-300">{error}</p>}
    </div>
  );
}

/** §16.2, adapted for the fact that booking is not built yet. */
function Done() {
  return (
    <div className="rounded-xl bg-white/5 p-8 text-center">
      <h1 className="mb-4 text-2xl font-bold">{COMPLETION_COPY.heading}</h1>
      <p className="mb-6 text-white/70">{COMPLETION_COPY.body}</p>
      <p className="text-sm text-[#00C9A7]">{COMPLETION_COPY.next}</p>
    </div>
  );
}
