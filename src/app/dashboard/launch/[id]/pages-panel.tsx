"use client";

// The page run, start to finish, on the board instead of in a Slack thread.
//
// ‼️ THE STAGE DECIDES WHAT IS ON SCREEN, AND THAT IS THE ENFORCEMENT HERE.
// `plan approve` stopped drafting on 2026-09-14 so every decision lands before any page is written:
// a headline, then a skeleton, then one research pass, THEN the draft. A panel that showed all the
// buttons at once would invite somebody to press Draft over seven pages with no outline, and the
// server would refuse, which is a worse way to learn the order than simply not offering it.
//
// ‼️ EVERY REFUSAL IS SHOWN IN THE WORDS THE ENGINE USED. Same reason the board renders a verdict
// rather than "failed": the refusals here name work that is owed, and rewording them on the way out
// is how a surface starts disagreeing with the thing it is a surface for.
//
// ‼️ TYPES ONLY FROM THE SERVER MODULE. `import type` is erased at build, so nothing in
// src/lib/launch/pages.ts reaches the client bundle, and the shapes cannot drift the way they would
// if this file re-declared them.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LaunchLadderRung, LaunchPagesState, LaunchPlanPage } from "@/lib/launch/pages";

const card = "rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] p-4";
const heading = "text-xs font-medium uppercase tracking-wider text-[rgba(255,255,255,0.4)]";
const btn =
  "rounded-lg border border-[rgba(0,201,167,0.4)] px-3 py-1.5 text-xs text-[#00C9A7] disabled:opacity-40";
const ghost =
  "rounded-lg border border-[rgba(255,255,255,0.14)] px-2 py-1 text-[11px] text-[rgba(255,255,255,0.6)] disabled:opacity-40";
const input =
  "w-full rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1.5 text-xs text-white outline-none focus:border-[rgba(0,201,167,0.5)]";

interface DestinationChoice {
  id: string;
  label: string;
}

