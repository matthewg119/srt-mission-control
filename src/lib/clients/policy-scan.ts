// "scan for latest", once a week, into the drafting channel.
//
// Matthew, 2026-09-18: "the srt aeo drafting channel ... is the one that should say 'scan for
// latest XYZ' once per week at least".
//
// ‼️ A PASSENGER ON /api/cron/followup-digest, NOT A CRON OF ITS OWN, and that refusal is the same
// one weekly-headlines.ts, weekly-report.ts, report-reminders.ts and content-digest.ts all state.
// vercel.json already carries SEVENTEEN cron entries against a Hobby plan that documents two.
// Adding an eighteenth to read five public pages once a week is exactly the move that warning
// exists to prevent.
//
// ‼️ THE CONTENT HASH IS THE IDEMPOTENCY KEY, AND IT IS STRONGER THAN THE ISO WEEK.
// weekly-headlines.ts uses the ISO week because a second run on the same Thursday would write a
// second set of twenty headlines. This lane cannot do that: a re-run re-reads the same bytes, the
// hash matches what is live, storeVersion writes nothing and returns "unchanged", and nothing is
// posted. So a re-kick, a retry or a manual GET costs five HTTP reads and changes nothing, and no
// week stamp is needed to make that true. The one case that DOES post twice is Google changing a
// page twice in one day, which is two real changes and two cards is the correct answer.
//
// ‼️ NOTHING CHANGED MEANS NOTHING POSTED. Silence is the right output six weeks in seven. A
// weekly "no change" card is the pace card wearing a new hat and is unread by week three. The one
// exception is the typed verb: a person who asked a question is owed an answer, including "nothing
// moved". See runPolicyScan's `announce`.

import { slack } from "@/lib/slack-bot";
import { GUIDELINE_SOURCES } from "@/config/guideline-rules";
import { diffLines, fetchPolicyText, liveVersion, storeVersion, PolicyUnreadable } from "./policy-documents";

// ‼️ pageStudioChannel IS IMPORTED DYNAMICALLY, INSIDE post(), AND THAT IS NOT STYLE.
// page-studio.ts imports SCAN_COMMAND from this file, so a static import back would be a module
// cycle: whichever of the two loaded first would see the other half-initialised. The channel is
// only ever needed at call time, so deferring the import removes the cycle entirely.

/**
 * `scan for latest` in the drafting channel, on demand.
 *
 * ‼️ ANCHORED AT BOTH ENDS, AND THE PAGE STUDIO IS WHY. That dispatch's governing rule, stated
 * three times in page-studio.ts, is that ANYTHING NOT MATCHED IS APPENDED TO THE PAGE VERBATIM. Two
 * live captures were swallowed exactly that way ("avatars are hard to write" captured "s are hard
 * to write"). An unanchored /scan/ would file "scan for latest changes in the copy" as a command
 * and put a sentence of dictation nowhere, or worse, match the front of a sentence and drop the
 * rest into a page.
 *
 * Exported from its own module and shared with the dispatch and the probe, the precedent
 * PLAN_COMMAND set.
 */
export const SCAN_COMMAND = /^scan(?:\s+for\s+latest)?(?:\s+(?:guidance|guidelines?|policy|policies|rules))?$/i;

/**
 * Thursday, UTC. The same weekday runWeeklyReports and runWeeklyHeadlines use.
 *
 * ‼️ DELIBERATELY THE SAME DAY. weekly-headlines.ts states the reason: both are "here is this
 * week's work" and a person reading one is in the frame of mind for the other. Splitting them
 * across two days means two separate interruptions for the same job.
 */
const SCAN_WEEKDAY = 4;

/** Slack's real ceiling is 3,000; this splits under 2,900, the same budget bodySections uses. */
const SECTION_LIMIT = 2900;

export interface ScanResult {
  checked: number;
  changed: string[];
  failed: string[];
  posted: boolean;
  skipped: "weekday" | null;
}

const NOTHING: ScanResult = { checked: 0, changed: [], failed: [], posted: false, skipped: null };

/**
 * Read every source, store what moved, and say so once.
 *
 * `now` and `force` exist for the probe, exactly as runWeeklyReports and runWeeklyHeadlines carry
 * them. `announce` is what separates the cron from the typed verb.
 *
 * ‼️ NEVER THROWS. Every caller is a cron passenger where a thrown error is a silent nothing, and
 * the route already isolates this one, but a passenger that relies on its host's catch to stay
 * quiet is one refactor away from taking the digest down.
 */
