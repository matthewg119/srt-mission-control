// The Instagram DM run: what happens after the extension presses the button.
//
// It lives here rather than in the route for the reason the CRM workflow route states about its
// own handlers: a route should be a doorway. There are three doors into this work already (start,
// redraft, and a retry once Matthew types a website), and a copy of the pipeline behind each one
// would be three places for the Slack card, the timeline note and the rejected-draft labelling to
// drift apart.
//
// ‼️ THE RUN ROW IS THE UNIT OF TRUTH, not the response. The scan takes longer than the 30s these
// /api/ext/* routes allow, so the POST returns a runId and the panel polls. Everything the panel
// will ever show is written to `ig_dm_runs` as it is produced; nothing is held in memory waiting
// for a request that may never come back.

import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "@/lib/db";
import { addNote } from "@/lib/crm";
import { slack, slackThreadLink } from "@/lib/slack-bot";
import { getOrCreateAuditChannel } from "@/lib/audit-engine/audit-channel";
import { runHookCheck, type HookCheck } from "@/lib/audit-engine/hook-pitch";
import { runMiniVisibilityCheck, type MiniCheck } from "@/lib/audit-engine/no-website-pitch";
import {
  draftDmVariants,
  formatDmCard,
  formatDmNote,
  type DmDraftSet,
  type DmFacts,
} from "@/lib/audit-engine/dm-pitch";

/** How long one run blocks another for the same profile. */
export const IG_CLAIM_MINUTES = 5;

export type IgRunStatus = "running" | "done" | "failed";

export interface IgRunRow {
  id: string;
  contact_id: string | null;
  handle: string;
  website: string | null;
  status: IgRunStatus;
  lane: DmFacts["kind"] | null;
  angle: string | null;
  check_json: unknown;
  variants: unknown;
  error_detail: string | null;
  created_at: string;
}

export function profileUrl(handle: string): string {
  return `https://www.instagram.com/${handle}/`;
}

export function leadUrl(contactId: string | null): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  return base && contactId ? `${base}/dashboard/leads/${contactId}` : null;
}

/**
 * Rebuild DmFacts from what was stored on the run row.
 *
 * This is what makes Regenerate free. The scan is the expensive half (a crawl, a classify, four
 * engine calls and an extractor pass) and its result is a value, not a process, so re-drafting off
 * the stored copy produces new wording for the price of one model call. It also means a redraft
 * cannot silently drift onto different facts: there is only ever one scan behind a run.
 */
export function factsFromRow(row: Pick<IgRunRow, "lane" | "check_json" | "handle">, businessName: string): DmFacts | null {
  if (!row.check_json) return null;
  if (row.lane === "hook") return { kind: "hook", check: row.check_json as HookCheck };
  if (row.lane === "nowebsite") {
    // ‼️ A STORED check_json IS WHATEVER SHAPE MiniCheck HAD THE DAY IT WAS WRITTEN. Rows from
    // before 2026-08-25 carry no `trade`, `tradeSource` or `topRivals`, and a redraft of one of
    // them must degrade to "no rivals, no trade" rather than throw on a read of undefined.length.
    // dmSubjectOf and pickAngle both `?? []` for the same reason; this is the belt to that braces.
    const stored = row.check_json as Partial<MiniCheck>;
    return {
      kind: "nowebsite",
      check: {
        ...(stored as MiniCheck),
        trade: stored.trade ?? null,
        tradeSource: stored.tradeSource ?? null,
        topRivals: stored.topRivals ?? [],
      },
      businessName,
    };
  }
  return null;
}

/**
 * Publish a finished draft set: run row, Slack card, lead timeline.
 *
 * ‼️ THE ROW IS WRITTEN FIRST, before Slack. Slack is where the work is watched, but the panel is
 * where it is used, and a Slack outage must not cost Matthew the drafts he is sitting there
 * waiting for. Same reasoning as the try/catch around the hook card in the CRM workflow route:
 * losing the card must not lose the pitch.
 */
