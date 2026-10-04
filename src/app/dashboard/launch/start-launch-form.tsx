"use client";

// "Open a launch client". The Launch Lane's front door.
//
// Shorter than the Start pilot form on purpose: no tier scope, no market centre, no website.
// Those either do not apply to a business with no site or are decided later on the board.
//
// ‼️ THE ONE FIELD THAT LOOKS OPTIONAL AND IS NOT IS "What is this business".
// It writes clients.vertical_slug, which in the Slack lane is filled by the baseline scan of
// their website. These clients have no website, so nothing downstream can ever work it out, and
// verticalFor() refuses on an empty value rather than guessing: a harvest filed under a guessed
// vertical poisons a question bank shared with every other client in that vertical, and
// question_bank has no client_id to unpick it by.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { validateLaunchIntake, type IntakeField } from "@/lib/validate/intake-fields";

const HINT = "roofing-contractor, family-dentist, hvac-repair, personal-injury-law";

export function StartLaunchForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<IntakeField, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<IntakeField, boolean>>>({});
  const [done, setDone] = useState<{ slug: string; warnings: string[] } | null>(null);

  const [f, setF] = useState({
    legalName: "",
    dbaName: "",
    email: "",
    phone: "",
    verticalSlug: "",
    addressLine1: "",
    city: "",
    state: "",
    postalCode: "",
    website: "",
  });

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  // ‼️ THE SAME MODULE THE ROUTE RUNS. Not a looser copy of it: a form that accepts what the
  // server refuses is a form that reports its own bug as a server error, and the two definitions
  // drift the first time one of them is edited.
  const live = validateLaunchIntake(f);

  /** Shown only once a field has been left, so it does not shout while somebody is mid-word. */
  const errorFor = (k: IntakeField): string | undefined =>
    fieldErrors[k] ?? (touched[k] ? live.errors[k] : undefined);

  async function submit() {
    // Everything wrong at once, rather than one round trip per mistake.
    if (!live.ok) {
      setTouched(
        Object.fromEntries(Object.keys(live.errors).map((k) => [k, true])) as Partial<
          Record<IntakeField, boolean>
        >
      );
      setError("Some of those details are not usable yet.");
      return;
    }

    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch("/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(f),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        errors?: Partial<Record<IntakeField, string>>;
        slug?: string;
        warnings?: string[];
      };
      if (!json.ok) {
        // ‼️ THE SERVER'S VERDICT WINS AND IS RENDERED PER FIELD. It knows things the form cannot,
        // such as a duplicate or an unreadable website, and burying that in one banner is how
        // somebody retypes the wrong field three times.
        if (json.errors) {
          setFieldErrors(json.errors);
          setTouched(
            Object.fromEntries(Object.keys(json.errors).map((k) => [k, true])) as Partial<
              Record<IntakeField, boolean>
            >
          );
        }
        setError(json.error ?? "That did not work.");
        setBusy(false);
        return;
      }
      setDone({ slug: json.slug ?? "", warnings: json.warnings ?? [] });
      router.refresh();
    } catch {
      setError("That did not work. Check your connection.");
    }
    setBusy(false);
  }

  if (done) {
    return (
      <div className="rounded-xl border border-[rgba(0,201,167,0.3)] bg-[rgba(0,201,167,0.06)] p-5">
        <p className="font-medium text-white">Launch client opened.</p>
        <p className="mt-2 text-xs text-[rgba(255,255,255,0.5)]">
          Sixteen steps, on this dashboard. No Slack channel is created for this lane and nothing is
          emailed to the client. Upload the four foundation documents next: they are what everything
          after them is built from.
        </p>
        {done.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-[#F5A623]">
            {done.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-[rgba(255,255,255,0.12)] px-4 py-2 text-sm text-[rgba(255,255,255,0.7)] hover:text-white"
      >
        Open a launch client
      </button>
    );
  }

  const field = (
    label: string,
    key: keyof typeof f,
    opts: { required?: boolean; help?: string; placeholder?: string } = {}
  ) => {
    const err = errorFor(key as IntakeField);
    return (
      <div key={key}>
        <label className="mb-1 block text-xs text-[rgba(255,255,255,0.5)]">
          {label}
          {opts.required && <span className="ml-1 text-[#F5A623]">*</span>}
        </label>
        <input
          value={f[key]}
          onChange={(e) => {
            set(key, e.target.value);
            // Clear the SERVER's objection as soon as the field is edited: it was about the old
            // value and keeping it would tell somebody their fix did not work.
            setFieldErrors((p) => ({ ...p, [key]: undefined }));
          }}
          onBlur={() => setTouched((p) => ({ ...p, [key]: true }))}
          placeholder={opts.placeholder}
          aria-invalid={err ? true : undefined}
          className={`w-full rounded-lg border bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-white outline-none ${
            err
              ? "border-[rgba(255,107,107,0.6)] focus:border-[#FF6B6B]"
              : "border-[rgba(255,255,255,0.12)] focus:border-[rgba(0,201,167,0.5)]"
          }`}
        />
        {err ? (
          <p className="mt-1 text-[11px] text-[#FF6B6B]">{err}</p>
        ) : (
          opts.help && <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.35)]">{opts.help}</p>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.02)] p-5">
      <p className="mb-4 text-sm font-medium text-white">Open a launch client</p>

      <div className="grid gap-3 sm:grid-cols-2">
        {field("Business email", "email", { required: true })}
        {field("What is this business", "verticalSlug", {
          required: true,
          placeholder: "roofing-contractor",
          help: `Lowercase, hyphens. ${HINT}`,
        })}
        {field("Legal name", "legalName", { required: true })}
        {field("Public facing name", "dbaName")}
        {field("Phone", "phone", { required: true, placeholder: "(480) 555 0147", help: "Stored as +1 and the digits." })}
        {field("Street address", "addressLine1", { required: true })}
        {field("City", "city", { required: true })}
        {field("State", "state", { required: true, placeholder: "AZ", help: "Two letters, or the full name." })}
        {field("ZIP", "postalCode", { required: true, placeholder: "85254" })}
        {field("Existing website, if they have one", "website", {
          help: "Leave blank for a business with no site. With one, the domain and paste steps are skipped.",
        })}
      </div>

      {error && <p className="mt-3 text-xs text-[#FF6B6B]">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => void submit()}
          disabled={busy || !live.ok}
          className="rounded-lg bg-[#00C9A7] px-4 py-2 text-sm font-medium text-[#04211D] disabled:opacity-40"
        >
          {busy ? "Opening..." : "Open"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-sm text-[rgba(255,255,255,0.5)] hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
