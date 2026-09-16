"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeTarget, normalizeErrorMessage } from "@/lib/scan/normalize";

/**
 * The four utm params on the URL this form is being rendered at.
 *
 * ‼️ READ AT SUBMIT, FROM THE LIVE LOCATION, AND NOT STASHED ANYWHERE. The alternative was a
 * localStorage first-touch stash, and it would be the wrong mechanism: the audit report is
 * EMAILED and opened days later, usually on a different device, by which time any browser-side
 * value is long gone. The durable carrier is the audit_reports row, and this is only the first
 * hop onto it.
 */
function utmFromLocation(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
    const v = q.get(k);
    if (v) out[k] = v.slice(0, 120);
  }
  return out;
}

export function ScanForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    // Validate with the SAME function the route uses, so a typo never costs a
    // round trip and the two can't drift apart.
    const check = normalizeTarget(url);
    if (!check.ok) {
      setError(normalizeErrorMessage(check.error));
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/scan/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // ‼️ THE CAMPAIGN RIDES ALONG FROM HERE OR IT IS NEVER SEEN AGAIN.
        // A prospect is only created in the CRM when they REPLY to an email. Somebody who clicks
        // a campaign link, runs the scan and books without ever writing back is invisible, and
        // that is the BEST outcome a cold campaign has. These four params are the only thing that
        // catches them, and the chain is: this form, then audit_reports, then the Get Started
        // link on the report, then onboarding2_leads.
        body: JSON.stringify({ url: check.target.website, ...utmFromLocation() }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.message ?? "Something went wrong starting the scan. Try again in a moment.");
        setBusy(false);
        return;
      }

      router.push(`/scan/${data.id}`);
    } catch {
      setError("We could not reach the scanner. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form className="scan-form" onSubmit={submit} noValidate>
      <div className="scan-input-wrap">
        <input
          className="scan-input"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="Paste your website, e.g. acmedental.com"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(null);
          }}
          disabled={busy}
          aria-label="Your website"
          aria-invalid={!!error}
        />
        <button className="scan-submit" type="submit" disabled={busy}>
          {busy ? "Starting…" : "Run the scan"}
        </button>
      </div>
      {error && (
        <p className="scan-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
