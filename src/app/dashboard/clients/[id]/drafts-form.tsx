"use client";

// The drafts panel: press a button, a draft appears in the client's ops thread.
//
// It never sends. The free WhatsApp Business app has no API, so what this produces is a
// message with a wa.me link on it that a human taps. That is stated on the panel too,
// because a button labelled "Draft" beside a client's name invites exactly one wrong
// assumption and it is not one to discover afterwards.
//
// Most drafts post themselves off the delivery checklist. This panel exists for the two
// cases that cannot: the monthly reports, which are manual on purpose, and redrafting one
// whose copy has since been written or whose number has since been fixed.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface DraftRow {
  key: string;
  label: string;
  /** Free-text tokens a human supplies. */
  inputs: string[];
  sentAt: string | null;
  draftedAt: string | null;
  /** A reached day 30/60/90 milestone that has not been drafted. */
  due: boolean;
  unwritten: boolean;
}

export function DraftsForm({ clientId, drafts }: { clientId: string; drafts: DraftRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  async function post(draftKey: string, inputs: string[]) {
    setBusy(draftKey);
    setError(null);
    try {
      const vars: Record<string, string> = {};
      for (const token of inputs) {
        const v = values[`${draftKey}.${token}`];
        if (v) vars[token] = v;
      }
      const res = await fetch(`/api/clients/${clientId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftKey, vars }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) setError(json.error || "That draft did not post.");
      else router.refresh();
    } catch {
      setError("That draft did not post.");
    }
    setBusy(null);
  }

  return (
    <div>
      <p className="mb-3 text-[11px] leading-relaxed text-[rgba(255,255,255,0.35)]">
        Drafts land in this client&apos;s onboarding thread with a WhatsApp link on them.
        Nothing here sends anything, and nothing can: the free WhatsApp Business app has no
        API, so you tap the link and send it yourself.
      </p>

      <ul className="space-y-1.5">
        {drafts.map((d) => (
          <li
            key={d.key}
            className="rounded-lg border border-[rgba(255,255,255,0.07)] px-3 py-2"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[11px] text-white/85">
                {d.label}
                {d.due && <span className="ml-1.5 text-[#F5A623]">due</span>}
                {d.unwritten && (
                  <span className="ml-1.5 text-[#F5A623]">copy not written</span>
                )}
              </span>
              <span className="text-[10px] text-[rgba(255,255,255,0.3)]">
                {d.sentAt
                  ? `sent ${new Date(d.sentAt).toLocaleDateString()}`
                  : d.draftedAt
                    ? `drafted ${new Date(d.draftedAt).toLocaleDateString()}`
                    : "not drafted"}
              </span>
            </div>

            {d.inputs.length > 0 && !d.sentAt && (
              <div className="mt-2 space-y-1.5">
                {d.inputs.map((token) => (
                  <input
                    key={token}
                    className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] px-2 py-1 text-[11px] text-white placeholder:text-[rgba(255,255,255,0.25)]"
                    placeholder={token}
                    value={values[`${d.key}.${token}`] ?? ""}
                    onChange={(e) =>
                      setValues((p) => ({ ...p, [`${d.key}.${token}`]: e.target.value }))
                    }
                  />
                ))}
              </div>
            )}

            <button
              type="button"
              disabled={busy === d.key || Boolean(d.sentAt)}
              onClick={() => post(d.key, d.inputs)}
              className="mt-2 rounded-md border border-[rgba(255,255,255,0.15)] px-2.5 py-1 text-[10px] text-white/70 hover:border-[rgba(255,255,255,0.3)] hover:text-white disabled:opacity-40"
            >
              {d.sentAt ? "Already sent" : d.draftedAt ? "Draft again" : "Draft it"}
            </button>
          </li>
        ))}
      </ul>

      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
