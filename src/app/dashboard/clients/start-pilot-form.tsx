"use client";

// "Start pilot". The human trigger from PILOT §5.
//
// There is no price field, no plan picker, no card, and nothing that resembles a
// checkout, because for a pilot none of those things exist. tier_scope is on this form
// because it decides delivery volume (40 vs 80 questions at Photograph II) and it is
// labelled as internal, never shown to the clinic.
//
// The market center is typed by hand. There is no geocoder in this app and at six
// concurrent clients there does not need to be: right-click the address in a map, copy
// the two numbers. The overlap check flags; it never blocks.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatPhoneUS } from "@/lib/clients/normalize";

export function StartPilotForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string | null; warnings: string[] } | null>(null);

  const [f, setF] = useState({
    legalName: "",
    dbaName: "",
    website: "",
    email: "",
    contactFirstName: "",
    phone: "",
    addressLine1: "",
    city: "",
    state: "",
    postalCode: "",
    tierScope: "complete",
    marketCenterLat: "",
    marketCenterLng: "",
    marketRadiusMi: "15",
  });

  const set = (k: keyof typeof f, v: string) => setF((prev) => ({ ...prev, [k]: v }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clients/start-pilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...f,
          marketCenterLat: f.marketCenterLat ? Number(f.marketCenterLat) : null,
          marketCenterLng: f.marketCenterLng ? Number(f.marketCenterLng) : null,
          marketRadiusMi: f.marketRadiusMi ? Number(f.marketRadiusMi) : null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "That did not work.");
        setBusy(false);
        return;
      }
      setResult({ url: json.onboardingUrl ?? null, warnings: json.warnings ?? [] });
      router.refresh();
    } catch {
      setError("That did not work. Check your connection.");
    }
    setBusy(false);
  }

  if (result) {
    return (
      <div className="rounded-xl border border-[rgba(0,201,167,0.3)] bg-[rgba(0,201,167,0.06)] p-5">
        <p className="font-medium text-white">Pilot started.</p>
        {result.url ? (
          <>
            <p className="mt-2 text-xs text-[rgba(255,255,255,0.5)]">
              The welcome email is on its way. This is the link it contains, shown once,
              because only its hash is stored:
            </p>
            <p className="mt-2 break-all rounded-lg bg-black/30 p-3 font-mono text-xs text-[#00C9A7]">
              {result.url}
            </p>
          </>
        ) : (
          <p className="mt-2 text-xs text-[#F5A623]">
            No onboarding link was generated. Set CLIENT_LINK_SECRET, then re-issue.
          </p>
        )}
        {result.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-[#F5A623]">
            {result.warnings.map((w) => (
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
        Start a pilot
      </button>
    );
  }

  const field = (
    label: string,
    key: keyof typeof f,
    opts: { required?: boolean; help?: string; placeholder?: string; tel?: boolean } = {}
  ) => (
    <div>
      <label className="mb-1 block text-xs text-[rgba(255,255,255,0.5)]">
        {label}
        {opts.required && <span className="ml-1 text-[#00C9A7]">*</span>}
      </label>
      <input
        value={f[key]}
        placeholder={opts.placeholder}
        // Live-formatted exactly as the /onboarding funnel does it, and for the same
        // reason: this number is what every WhatsApp draft is addressed to, and waLink()
        // returns null for anything that is not E.164, so a raw string typed here is a
        // card with no button on it.
        onChange={(e) => set(key, opts.tel ? formatPhoneUS(e.target.value) : e.target.value)}
        className="w-full rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-white outline-none focus:border-[#00C9A7]"
      />
      {opts.help && <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.3)]">{opts.help}</p>}
    </div>
  );

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
      <h2 className="mb-4 text-sm font-medium text-white">Start a pilot</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        {field("Legal business name", "legalName", { required: true })}
        {field("Public facing name", "dbaName")}
        {field("Website", "website", { required: true, placeholder: "business.com" })}
        {field("Owner email", "email", { required: true })}
        {field("Owner first name", "contactFirstName")}
        {field("Phone", "phone", { tel: true })}
        {field("Street address", "addressLine1")}
        {field("City", "city")}
        {field("State", "state", { placeholder: "TX" })}
        {field("ZIP", "postalCode")}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {field("Market center latitude", "marketCenterLat", {
          placeholder: "30.2672",
          help: "Right-click the business in Google Maps.",
        })}
        {field("Market center longitude", "marketCenterLng", { placeholder: "-97.7431" })}
        {field("Radius, miles", "marketRadiusMi")}
      </div>

      <div className="mt-4">
        <label className="mb-1 block text-xs text-[rgba(255,255,255,0.5)]">
          Scope, internal only
        </label>
        <select
          value={f.tierScope}
          onChange={(e) => set("tierScope", e.target.value)}
          className="w-full rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-white outline-none sm:w-64"
        >
          <option value="complete" className="bg-[#0a0a0a]">
            Complete
          </option>
          <option value="core" className="bg-[#0a0a0a]">
            Core
          </option>
        </select>
        <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.3)]">
          Sets delivery volume so hours can be measured. Never shown to the client.
        </p>
      </div>

      {error && <p className="mt-4 text-xs text-red-300">{error}</p>}

      <div className="mt-5 flex gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-lg bg-[#00C9A7] px-5 py-2 text-sm font-semibold text-[#04252b] disabled:opacity-60"
        >
          {busy ? "Starting" : "Start pilot"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg px-4 py-2 text-sm text-[rgba(255,255,255,0.5)] hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