export function LaunchPagesPanel({
  clientId,
  initial,
}: {
  clientId: string;
  initial: LaunchPagesState | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<LaunchPagesState | null>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [rename, setRename] = useState("");
  const [cta, setCta] = useState("");
  /** Set only when publishPage refuses for want of a destination. Rendered from ITS list, never a query. */
  const [choices, setChoices] = useState<{ pageId: string; options: DestinationChoice[] } | null>(null);
  const [destination, setDestination] = useState<string | null>(null);

  async function act(key: string, body: Record<string, unknown>): Promise<void> {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/launch/${clientId}/pages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        prompt?: string | null;
        pageUrl?: string | null;
        blockedBy?: string;
        choices?: DestinationChoice[];
        state?: LaunchPagesState | null;
      };

      if (!data.ok) {
        setError(data.error ?? "That did not go through.");
        // The destination question, with the options publishPage handed back.
        if (data.blockedBy === "destination" && data.choices) {
          setChoices({ pageId: String(body.pageId ?? ""), options: data.choices });
        }
        return;
      }

      setNote([data.message, data.pageUrl ? `Live at ${data.pageUrl}` : null].filter(Boolean).join(" "));
      if (data.prompt) setPrompt(data.prompt);
      if (data.state) setState(data.state);
      setChoices(null);
      // The board's own marks move with this: pages_drafted and pages_published are ticked server
      // side, so the step list above has to re-read.
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!state) {
    return (
      <div className={card}>
        <div className={heading}>The pages</div>
        <p className="mt-2 text-xs text-[rgba(255,255,255,0.5)]">
          The plan could not be read for this client.
        </p>
      </div>
    );
  }

  const approved = state.plan.filter((p) => p.status === "approved" || p.status === "claimed");
  const drafted = state.plan.filter((p) => p.hasBody);
  const headlinesDone = approved.length > 0 && state.needHeadline.length === 0;
  const skeletonsDone = headlinesDone && state.needSkeleton.length === 0;

  return (
    <div className={`${card} mt-8`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className={heading}>The pages</div>
        <div className="text-[11px] text-[rgba(255,255,255,0.4)]">{state.stageText}</div>
      </div>

      {/* What is owed upstream. The plan cannot be worded without it, and naming it is the fix. */}
      {!state.ready && (
        <p className="mt-3 rounded-lg border border-[rgba(255,196,0,0.3)] bg-[rgba(255,196,0,0.06)] p-2.5 text-xs text-[#FFC400]">
          Nothing can be planned yet. Waiting on: {state.missing.join("; ")}.
        </p>
      )}

      {/* ‼️ SAID BEFORE THE RUN, NOT AFTER IT. publishPage refuses while Day 0 is unarchived, and
          that refusal would otherwise land once every page is written. */}
      {!state.day0ArchivedAt && (
        <p className="mt-3 rounded-lg border border-[rgba(255,196,0,0.3)] bg-[rgba(255,196,0,0.06)] p-2.5 text-xs text-[#FFC400]">
          Day 0 is not archived, so publishing will refuse. Drafting and previewing are not gated.
          File the archived scan against the Day-0 step above and tick it.
        </p>
      )}

      {note && <p className="mt-3 text-xs text-[#00C9A7]">{note}</p>}
      {error && (
        <p className="mt-3 whitespace-pre-wrap rounded-lg border border-[rgba(255,90,90,0.3)] bg-[rgba(255,90,90,0.06)] p-2.5 text-xs text-[#FF8A8A]">
          {error}
        </p>
      )}

      <LadderBlock state={state} busy={busy} act={act} />

      {/* ── The plan ─────────────────────────────────────────────────────────── */}
      <section className="mt-5 border-t border-[rgba(255,255,255,0.07)] pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-white">
            The plan{state.plan.length ? `: one pillar and ${Math.max(0, state.plan.length - 1)} supports` : ""}
          </span>
          <button
            type="button"
            className={btn}
            disabled={busy !== null || !state.ready}
            onClick={() => act("plan_new", { action: "plan_new" })}
          >
            {busy === "plan_new" ? "Proposing..." : state.plan.length ? "Re-propose what is not approved" : "Propose the plan"}
          </button>
          {state.proposed > 0 && (
            <button
              type="button"
              className={btn}
              disabled={busy !== null}
              onClick={() => act("plan_approve", { action: "plan_approve" })}
            >
              {busy === "plan_approve" ? "Approving..." : `Approve ${state.proposed}`}
            </button>
          )}
        </div>

        {state.plan.length === 0 ? (
          <p className="mt-2 text-xs text-[rgba(255,255,255,0.45)]">
            No pages planned yet. The plan is one pillar and six supports, chosen off the selected
            keywords.
          </p>
        ) : (
          <ol className="mt-3 space-y-1.5">
            {state.plan.map((p) => (
              <li key={p.id}>
                <div className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="w-5 shrink-0 text-right text-[rgba(255,255,255,0.35)]">{p.rank}</span>
                  <span
                    className={
                      p.role === "pillar"
                        ? "rounded bg-[rgba(0,201,167,0.15)] px-1.5 text-[10px] uppercase text-[#00C9A7]"
                        : "rounded bg-[rgba(255,255,255,0.07)] px-1.5 text-[10px] uppercase text-[rgba(255,255,255,0.45)]"
                    }
                  >
                    {p.role}
                  </span>
                  <span className="text-white">{p.headline ?? p.workingTitle}</span>
                  <span className="text-[rgba(255,255,255,0.35)]">{p.targetKeyword}</span>
                  <Marks page={p} />
                  <button
                    type="button"
                    className={ghost}
                    onClick={() => {
                      setOpen(open === p.rank ? null : p.rank);
                      setRename(p.workingTitle);
                      setCta(p.ctaLine ?? "");
                    }}
                  >
                    {open === p.rank ? "close" : "edit"}
                  </button>
                </div>

                {open === p.rank && (
                  <div className="ml-7 mt-2 space-y-2 rounded-lg border border-[rgba(255,255,255,0.08)] p-2.5">
                    <p className="text-[11px] text-[rgba(255,255,255,0.45)]">{p.question}</p>
                    <div className="flex gap-2">
                      <input
                        className={input}
                        value={rename}
                        onChange={(e) => setRename(e.target.value)}
                        placeholder="Working title, under 70 characters, no dashes"
                      />
                      <button
                        type="button"
                        className={ghost}
                        disabled={busy !== null}
                        onClick={() => act("plan_edit", { action: "plan_edit", rank: p.rank, text: rename })}
                      >
                        rename
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        className={input}
                        value={cta}
                        onChange={(e) => setCta(e.target.value)}
                        placeholder="The one sentence this page offers the magnet with. Empty falls back."
                      />
                      <button
                        type="button"
                        className={ghost}
                        disabled={busy !== null}
                        onClick={() => act("plan_cta", { action: "plan_cta", rank: p.rank, text: cta })}
                      >
                        set
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={ghost}
                        disabled={busy !== null || p.status === "claimed"}
                        onClick={() => act("plan_swap", { action: "plan_swap", rank: p.rank })}
                      >
                        {busy === "plan_swap" ? "swapping..." : "swap for the next best"}
                      </button>
                      <button
                        type="button"
                        className={ghost}
                        disabled={busy !== null || p.status === "claimed"}
                        onClick={() => act("plan_drop", { action: "plan_drop", rank: p.rank })}
                      >
                        drop
                      </button>
                      {p.status === "claimed" && (
                        <span className="text-[11px] text-[rgba(255,255,255,0.35)]">
                          Being written, so it cannot be swapped or dropped.
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ── Headlines: the pain, not the keyword ──────────────────────────────── */}
      {approved.length > 0 && (
        <section className="mt-5 border-t border-[rgba(255,255,255,0.07)] pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-white">Headlines</span>
            <button
              type="button"
              className={btn}
              disabled={busy !== null}
              onClick={() => act("headlines_write", { action: "headlines_write" })}
            >
              {busy === "headlines_write" ? "Writing..." : "Write three options each"}
            </button>
            {state.needHeadline.length > 0 && (
              <span className="text-[11px] text-[rgba(255,255,255,0.4)]">
                still to pick: {state.needHeadline.join(", ")}
              </span>
            )}
          </div>

          <div className="mt-3 space-y-3">
            {approved.map((p) => (
              <div key={p.id}>
                <div className="text-[11px] text-[rgba(255,255,255,0.45)]">
                  {p.rank}. {p.targetKeyword}
                  {p.headline ? ` — picked: ${p.headline}` : ""}
                </div>
                {p.headlineOptions.length === 0 ? (
                  <p className="text-[11px] text-[rgba(255,255,255,0.3)]">no options written yet</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {p.headlineOptions.map((h, i) => (
                      <li key={`${p.id}-${i}`} className="flex items-start gap-2">
                        <button
                          type="button"
                          className={ghost}
                          disabled={busy !== null}
                          onClick={() =>
                            act("headline_pick", { action: "headline_pick", rank: p.rank, pick: i + 1 })
                          }
                        >
                          pick {i + 1}
                        </button>
                        <span
                          className={
                            h === p.headline
                              ? "text-xs text-[#00C9A7]"
                              : "text-xs text-[rgba(255,255,255,0.7)]"
                          }
                        >
                          {h}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Skeletons, only once every page knows what it promises ────────────── */}
      {headlinesDone && (
        <section className="mt-5 border-t border-[rgba(255,255,255,0.07)] pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-white">Skeletons</span>
            <button
              type="button"
              className={btn}
              disabled={busy !== null}
              onClick={() => act("skeletons_write", { action: "skeletons_write" })}
            >
              {busy === "skeletons_write" ? "Outlining..." : "Write the outlines"}
            </button>
            {state.needSkeleton.length > 0 && (
              <span className="text-[11px] text-[rgba(255,255,255,0.4)]">
                still to outline: {state.needSkeleton.join(", ")}
              </span>
            )}
          </div>
        </section>
      )}

      {/* ── One research prompt for the whole batch, run elsewhere ────────────── */}
      {skeletonsDone && (
        <section className="mt-5 border-t border-[rgba(255,255,255,0.07)] pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-white">Research</span>
            <button
              type="button"
              className={btn}
              disabled={busy !== null}
              onClick={() => act("research_prompt", { action: "research_prompt" })}
            >
              {busy === "research_prompt" ? "Building..." : "Build the one prompt"}
            </button>
          </div>

          {prompt && (
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.3)] p-2.5 text-[11px] leading-relaxed text-[rgba(255,255,255,0.8)]">
              {prompt}
            </pre>
          )}

          <textarea
            className={`${input} mt-2 h-24`}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Paste the whole answer back here, tags and all."
          />
          <button
            type="button"
            className={`${btn} mt-2`}
            disabled={busy !== null || !paste.trim()}
            onClick={() =>
              act("research_file", { action: "research_file", text: paste }).then(() => setPaste(""))
            }
          >
            {busy === "research_file" ? "Filing..." : "File the answer"}
          </button>
        </section>
      )}

      {/* ── Drafting, one wave per press ──────────────────────────────────────── */}
      {skeletonsDone && (
        <section className="mt-5 border-t border-[rgba(255,255,255,0.07)] pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-white">
              Draft: {drafted.length} of {approved.length}
            </span>
            <button
              type="button"
              className={btn}
              disabled={busy !== null || state.outstanding === 0}
              onClick={() => act("draft_wave", { action: "draft_wave" })}
            >
              {busy === "draft_wave"
                ? "Writing, this takes a few minutes..."
                : state.outstanding === 0
                  ? "Every page has a body"
                  : `Draft the next pass (${state.outstanding} to go)`}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-[rgba(255,255,255,0.35)]">
            One pass per press. A page that already has a body is never rewritten, so pressing again
            picks up exactly where the last pass stopped.
          </p>
        </section>
      )}

      {/* ── Publishing, through publishPage, both rails intact ────────────────── */}
      {drafted.length > 0 && (
        <section className="mt-5 border-t border-[rgba(255,255,255,0.07)] pt-4">
          <span className="text-xs text-white">Publish</span>

          {choices && (
            <div className="mt-2 rounded-lg border border-[rgba(255,255,255,0.12)] p-2.5">
              {/* ‼️ NOTHING IS PRE-SELECTED. A picker that opens on the first option is a default,
                  and this client has two destinations wired, neither of which is one. */}
              <p className="text-[11px] text-[rgba(255,255,255,0.5)]">Which destination?</p>
              {choices.options.map((c) => (
                <label key={c.id} className="mt-1 flex items-center gap-2 text-xs text-white">
                  <input
                    type="radio"
                    name="destination"
                    checked={destination === c.id}
                    onChange={() => setDestination(c.id)}
                  />
                  {c.label}
                </label>
              ))}
              <button
                type="button"
                className={`${btn} mt-2`}
                disabled={busy !== null || !destination}
                onClick={() =>
                  act("publish", {
                    action: "publish",
                    pageId: choices.pageId,
                    destinationId: destination,
                  })
                }
              >
                {busy === "publish" ? "Publishing..." : "Publish there"}
              </button>
            </div>
          )}

          <ul className="mt-2 space-y-1.5">
            {drafted.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="w-5 shrink-0 text-right text-[rgba(255,255,255,0.35)]">{p.rank}</span>
                <span className="text-white">{p.headline ?? p.workingTitle}</span>
                <span className="text-[rgba(255,255,255,0.35)]">{p.slug ?? ""}</span>
                {p.pageStatus === "published" ? (
                  <>
                    <span className="text-[#00C9A7]">live</span>
                    <button
                      type="button"
                      className={ghost}
                      disabled={busy !== null || !p.pageId}
                      onClick={() => act("unpublish", { action: "unpublish", pageId: p.pageId })}
                    >
                      take it down
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={ghost}
                    disabled={busy !== null || !p.pageId}
                    onClick={() =>
                      act("publish", {
                        action: "publish",
                        pageId: p.pageId,
                        ...(destination ? { destinationId: destination } : {}),
                      })
                    }
                  >
                    publish
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Where one page is, as four marks rather than a sentence per row. */
function Marks({ page }: { page: LaunchPlanPage }) {
  const marks: Array<[string, boolean, string]> = [
    ["H", Boolean(page.headline), "a headline is picked"],
    ["O", page.hasOutline, "a skeleton is written"],
    ["B", page.hasBody, "the page has a body"],
    ["L", page.pageStatus === "published", "it is live"],
  ];
  return (
    <span className="flex gap-1">
      {marks.map(([glyph, on, title]) => (
        <span
          key={glyph}
          title={title}
          className={
            on
              ? "rounded bg-[rgba(0,201,167,0.18)] px-1 text-[10px] text-[#00C9A7]"
              : "rounded bg-[rgba(255,255,255,0.05)] px-1 text-[10px] text-[rgba(255,255,255,0.25)]"
          }
        >
          {glyph}
        </span>
      ))}
    </span>
  );
}

/**
 * The awareness ladder and the rung the build is anchored at.
 *
 * ‼️ A RUNG WHOSE ANCHOR IS NOT DELIVERABLE IS MARKED BEFORE IT IS TAPPED. pickRung refuses on
 * exactly that, and a rung naming a magnet key that no longer exists looks identical to a pickable
 * one until the refusal arrives. Rewriting the ladder is what fixes it.
 */
function LadderBlock({
  state,
  busy,
  act,
}: {
  state: LaunchPagesState;
  busy: string | null;
  act: (key: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [show, setShow] = useState(false);
  const stale = (state.ladder ?? []).filter((r) => !r.anchorDeliverable).length;

  return (
    <section className="mt-5 border-t border-[rgba(255,255,255,0.07)] pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-white">The ladder</span>
        <span className="text-[11px] text-[rgba(255,255,255,0.4)]">
          {state.ladderAnchorStage
            ? `anchored at ${state.ladderAnchorStage}${state.anchorTitle ? `, offering "${state.anchorTitle}"` : ""}`
            : "no rung picked yet"}
        </span>
        <button
          type="button"
          className={btn}
          disabled={busy !== null}
          onClick={() => act("ladder_write", { action: "ladder_write" })}
        >
          {busy === "ladder_write" ? "Rewriting..." : "Rewrite it"}
        </button>
        {state.ladder && (
          <button type="button" className={ghost} onClick={() => setShow(!show)}>
            {show ? "hide the rungs" : "show the rungs"}
          </button>
        )}
      </div>

      {stale > 0 && (
        <p className="mt-2 text-[11px] text-[#FFC400]">
          {stale} rung{stale === 1 ? "" : "s"} name an offer this client cannot hand over, so those
          cannot be anchored at. Rewriting the ladder picks from the catalogue as it stands today.
        </p>
      )}

      {show &&
        (state.ladder ?? []).map((r: LaunchLadderRung) => (
          <div
            key={r.stage}
            className="mt-2 rounded-lg border border-[rgba(255,255,255,0.08)] p-2.5 text-xs"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-white">
                {r.stage}. {r.readerState}
              </span>
              {r.stage === state.ladderAnchorStage && (
                <span className="rounded bg-[rgba(0,201,167,0.15)] px-1.5 text-[10px] uppercase text-[#00C9A7]">
                  anchored
                </span>
              )}
              <button
                type="button"
                className={ghost}
                disabled={busy !== null || !r.anchorDeliverable}
                title={r.anchorDeliverable ? "" : `${r.anchorKey} hands over nothing`}
                onClick={() => act("ladder_pick", { action: "ladder_pick", stage: r.stage })}
              >
                anchor at {r.stage}
              </button>
            </div>
            <p className="mt-1 text-[rgba(255,255,255,0.6)]">{r.claim}</p>
            <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.35)]">
              offers {r.anchorTitle ?? r.anchorKey}
              {r.anchorDeliverable ? "" : " (not in this client's catalogue)"}
            </p>
          </div>
        ))}
    </section>
  );
}
