"use client";

// The workflow buttons in the right-hand column of the lead page.
//
// Every button is one POST to /api/crm/leads/[id]/workflow, which hands the job to
// the audit engine and answers 202 straight away. Nothing here polls and nothing here
// waits: an audit is four to six minutes and the follow-on commands are twenty to
// ninety seconds. This component's job is to fire it and then say, honestly, where to
// go and look — and that is no longer one place. The audit ladder works in
// #ai-visibility-audits; No website has no audit and therefore no thread, so it drafts
// into Outlook and reports back on this lead's timeline.
//
// Disabled states are reasons, not decoration. Every one of the four follow-ons reads
// a finished report and refuses without one, so greying them out with the reason
// underneath is what the server would have said anyway, one round trip sooner.

import { useState } from "react";
import { useRouter } from "next/navigation";

interface WorkflowDef {
  action: string;
  label: string;
  hint: string;
  /** True when this button needs a finished audit to do anything. */
  needsAudit: boolean;
  /** True when this button only makes sense for a lead with NO website. Every angle it can
   *  write rests on nothing describing them being written by them, which stops being true the
   *  moment a site exists. */
  needsNoWebsite?: boolean;
}

const WORKFLOWS: WorkflowDef[] = [
  {
    action: "audit",
    label: "Run visibility audit",
    hint: "Scans the site, asks 20 buyer questions, posts the scorecard",
    needsAudit: false,
  },
  {
    action: "draft",
    label: "Draft email",
    hint: "The outreach email, built from the report",
    needsAudit: true,
  },
  {
    action: "avatars",
    label: "Avatars",
    hint: "3 worst and 3 best customers for this niche",
    needsAudit: true,
  },
  {
    action: "call",
    label: "Call script",
    hint: "Follow-up script plus the coach notes",
    needsAudit: true,
  },
  {
    action: "loom",
    label: "Loom",
    hint: "Pick the customer, the picture, then the script",
    needsAudit: true,
  },
  {
    // Sits last, under Loom, because it is the one button here that does NOT belong to the audit
    // ladder above it. It is the alternative to that whole ladder for a prospect who has no site.
    action: "nowebsite",
    label: "No website",
    hint: "Asks 3 buyer questions, then drafts the pitch into Outlook. No audit needed",
    needsAudit: false,
    needsNoWebsite: true,
  },
];

type Result = { ok: true; label: string; message: string; url?: string } | { ok: false; message: string };

export function LeadWorkflows({
  contactId,
  hasWebsite,
  hasBusinessName = true,
  hasAudit,
  auditRunning,
  threadUrl,
}: {
  contactId: string;
  hasWebsite: boolean;
  /** Defaults true so an older caller that does not pass it keeps its current behaviour; the
   *  route re-checks anyway and answers 400 with the same reason. */
  hasBusinessName?: boolean;
  hasAudit: boolean;
  auditRunning: boolean;
  threadUrl: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run(w: WorkflowDef) {
    if (pending) return;
    setPending(w.action);
    setResult(null);
    try {
      const res = await fetch(`/api/crm/leads/${contactId}/workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: w.action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start that");
      setResult({
        ok: true,
        label: w.label,
        message:
          w.action === "audit"
            ? "Running. The scorecard lands in Slack in about 5 minutes, and the score comes back here."
            : w.action === "nowebsite"
              ? "Researching. The draft lands in your Outlook drafts in about 90 seconds, and the link comes back on this timeline."
              : "Running in the audit thread.",
        url: json.threadUrl ?? threadUrl ?? undefined,
      });
      // Picks up the "started" note the route just wrote, and the in-flight state
      // that disables the audit button until the run clears.
      router.refresh();
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setPending(null);
    }
  }

  function disabledReason(w: WorkflowDef): string | null {
    if (w.needsNoWebsite) {
      // The mirror image of the audit button's rule, and it has to be stated as its own branch:
      // this is the only control here that a website DISABLES rather than enables.
      if (hasWebsite) return "This lead has a website, run the audit instead";
      if (!hasBusinessName) return "Add a business name above first";
      return null;
    }
    if (w.action === "audit") {
      if (!hasWebsite) return "Add a website above first";
      if (auditRunning) return "An audit is already running";
      return null;
    }
    return hasAudit ? null : "Needs a finished audit";
  }

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-3">
      <p className="mb-2 text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.3)]">
        Workflows
      </p>

      <div className="space-y-1.5">
        {WORKFLOWS.map((w) => {
          const reason = disabledReason(w);
          const busy = pending === w.action;
          const isAudit = w.action === "audit";
          return (
            <div key={w.action}>
              <button
                type="button"
                onClick={() => void run(w)}
                disabled={!!reason || !!pending}
                title={reason ?? w.hint}
                className={
                  "block w-full rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 " +
                  (isAudit
                    ? "border-[rgba(0,201,167,0.3)] text-[#00C9A7] enabled:hover:bg-[rgba(0,201,167,0.1)]"
                    : "border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.7)] enabled:hover:bg-[rgba(255,255,255,0.06)] enabled:hover:text-white")
                }
              >
                {busy ? "Starting…" : w.label}
              </button>
              {reason && (
                <p className="mt-0.5 px-1 text-[10px] text-[rgba(255,255,255,0.28)]">{reason}</p>
              )}
            </div>
          );
        })}
      </div>

      {auditRunning && !result && (
        <p className="mt-2 text-[11px] text-[#9C27B0]">
          An audit is running. It posts to #ai-visibility-audits when it finishes.
        </p>
      )}

      {result?.ok && (
        <p className="mt-2 text-[11px] text-[rgba(255,255,255,0.5)]">
          <span className="text-[#00C9A7]">{result.label}</span> · {result.message}{" "}
          {result.url && (
            <a
              href={result.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[#00C9A7] underline"
            >
              Open the thread
            </a>
          )}
        </p>
      )}

      {result && !result.ok && (
        <p className="mt-2 text-[11px] text-[#E74C3C]">{result.message}</p>
      )}

      {/* Once an audit exists the thread is where everything about this prospect
          lives, so it is worth a permanent link rather than only appearing after a
          button is pressed. */}
      {threadUrl && !result && (
        <a
          href={threadUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 block text-[11px] text-[rgba(255,255,255,0.35)] hover:text-[#00C9A7]"
        >
          Open the audit thread in Slack
        </a>
      )}
    </div>
  );
}
