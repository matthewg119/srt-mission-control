"use client";

// The stepped agent view: sidebar of finished steps, numbered rail, one stage
// card at a time.
//
// Two ideas hold this together and are worth not breaking:
//
// 1. The SERVER decides which steps are done. `activeStep` is derived in
//    buildStatusPayload() from the audit_reports row and a count of audit_runs,
//    never from a timer here. If the pipeline stalls, this UI stalls with it —
//    which is the honest behaviour. Do not "help" it along with a setTimeout.
//
// 2. `revealed` is presentation ONLY. Steps 1-3 all become true in the same
//    poll (research → classify → prompts is one awaited chain that only writes
//    a row at the end), so the card walks through them a beat apart to stay
//    readable. It can never run AHEAD of what the server has confirmed.

import { useCallback, useEffect, useRef, useState } from "react";
// From ./steps, NOT ./session — session.ts imports supabaseAdmin and
// node:crypto, and pulling it in here shipped all of that to the browser.
import { SCAN_STEPS, type ScanStatusPayload } from "@/lib/scan/steps";

const POLL_MS = 2000;
/** How long each already-proven step lingers before the next is revealed. */
const REVEAL_MS = 1100;

function faviconFor(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=40`;
}

/** classify.ts returns buyer_persona as a lowercase fragment, and it gets
 *  concatenated after the business type into one sentence. */
function sentence(value: string): string {
  const t = value.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function hostOf(value: string): string {
  return value
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0];
}

export function ScanRun({ initial }: { initial: ScanStatusPayload }) {
  const [state, setState] = useState<ScanStatusPayload>(initial);
  const [revealed, setRevealed] = useState(initial.activeStep);
  const [claimed, setClaimed] = useState(initial.claimed);
  const [reportUrl, setReportUrl] = useState<string | null>(null);

  // ── Poll ──────────────────────────────────────────────────────────────────
  // The `live` flag is scoped to THIS effect run, not a component-wide ref. A shared ref that
  // only flips on unmount let a tick that was mid-await when `status` changed schedule its next
  // timeout into the dead effect's closure, where no cleanup could ever clear it: the page then
  // polled forever, past completion, until the tab closed. It also never re-armed, so under
  // StrictMode's mount/unmount/remount the second mount started with polling already disabled.
  useEffect(() => {
    if (state.status === "done" || state.status === "failed") return;

    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const res = await fetch(`/api/scan/${initial.sessionId}/status`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (data.ok && live) setState(data as ScanStatusPayload);
        }
      } catch {
        // A dropped poll is not an error worth showing, the next one recovers.
      }
      if (live) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [initial.sessionId, state.status]);

  // ── Staggered reveal, clamped to what the server has proven ───────────────
  useEffect(() => {
    if (revealed >= state.activeStep) return;
    const t = setTimeout(() => setRevealed((r) => Math.min(r + 1, state.activeStep)), REVEAL_MS);
    return () => clearTimeout(t);
  }, [revealed, state.activeStep]);

  // Someone who gave their email mid-run has no report link yet. Once the run finishes, ask
  // for it: /claim is idempotent, so this hits the alreadyClaimed branch and just returns the
  // URL. The status poll deliberately never carries it (see steps.ts).
  useEffect(() => {
    if (state.status !== "done" || !claimed || reportUrl) return;
    let live = true;
    fetch(`/api/scan/${initial.sessionId}/claim`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (live && d?.reportUrl) setReportUrl(d.reportUrl);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [state.status, claimed, reportUrl, initial.sessionId]);

  const done = state.status === "done";
  const failed = state.status === "failed";
  // Cap at the step count for indexing, but let `done` drive completeness so the sidebar,
  // the rail and the card cannot disagree. Before this, a finished scan showed the score and
  // "step 4 running" at the same time, and step 6 could never render as complete at all.
  const shown = Math.min(revealed, SCAN_STEPS.length);

  return (
    <div className="scan-shell">
      <Sidebar state={state} shown={shown} done={done} failed={failed} />

      <main className="scan-main">
        <Rail shown={shown} done={done} failed={failed} />
        {failed ? (
          <FailCard state={state} />
        ) : (
          <StageCard
            state={state}
            step={shown}
            claimed={claimed}
            onClaimed={() => setClaimed(true)}
            reportUrl={reportUrl}
          />
        )}
      </main>
    </div>
  );
}

// ── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({
  state,
  shown,
  done,
  failed,
}: {
  state: ScanStatusPayload;
  shown: number;
  done: boolean;
  failed: boolean;
}) {
  const initial = (state.business?.name ?? state.domain).trim().charAt(0) || "?";

  return (
    <aside className="scan-sidebar">
      <a className="scan-logo" href="https://srtagency.com">
        <span className="scan-logo-mark" aria-hidden="true">
          <i /><i /><i />
        </span>
        SRT
      </a>

      <div>
        {SCAN_STEPS.map((s, i) => {
          const n = i + 1;
          // `done` (the run finished) has to win here, not just `n < shown`. shown is capped at
          // SCAN_STEPS.length, so step 6 could otherwise only ever render as "▸ in progress",
          // leaving the sidebar claiming work was still running next to a completed report.
          const isDone = !failed && (done || n < shown);
          const isActive = !failed && !done && n === shown;
          if (!isDone && !isActive) {
            return (
              <div className="scan-side-step is-pending scan-mono" key={s.key}>
                <span>·</span> step {n} · {s.label}
              </div>
            );
          }
          return (
            <div className="scan-side-step scan-mono" key={s.key}>
              <span className="tick">{isDone ? "✓" : "▸"}</span> step {n} · {s.label}
            </div>
          );
        })}
      </div>

      {state.business && (
        <>
          <div className="scan-side-divider" />
          <div className="scan-company">
            <div className="scan-company-head">
              <div className="scan-avatar">{initial}</div>
              <div className="scan-company-name">{state.business.name ?? state.domain}</div>
            </div>
            <div className="scan-company-body">
              {sentence(state.business.type ?? "")}
              {state.business.persona ? `. ${sentence(state.business.persona)}` : ""}
            </div>
            {state.business.city && <div className="scan-pill">{state.business.city}</div>}
          </div>
        </>
      )}
    </aside>
  );
}

// ── Step rail ───────────────────────────────────────────────────────────────

function Rail({ shown, done, failed }: { shown: number; done: boolean; failed: boolean }) {
  return (
    <div className="scan-rail">
      {SCAN_STEPS.map((s, i) => {
        const n = i + 1;
        const isDone = done || (!failed && n < shown);
        const isActive = !failed && !done && n === shown;
        return (
          <div key={s.key} style={{ display: "contents" }}>
            {i > 0 && <span className={`scan-rail-line${isDone || isActive ? " is-done" : ""}`} />}
            <div
              className={`scan-rail-node${isDone ? " is-done" : ""}${isActive ? " is-active" : ""}`}
            >
              <span className="num">{isDone ? "✓" : n}</span>
              {isActive && <span className="scan-rail-label">{s.label}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Stage cards ─────────────────────────────────────────────────────────────

function StageCard({
  state,
  step,
  claimed,
  onClaimed,
  reportUrl,
}: {
  state: ScanStatusPayload;
  step: number;
  claimed: boolean;
  onClaimed: () => void;
  reportUrl: string | null;
}) {
  if (state.status === "done" && state.result) {
    return <ResultCard state={state} claimed={claimed} onClaimed={onClaimed} reportUrl={reportUrl} />;
  }

  switch (step) {
    case 1:
      return <ResearchCard state={state} />;
    case 2:
      return <CompetitorCard state={state} />;
    case 3:
      return <QuestionCard state={state} />;
    case 4:
      return <EngineCard state={state} claimed={claimed} onClaimed={onClaimed} />;
    default:
      return <ScoringCard state={state} claimed={claimed} onClaimed={onClaimed} />;
  }
}

function Working({ label }: { label: string }) {
  return (
    <div className="scan-label">
      <span className="scan-spinner" aria-hidden="true" /> {label}
    </div>
  );
}

function ResearchCard({ state }: { state: ScanStatusPayload }) {
  return (
    <section className="scan-card">
      <Working label={`Reading ${state.domain}`} />
      <div className="scan-row">
        <img src={faviconFor(state.domain)} alt="" />
        {state.domain}
      </div>
      <p className="scan-note">
        Fetching the homepage and up to two inner pages, then reading the structured data to work
        out what this business actually does and where it operates.
      </p>
    </section>
  );
}

function CompetitorCard({ state }: { state: ScanStatusPayload }) {
  const b = state.business;
  return (
    <section className="scan-card">
      <div className="scan-cols">
        <div>
          <div className="scan-label">What you sell</div>
          <div className="scan-row scan-row-strong">{b?.type ?? "Working it out"}</div>
          {b?.persona && <div className="scan-row">{b.persona}</div>}
          {b?.city && <div className="scan-row">Operating in {b.city}</div>}
        </div>
        <div>
          <div className="scan-label">
            Competitors
            {state.competitors.length > 0 && (
              <span className="scan-count">✓ {state.competitors.length} found</span>
            )}
          </div>
          {state.competitors.length === 0 ? (
            <Working label="Working out who you are up against" />
          ) : (
            state.competitors.slice(0, 12).map((c, i) => (
              <div className="scan-row" key={`${c.name}-${i}`} style={{ animationDelay: `${i * 45}ms` }}>
                {c.domain ? (
                  <img src={faviconFor(hostOf(c.domain))} alt="" />
                ) : (
                  <span className="dot" />
                )}
                {c.domain ? hostOf(c.domain) : c.name}
              </div>
            ))
          )}
        </div>
      </div>
      <p className="scan-note">
        These are hypotheses from your site and category. The engines confirm or replace them in the
        next step, which is the part that actually counts.
      </p>
    </section>
  );
}

function QuestionCard({ state }: { state: ScanStatusPayload }) {
  const prompts = state.prompts;
  return (
    <section className="scan-card">
      <div className="scan-label">
        The questions your buyers ask
        {prompts.length > 0 && <span className="scan-count">✓ {prompts.length} written</span>}
      </div>
      {prompts.length === 0 ? (
        <Working label="Writing them" />
      ) : (
        <div className="scan-cols">
          {[prompts.slice(0, 10), prompts.slice(10, 20)].map((col, ci) => (
            <div key={ci}>
              {col.map((p, i) => (
                <div className="scan-row" key={i} style={{ animationDelay: `${(ci * 10 + i) * 40}ms` }}>
                  <span className="dot" />
                  {p.prompt}
                  <span className="scan-block-tag scan-mono">{p.block}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <p className="scan-note">
        Buyer language, not marketing language. Most never name you, which is the point: appearing in
        a question that already says your name proves very little.
      </p>
    </section>
  );
}

function EngineCard({
  state,
  claimed,
  onClaimed,
}: {
  state: ScanStatusPayload;
  claimed: boolean;
  onClaimed: () => void;
}) {
  const { done, total } = state.engine;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <section className="scan-card">
      <div className="scan-label">
        <span className="scan-spinner" aria-hidden="true" /> Asking ChatGPT
        <span className="scan-count">
          {done} / {total}
        </span>
      </div>
      <div className="scan-progress">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="scan-engine-grid">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`scan-tick${i < done ? " on" : ""}`} />
        ))}
      </div>
      <p className="scan-note">
        Every question goes to a clean account with no history and no location bias. That is the
        market&apos;s answer, not yours. This is the slow part, it is real traffic.
      </p>
      <EmailGate state={state} claimed={claimed} onClaimed={onClaimed} phase="running" />
    </section>
  );
}

function ScoringCard({
  state,
  claimed,
  onClaimed,
}: {
  state: ScanStatusPayload;
  claimed: boolean;
  onClaimed: () => void;
}) {
  return (
    <section className="scan-card">
      <Working label="Scoring the answers" />
      <p className="scan-note">
        Counting where you were named, where a competitor was named instead, and which sources were
        cited. Questions that never mention your name are weighted far heavier than the ones that do.
      </p>
      <div className="scan-progress">
        <i style={{ width: "92%" }} />
      </div>
      <EmailGate state={state} claimed={claimed} onClaimed={onClaimed} phase="running" />
    </section>
  );
}

function ResultCard({
  state,
  claimed,
  onClaimed,
  reportUrl,
}: {
  state: ScanStatusPayload;
  claimed: boolean;
  onClaimed: () => void;
  reportUrl: string | null;
}) {
  const score = state.result?.score;
  return (
    <section className="scan-card">
      <div className="scan-label">Your AI visibility score</div>
      <div className="scan-score">
        {typeof score === "number" ? score : "n/a"}
        <small> / 100</small>
      </div>
      <p className="scan-note" style={{ marginTop: "0.75rem" }}>
        {state.business?.name ?? state.domain} across {state.engine.total} live answers from ChatGPT.
        The full report shows every question, which of them named you, who got named instead, and the
        sources cited.
      </p>
      <EmailGate
        state={state}
        claimed={claimed}
        onClaimed={onClaimed}
        reportUrl={reportUrl}
        phase="done"
      />
    </section>
  );
}

function FailCard({ state }: { state: ScanStatusPayload }) {
  return (
    <section className="scan-card">
      <div className="scan-label" style={{ color: "var(--destructive)" }}>
        The scan stopped
      </div>
      <p className="scan-note">
        {state.error ?? "We could not read that site."} Nothing was charged and nothing was saved
        against your business.
      </p>
      <p className="scan-note">
        This usually means the site blocked our fetch or was slow to respond. Email{" "}
        <a className="scan-link" href="mailto:info@srtagency.com">
          info@srtagency.com
        </a>{" "}
        and we will run it by hand.
      </p>
    </section>
  );
}

// ── Email gate ──────────────────────────────────────────────────────────────

/**
 * Asks for the email DURING the run (phase "running"), not only on the score screen.
 *
 * That is not a conversion tweak, it is what makes the funnel work at all. finish-report.ts
 * reads `requester_email` off the audit_reports row when the run ENDS, and everything
 * downstream hangs off it: the drafted email, the scorecard PDF, the Send it / Hold card. An
 * address supplied after the report is already `done` arrives too late to be read and does
 * nothing. See the header of api/scan/[id]/claim/route.ts.
 */
function EmailGate({
  state,
  claimed,
  onClaimed,
  reportUrl,
  phase,
}: {
  state: ScanStatusPayload;
  claimed: boolean;
  onClaimed: () => void;
  reportUrl?: string | null;
  phase: "running" | "done";
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/scan/${state.sessionId}/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setError(data.message ?? "That did not go through. Try again.");
          // Always clear busy on a failed path. Leaving it set was what stuck the button on
          // "Sending..." with no error and no way to retry.
          setBusy(false);
          return;
        }
        onClaimed();
      } catch {
        setError("We could not reach the server. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy, email, name, state.sessionId, onClaimed]
  );

  if (claimed) {
    if (reportUrl) {
      return (
        <p className="scan-note" style={{ fontSize: "0.9375rem" }}>
          <a className="scan-link" href={reportUrl}>
            Open your full report →
          </a>
        </p>
      );
    }
    return (
      <p className="scan-note" style={{ fontSize: "0.9375rem" }}>
        {phase === "done"
          ? "Getting your report link ready..."
          : "Got it. The scorecard is on its way to you when this finishes, and the link appears here too."}
      </p>
    );
  }

  return (
    <form onSubmit={submit} style={{ marginTop: "1.25rem" }}>
      <div className="scan-gate">
        <input
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          aria-label="Your name"
        />
        <input
          type="email"
          placeholder="you@yourbusiness.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          required
          aria-label="Your email"
        />
        <button className="scan-submit" type="submit" disabled={busy}>
          {busy ? "Sending…" : phase === "done" ? "Show me the report" : "Send me the scorecard"}
        </button>
      </div>
      {error && (
        <p className="scan-error" role="alert">
          {error}
        </p>
      )}
      <p className="scan-note">
        {phase === "done"
          ? "We email the scorecard too. No card, no account."
          : "This takes a few minutes, so leave your email and we will send the scorecard when it lands. No card, no account."}{" "}
        We will not text you, we do not collect a number here.
      </p>
    </form>
  );
}
