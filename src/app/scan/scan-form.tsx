"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeTarget, normalizeErrorMessage } from "@/lib/scan/normalize";

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
        body: JSON.stringify({ url: check.target.website }),
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
