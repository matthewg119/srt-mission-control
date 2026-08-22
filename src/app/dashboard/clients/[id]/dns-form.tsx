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

/**
 * Copy one value to the clipboard.
 *
 * ‼️ THE HOST AND THE VALUE ARE THE TWO STRINGS A HUMAN RETYPES WRONG, and this panel is read
 * out loud on a call while the client types into a registrar. `guide` retyped as `guide.` or
 * `4fddd1b501fe6565.vercel-dns-017.com` retyped with a transposed digit both produce a record
 * that never resolves and no error anywhere — the panel simply sits at `added` forever, which
 * dns-records.ts already names as the gap where a build silently stalls.
 *
 * Deliberately silent on failure beyond the label: an insecure context or a denied permission
 * means the text is still on screen to read, so a red error would be noise.
 */
function CopyButton({ text, what }: { text: string; what: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  return (
    <button
      type="button"
      title={`Copy the ${what}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("done");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 1500);
      }}
      className="shrink-0 rounded border border-[rgba(255,255,255,0.12)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[rgba(255,255,255,0.45)] transition hover:border-[rgba(255,255,255,0.3)] hover:text-white"
    >
      {state === "done" ? "copied" : state === "failed" ? "select it" : "copy"}
    </button>
  );
}

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
  /** Vercel disagreeing with a value somebody already committed to. Rendered as a warning. */
  note: string | null;
  external: boolean;
}

/**
 * The hostname writeCnameTarget says Vercel wants, pulled back out of the note it wrote.
 *
 * Reading it off prose is not lovely. The alternative is a `recommended_value` column, and
 * that is a migration plus a second thing to keep in step with the note for a string this
 * panel is the only consumer of. The note's shape is fixed in one place — see
 * writeCnameTarget in src/lib/hub/vercel-domains.ts — and if it ever stops matching, the
 * button disappears and the note still says what to type.
 */
function recommendedFrom(note: string | null): string | null {
  if (!note) return null;
  const m = /Vercel now recommends ([a-z0-9.-]+)/i.exec(note);
  return m ? m[1].replace(/[.;]$/, "") : null;
}

/**
 * The disagreement, and the one-click way out of it.
 *
 * Its own component so `recommendedFrom` is called ONCE and narrowed: called twice inline,
 * TypeScript cannot know the second call returns the same non-null string as the first.
 */
function DnsNote({
  row,
  busy,
  send,
}: {
  row: DnsRowView;
  busy: string | null;
  send: (action: string, extra: Record<string, unknown>, key: string) => void;
}) {
  const recommended = recommendedFrom(row.note);

  return (
    <div className="mt-2 rounded border border-[rgba(245,166,35,0.3)] bg-[rgba(245,166,35,0.07)] px-2 py-1.5">
      <p className="text-[11px] leading-relaxed text-[#F5A623]">{row.note}</p>
      {recommended && (
        <button
          type="button"
          disabled={busy === `value:${row.key}`}
          onClick={() => send("value", { recordKey: row.key, value: recommended }, `value:${row.key}`)}
          className="mt-1.5 rounded border border-[rgba(245,166,35,0.4)] px-2 py-0.5 text-[10px] text-[#F5A623] hover:border-[#F5A623] disabled:opacity-40"
        >
          Use {recommended}
        </button>
      )}
    </div>
  );
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
                <dd className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-mono text-white/80">{r.host}</span>
                  <CopyButton text={r.host} what="host" />
                  <span className="text-[10px] text-[rgba(255,255,255,0.3)]">
                    just this, not {r.fqdn}
                  </span>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-14 shrink-0 text-[rgba(255,255,255,0.35)]">Value</dt>
                <dd className="min-w-0 flex-1">
                  {/*
                    ‼️ EDITABLE EVEN ONCE IT IS SET, and it used to become a read-only span the
                    moment a value existed. Read-only assumes the stored value is right, which
                    is exactly wrong in the case this panel exists for: a row marked "they
                    added it" freezes its value, so when Vercel later recommends a different
                    target writeCnameTarget refuses to overwrite a human's word and leaves a
                    note instead. That refusal is correct. What was not correct is that it left
                    a visibly wrong value with nothing on the page able to change it.

                    Copy sits beside the input rather than replacing it, because the two jobs
                    are different: you copy it to read it down a phone, you edit it when the
                    thing it points at moved.
                  */}
                  <div className="flex flex-wrap items-center gap-1.5">
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
                    {r.value && <CopyButton text={r.value} what="value" />}
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
                </dd>
              </div>
            </dl>

            {r.note && <DnsNote row={r} busy={busy} send={send} />}

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
