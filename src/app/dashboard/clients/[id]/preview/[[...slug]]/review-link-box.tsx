"use client";

// The paste box on the review tool preview (Matthew, 2026-09-15: "give us the chance to paste it
// there as well"). Looking at the review page is exactly when you notice it ends with no button.
// Posts to the same writer the Slack thread and modal use.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ReviewLinkBoxProps {
  clientId: string;
  line: string;
  hasLink: boolean;
  primary: string | null;
  platforms: ReadonlyArray<{ key: string; name: string; placeholder: string }>;
}

export function ReviewLinkBox({ clientId, line, hasLink, primary, platforms }: ReviewLinkBoxProps) {
  const router = useRouter();
  const [platform, setPlatform] = useState(primary ?? platforms[0]?.key ?? "google");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeholder = platforms.find((p) => p.key === platform)?.placeholder ?? "https://...";

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/review-workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewLink: { url, platform } }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setError(json.error ?? "Not saved.");
        return;
      }
      setUrl("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input: React.CSSProperties = {
    background: "#111",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 6,
    padding: "4px 8px",
    font: "inherit",
  };

  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", width: "100%" }}>
      <span style={{ color: hasLink ? "rgba(255,255,255,0.6)" : "#F5A623" }}>
        {hasLink ? "Where reviews go:" : "No Post button yet:"} {line}
      </span>
      <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={input} aria-label="Platform">
        {platforms.map((p) => (
          <option key={p.key} value={p.key}>
            {p.name}
          </option>
        ))}
      </select>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={placeholder}
        style={{ ...input, minWidth: 260, flex: "1 1 260px" }}
        aria-label="Review page URL"
      />
      <button
        type="button"
        onClick={save}
        disabled={busy || url.trim().length === 0}
        style={{ ...input, background: "#F5A623", color: "#111", fontWeight: 700, cursor: "pointer" }}
      >
        {busy ? "Saving" : "Save review link"}
      </button>
      {error && <span style={{ color: "#ff8a80" }}>{error}</span>}
    </span>
  );
}