export async function publishDmSet(opts: {
  runId: string;
  contactId: string | null;
  handle: string;
  facts: DmFacts;
  set: DmDraftSet;
  /** False on a redraft: the timeline already carries this run, and a note per press is noise. */
  writeNote?: boolean;
}): Promise<void> {
  const { runId, contactId, handle, facts, set } = opts;

  await supabaseAdmin
    .from("ig_dm_runs")
    .update({
      status: "done",
      angle: set.angle,
      lane: set.lane,
      variants: set.variants,
      error_detail: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);

  const url = profileUrl(handle);
  let slackUrl: string | null = null;
  try {
    const channel = await getOrCreateAuditChannel();
    const posted = await slack.postMessage(
      channel.id,
      formatDmCard(facts, set, url, leadUrl(contactId))
    );
    const ts = typeof posted.ts === "string" ? posted.ts : null;
    if (ts) slackUrl = slackThreadLink(channel.id, ts);
  } catch (e) {
    console.error("[ig/dm] card failed to post:", (e as Error).message);
  }

  if (contactId && opts.writeNote !== false) {
    await addNote({
      contactId,
      title: set.allRejected
        ? "Instagram DM REJECTED by the linter"
        : "Instagram DM drafted",
      content: formatDmNote(facts, set, url, slackUrl),
      origin: "mission_control",
      actor: "Instagram extension",
    });
  }
}

/** Mark a run failed, and say so on the lead, so a dead run is never a silent one. */
export async function failRun(runId: string, contactId: string | null, detail: string): Promise<void> {
  await supabaseAdmin
    .from("ig_dm_runs")
    .update({ status: "failed", error_detail: detail, updated_at: new Date().toISOString() })
    .eq("id", runId);

  if (contactId) {
    await addNote({
      contactId,
      title: "Instagram DM failed",
      content: detail,
      origin: "mission_control",
      actor: "Instagram extension",
    });
  }
}

/**
 * The whole run, from a started row to a finished one.
 *
 * ‼️ ONLY OUR OWN FAILURES ARE FAILURES. A prospect who does not show up anywhere is the strongest
 * finding this lane has, not an error, and both scans already encode that distinction: they return
 * ok:false only when the crawl could not run, the classifier threw, or every engine call came back
 * empty. That doctrine is inherited here rather than reinterpreted, so a dead API key can never
 * become a sentence in a stranger's DM. See the header of runHookCheck.
 */
export function startDmRun(opts: {
  runId: string;
  contactId: string | null;
  handle: string;
  website: string | null;
  businessName: string;
  firstName: string | null;
  city: string | null;
  /** Their Instagram bio, verbatim. The no-website lane reads the trade off it. */
  bio?: string | null;
  instructions?: string | null;
}): void {
  const { runId, contactId, handle, website, businessName, firstName, city } = opts;

  waitUntil(
    (async () => {
      try {
        let facts: DmFacts;

        if (website) {
          // ‼️ businessName is a NAME HINT and is never a URL. classifyBusiness pins the business
          // name to whatever it is handed, and every alias, mention match and greeting downstream
          // is built from that; the reasoning is written out at workflow/route.ts:322. An empty
          // string is the correct value when the profile did not give us a real one, because it
          // lets the classifier read the name off the pages it just crawled.
          const outcome = await runHookCheck(website, businessName, city);
          if (!outcome.ok) return failRun(runId, contactId, outcome.detail);
          facts = { kind: "hook", check: outcome.check };
        } else {
          if (!businessName.trim()) {
            return failRun(
              runId,
              contactId,
              "No website and no business name, so there was nothing to look up. Add a name or a site and press it again."
            );
          }
          const outcome = await runMiniVisibilityCheck(businessName, city, {
            bioHint: opts.bio ?? null,
          });
          if (!outcome.ok) return failRun(runId, contactId, outcome.detail);
          facts = { kind: "nowebsite", check: outcome.check, businessName };
        }

        // Stored BEFORE drafting. The scan is the expensive half, and if the drafting call fails
        // the run can be redrafted for one model call instead of scanned again.
        await supabaseAdmin
          .from("ig_dm_runs")
          .update({
            lane: facts.kind,
            check_json: facts.check,
            updated_at: new Date().toISOString(),
          })
          .eq("id", runId);

        const set = await draftDmVariants(facts, firstName, 3, opts.instructions ?? null);
        await publishDmSet({ runId, contactId, handle, facts, set });
      } catch (e) {
        console.error("[ig/dm] run failed:", e);
        await failRun(
          runId,
          contactId,
          `The run failed before it finished: ${(e as Error).message}. That is about our side, not about this prospect. Press it again.`
        );
      }
    })()
  );
}
