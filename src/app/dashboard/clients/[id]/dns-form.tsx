"use client";

// The DNS panel. Open this on the call, read it down the phone, watch it go green.
//
// The three things it puts in one place, because all three used to live in somebody's
// notes: the exact Host, the exact Value, and whether the record actually resolves.
//
// HOST IS THE LABEL ONLY. "learn", not "learn.clinic.com". Every registrar wants the
// label and appends the domain itself, so typing the full name saves it as
// learn.clinic.com.clinic.com. That is the single most common way this goes wrong, so
// the fully qualified name is shown separately and greyed, to read aloud rather than to
// type.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface DnsRowView {
  key: string;
  label: string;
  type: string;
  host: string;
  fqdn: string;
  why: string;
  value: string | null;
  status: string;
  observed: string | null;
  lastCheckedAt: string | null;
  external: boolean;
}

const STATUS_TEXT: Record<string, string> = {
  pending: "no value yet",
  ready: "ready to add",
  added: "they added it, not confirmed",
  verified: "resolving",
  mismatch: "resolving to something else",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "text-[rgba(255,255,255,0.35)]",
  ready: "text-[rgba(255,255,255,0.55)]",
  added: "text-[#F5A623]",
  verified: "text-[#00C9A7]",
  mismatch: "text-red-300",
};

export function DnsForm({
  clientId,
  rows,
  domain,
  provider,
  nameservers,
}: {
  clientId: string;
  rows: DnsRowView[];
  domain: string | null;
  provider: string | null;
  nameservers: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  async function send(action: string, extra: Record<string, unknown> = {}, tag = action) {
    setBusy(tag);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/dns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) setError(json.error || "That did not work.");
      else router.refresh();
    } catch {
      setError("That did not work.");
    }
    setBusy(null);
  }

  if (!domain) {
    return (
      <p className="text-[11px] text-[rgba(255,255,255,0.35)]">
        No domain on this client yet. The records appear once intake step 1 is in.
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <div>
        <p className="mb-3 text-[11px] text-[rgba(255,255,255,0.35)]">
          Three records, two CNAMEs and one TXT. Set them up before the call so you are
          reading rather than working it out with a client on the line.
        </p>
        <button
          type="button"
          disabled={busy === "seed"}
          onClick={() => send("seed")}
          className="rounded-md border border-[rgba(255,255,255,0.15)] px-2.5 py-1 text-[10px] text-white/70 hover:border-[rgba(255,255,255,0.3)] hover:text-white disabled:opacity-40"
        >
          Set up the records
        </button>
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] text-[rgba(255,255,255,0.45)]">
          {provider ? (
            <>
              DNS is at <span className="text-white/80">{provider}</span>. Send them there,
              not to their website builder.
            </>
          ) : nameservers.length > 0 ? (
            <>
              Unrecognised nameservers:{" "}
              <span className="text-white/70">{nameservers.join(", ")}</span>. Read those
              out, they will recognise them.
            </>
          ) : (
            <>Nameservers not resolved yet.</>
          )}
        </p>
        <button
          type="button"
          disabled={busy === "check"}
          onClick={() => send("check")}
          className="rounded-md border border-[rgba(255,255,255,0.15)] px-2.5 py-1 text-[10px] text-white/70 hover:border-[rgba(255,255,255,0.3)] hover:text-white disabled:opacity-40"
        >
          {busy === "check" ? "Checking..." : "Check DNS now"}
        </button>
      </div>

      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.key} className="rounded-lg border border-[rgba(255,255,255,0.07)] px-3 py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[11px] text-white/85">{r.label}</span>
              <span className={"text-[10px] " + (STATUS_COLOR[r.status] ?? "")}>
                {STATUS_TEXT[r.status] ?? r.status}
              </span>
            </div>

            <p className="mt-0.5 text-[10px] leading-relaxed text-[rgba(255,255,255,0.3)]">
              {r.why}
            </p>

            <dl className="mt-2 space-y-1 text-[11px]">
              <div className="flex gap-2">
                <dt className="w-14 shrink-0 text-[rgba(255,255,255,0.35)]">Type</dt>
                <dd className="font-mono text-white/80">{r.type}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-14 shrink-0 text-[rgba(255,255,255,0.35)]">Host</dt>
                <dd>
                  <span className="font-mono text-white/80">{r.host}</span>
                  <span className="ml-2 text-[10px] text-[rgba(255,255,255,0.3)]">
                    just this, not {r.fqdn}
                  </span>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-14 shrink-0 text-[rgba(255,255,255,0.35)]">Value</dt>
                <dd className="min-w-0 flex-1">
                  {r.external || !r.value ? (
                    <div className="flex flex-wrap gap-1.5">
                      <input
                        className="min-w-0 flex-1 rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] px-2 py-1 font-mono text-[10px] text-white placeholder:text-[rgba(255,255,255,0.25)]"
                        placeholder={
                          r.type === "TXT"
                            ? "paste the google-site-verification= string"
                            : "the CNAME target"
                        }
                        defaultValue={r.value ?? ""}
                        onChange={(e) => setValues((p) => ({ ...p, [r.key]: e.target.value }))}
                      />
                      <button
                        type="button"
                        disabled={busy === `value:${r.key}`}
                        onClick={() =>
                          send("value", { recordKey: r.key, value: values[r.key] ?? r.value ?? "" }, `value:${r.key}`)
                        }
                        className="rounded-md border border-[rgba(255,255,255,0.15)] px-2 py-1 text-[10px] text-white/70 hover:border-[rgba(255,255,255,0.3)] hover:text-white disabled:opacity-40"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <span className="break-all font-mono text-white/80">{r.value}</span>
                  )}
                </dd>
              </div>
            </dl>

            {r.observed && r.status === "mismatch" && (
              <p className="mt-1.5 break-all text-[10px] text-red-300">
                Found: {r.observed}
              </p>
            )}

            {r.value && r.status !== "verified" && (
              <button
                type="button"
                disabled={busy === `added:${r.key}`}
                onClick={() => send("added", { recordKey: r.key }, `added:${r.key}`)}
                className="mt-2 rounded-md border border-[rgba(255,255,255,0.15)] px-2 py-1 text-[10px] text-white/60 hover:border-[rgba(255,255,255,0.3)] hover:text-white disabled:opacity-40"
              >
                They added it
              </button>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[10px] leading-relaxed text-[rgba(255,255,255,0.3)]">
        Only the resolver marks a record as resolving. &ldquo;They added it&rdquo; records
        what they told you, which is a different thing and worth keeping separate. Give it
        up to an hour before assuming something went wrong.
      </p>

      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