export async function runPolicyScan(opts?: {
  now?: Date;
  force?: boolean;
  /** Post even when nothing changed. True for a person who typed the verb, false for the cron. */
  announce?: boolean;
  by?: string | null;
}): Promise<ScanResult> {
  try {
    const now = opts?.now ?? new Date();
    if (!opts?.force && now.getUTCDay() !== SCAN_WEEKDAY) return { ...NOTHING, skipped: "weekday" };

    const changed: string[] = [];
    const failed: string[] = [];
    const cards: string[] = [];

    for (const source of GUIDELINE_SOURCES) {
      let text: string;
      try {
        text = await fetchPolicyText(source.url);
      } catch (e) {
        // ‼️ A FAILED FETCH WRITES NO VERSION AND IS NAMED OUT LOUD. Reporting it as "no change"
        // would answer every later reading of this source with our own timeout.
        const why = e instanceof PolicyUnreadable ? e.why : (e as Error).message;
        failed.push(`${source.label}: ${why}`);
        continue;
      }

      const before = await liveVersion(source.kind);
      const stored = await storeVersion({
        kind: source.kind,
        sourceUrl: source.url,
        title: source.label,
        content: text,
        source: "fetched",
        by: opts?.by ?? "weekly scan",
      });

      if (stored.outcome === "failed") {
        failed.push(`${source.label}: ${stored.why}`);
        continue;
      }
      if (stored.outcome === "unchanged") continue;

      if (stored.outcome === "reverted") {
        changed.push(source.label);
        cards.push(`*${source.label}* went back to a version already on file.\n<${source.url}|the page>`);
        continue;
      }

      changed.push(source.label);
      cards.push(cardFor(source.label, source.url, before?.content ?? null, stored.version.content));
    }

    const shouldPost = changed.length > 0 || failed.length > 0 || Boolean(opts?.announce);
    if (!shouldPost) {
      return { checked: GUIDELINE_SOURCES.length, changed, failed, posted: false, skipped: null };
    }

    const body = [
      changed.length
        ? `:mag: *Google's guidance moved.* ${changed.length} of ${GUIDELINE_SOURCES.length} source${changed.length === 1 ? "" : "s"} changed since we last read ${changed.length === 1 ? "it" : "them"}.`
        : failed.length && !opts?.announce
          ? ":warning: *The guidance scan could not read every source.*"
          : ":mag: *Nothing moved.* Every source reads the same as last time.",
      "",
      ...cards,
      ...(failed.length
        ? ["", "*Not read, so nothing was stored for these:*", ...failed.map((f) => `  - ${f}`)]
        : []),
      ...(changed.length
        ? [
            "",
            "*The one question that matters: does any of this change what we refuse?*",
            "The rules that bind live in `src/config/guideline-rules.ts`, not in the stored document.",
            "Editing them is a code change somebody makes on purpose, so nothing here has changed the gate.",
          ]
        : []),
    ].join("\n");

    const posted = await postToStudio(body);
    return { checked: GUIDELINE_SOURCES.length, changed, failed, posted, skipped: null };
  } catch (e) {
    console.error("[policy-scan] failed:", (e as Error).message);
    return NOTHING;
  }
}

/** One source's entry on the card. */
function cardFor(label: string, url: string, before: string | null, after: string): string {
  if (!before) {
    return `*${label}* read for the first time, so there is nothing to compare it against.\n<${url}|the page>`;
  }
  const d = diffLines(before, after);
  const lines = [`*${label}*  <${url}|the page>`];
  if (d.addedTotal) {
    lines.push(`  _${d.addedTotal} line${d.addedTotal === 1 ? "" : "s"} added:_`);
    lines.push(...d.added.map((l) => `  + ${clip(l)}`));
  }
  if (d.removedTotal) {
    lines.push(`  _${d.removedTotal} line${d.removedTotal === 1 ? "" : "s"} removed:_`);
    lines.push(...d.removed.map((l) => `  - ${clip(l)}`));
  }
  if (!d.addedTotal && !d.removedTotal) lines.push("  _the words are the same; only the layout moved._");
  return lines.join("\n");
}

function clip(line: string): string {
  return line.length > 180 ? `${line.slice(0, 177)}...` : line;
}

/**
 * Post into the drafting channel, split on line boundaries.
 *
 * Exported so the Thursday corpus scan posts through the same splitter rather than repeating it a
 * fourth time. rerun-gaps.ts and presence-sweep.ts both repeat step-engine's private bodySections
 * and say why; a fourth copy of the same eight lines is how one of them eventually drifts.
 *
 * ‼️ A BODY OVER 3,000 CHARACTERS FAILS THE WHOLE MESSAGE, silently. step-engine.ts's bodySections
 * is private, so this repeats the split rather than reaching into it, exactly as rerun-gaps.ts and
 * presence-sweep.ts both do. Never mid-line: a diff broken across two blocks reads as two changes.
 *
 * slackFetch returns {ok:false} and never throws, so the body is checked rather than the promise.
 */
export async function postToStudio(body: string): Promise<boolean> {
  const { pageStudioChannel } = await import("./page-studio");
  const channel = pageStudioChannel();
  let ok = false;
  for (const chunk of sections(body)) {
    const res = (await slack.postMessage(channel, chunk)) as { ok?: boolean; error?: string };
    if (!res?.ok) {
      console.error("[policy-scan] card not posted:", res?.error ?? "unknown");
      return ok;
    }
    ok = true;
  }
  return ok;
}

function sections(body: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const line of body.split("\n")) {
    if (current && current.length + line.length + 1 > SECTION_LIMIT) {
      out.push(current);
      current = "";
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) out.push(current);
  return out;
}
