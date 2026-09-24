// The last line of every step card: what YOU do, in bullets, right now.
//
// Matthew, 2026-09-17: "make sure we send one last and final text with a golden nugget /
// bulletpoint version simpler to read on exactly what we need to do to finish that step (if its
// select an option, paste a screenshot, or revise something)."
//
// ‼️ THIS IS NOT `*Next:*` AND THE TWO MUST NOT BE MERGED. next-steps.ts answers "what does this
// unblock on the board", which is about the FUTURE and is derived from blockedBy. This answers
// "what is being waited on from a person", which is about NOW and cannot be derived from anything:
// the board knows a step is open, it does not know that opening it means pasting a research answer
// rather than pressing a button. Both blocks appear, in that order, on every card.
//
// ‼️ EVERY STEP HAS AN ENTRY AND THE TYPE IS WHAT ENFORCES IT. `Record<StepKey, StepAction>` fails
// to compile when a step is added without one, which is the same mechanism STEP_VERIFIERS relies on
// and the reason step coverage has never drifted. A default arm would have let forty steps go
// unwritten and looked fine.
//
// ‼️ EVERY COMMAND NAMED IN A BULLET MUST BE ONE THE THREAD ACTUALLY ACCEPTS. A card that invents a
// command is worse than a card that says nothing: the person types it, nothing happens, and they
// learn to distrust the whole block. _probe-do-this-now.ts greps each one back out of src/.
//
// ‼️ IT IS STATIC, NOT DERIVED FROM THE VERIFIER. A verifier's `todo` is better copy, but running
// one costs a database read and, for concierge_preview and subdomain_live, a live URL probe. Doing
// that on every card post would put a network call in front of every render. So the table is the
// baseline and the verdict is folded in only where one is already in hand, which is a refusal.

import type { StepKey } from "@/config/delivery-steps";
import { DELIVERY_STEPS, stepNumber } from "@/config/delivery-steps";

/**
 * What kind of act finishes this step. Rendered as the label beside the heading, so somebody
 * scanning twenty cards can see at a glance which two are waiting on them to type something.
 */
export type ActionVerb =
  | "pick"
  | "paste"
  | "screenshot"
  | "confirm"
  | "decide"
  | "send"
  | "run"
  | "wait";

export interface StepAction {
  verb: ActionVerb;
  /** Two to four short lines. The last one is almost always how the step closes. */
  bullets: readonly string[];
}

/** Rendered after the verb, so "pick" and "wait" do not read as the same kind of ask. */
const VERB_LABEL: Record<ActionVerb, string> = {
  pick: "pick one",
  paste: "paste something back",
  screenshot: "add a screenshot",
  confirm: "confirm it",
  decide: "make a call",
  send: "send it",
  run: "run it",
  wait: "nothing, unless it stalled",
};

/**
 * ‼️ ORDERED AS THE BOARD IS ORDERED so a reader can diff this against delivery-steps.ts by eye.
 * Keys, never numbers: delivery-steps.ts renumbers every step whenever one is inserted.
 */
export const STEP_ACTIONS: Record<StepKey, StepAction> = {
  // ── Before the call ─────────────────────────────────────────────────────────
  intake_received: {
    verb: "wait",
    bullets: [
      "The intake form writes this one. Nothing to type.",
      "If it has sat open, the form was started and never finished. Chase the client, do not tick it.",
    ],
  },
  baseline_scan: {
    verb: "wait",
    bullets: [
      "The scan runs itself and writes the baseline every later number is measured against.",
      "If it errored, `rerun` in this thread. Do not tick it by hand: the Day 0 wall reads this.",
    ],
  },
  site_dns_intel: {
    verb: "wait",
    bullets: ["Runs itself. It reads their DNS and tells you who their host and registrar are."],
  },
  nap_sweep: {
    verb: "wait",
    bullets: [
      "Runs itself, then the manual sweep beside it is where a person fills the gaps.",
      "Read the mismatches here before the call. A wrong address is the cheapest win on the call.",
    ],
  },
  presence_sweep_manual: {
    verb: "confirm",
    bullets: [
      "Open the sweep panel on the dashboard and work down the platforms one at a time.",
      "Mark each one found or missing. An unanswered row is not the same as a missing profile.",
      "Then press Done.",
    ],
  },
  competitor_shortlist: {
    verb: "pick",
    bullets: [
      "Open the competitor panel and tick the ones that are really competitors.",
      "The list came from a classifier, so it will carry at least one that is not.",
      "Then press Done.",
    ],
  },
  avatar_confirmed: {
    verb: "pick",
    bullets: [
      "Pick which of the three candidate avatars this client is actually selling to.",
      "Or type `avatar: laser hair removal` in this thread to name one directly.",
      "Then press Done.",
    ],
  },
  review_audit: {
    verb: "confirm",
    bullets: [
      "Open the review audit panel and fill in what each platform actually shows.",
      "Then press Done.",
    ],
  },
  offer_proposed: {
    verb: "wait",
    bullets: [
      "A proposal, not a decision. It reads their site and guesses what they lead with.",
      "The next step is where you lock it, and you can overrule this entirely.",
    ],
  },
  offer_locked: {
    verb: "decide",
    bullets: [
      "One command per message. A message with two in it saves neither.",
      "`offer: <what they sell>` first. Then `terms: <what their customers call it>, <another>`.",
      "Then `outcome:`, `price:` and `guarantee:` as separate messages.",
      "`letter draft` writes the sales letter from that, `letter approve` locks it. Step " +
        `${stepNumber("avatar_harvest")} waits on it.`,
      "Then press Done. Every page, keyword and magnet downstream is written from this.",
    ],
  },
  avatar_harvest: {
    verb: "paste",
    bullets: [
      "Type `prompt` to get the research script, run it in claude.com, then paste the answer back.",
      "Four documents, four messages: `research:`, `avatar sheet:`, `short offer:`, `beliefs:`.",
      "‼️ Read the ingest count on the reply. If it says zero rows parsed, the answer is wrong, not the code.",
      "Then press Done.",
    ],
  },
  keyword_set: {
    verb: "pick",
    bullets: [
      // ‼️ THE PROMPT IS THE FIRST BULLET, AND THAT ORDER IS THE POINT. What is in the set before
      // anybody types anything is mostly `expansion` rows, which are a model's proposal and rank
      // below evidence on purpose. Approving first means approving those. Researching first means
      // the answers arrive as `manual` rows, which PRECEDENCE puts above every one of them.
      "`keywords prompt` first: it hands over a research prompt that already knows the offer. Run it in claude.com.",
      "‼️ `keywords pick:` then the list, one per line: it stores them AND selects them, and hands back the numbers. `keywords add:` stores without selecting.",
      "`keywords variations` writes more ways to say the ones you picked. `keywords` to see the set, `keywords drop 4, 9` for anything off-offer.",
      "`keywords approve 411-423` locks only the ones you picked. `keywords approve mine` locks the ones you typed. Bare `keywords approve` takes all of them.",
      "`keywords shortlist` then picks the 25 subjects worth googling. Paste each screenshot with `keywords serp 12` in the message. Nothing is used until its picture is on file.",
      "`strategy` groups them into clusters, `serp cards` puts the pictures and the scores in this thread to approve. `strategy approve` locks it, then press Done.",
    ],
  },
  custom_question_set: {
    verb: "wait",
    bullets: [
      "Runs itself from the approved keywords, and freezes. It is the Day 0 measurement set.",
      "‼️ Once frozen it is never edited. A change is a new version and a new baseline.",
    ],
  },
  page_candidates: {
    verb: "wait",
    bullets: ["Runs itself. It builds the backlog of pages this client could be written, and is regenerated freely."],
  },
  citation_cleanup_list: {
    verb: "wait",
    bullets: ["Runs itself. It lists the directories carrying a wrong name, address or phone."],
  },
  hub_preview: {
    verb: "pick",
    bullets: [
      "Open the preview link and look at it as the client will.",
      "`template <name>` to try another skin, `skin` to see what is set, `skin reset` to undo.",
      "Confirm the theme, then press Done.",
    ],
  },
  referral_engine_preview: {
    verb: "confirm",
    bullets: ["Open the preview and check it is themed to match the hub. Then press Done."],
  },
  concierge_preview: {
    verb: "decide",
    bullets: [
      "Press the lane that matches who the widget talks to: their patients, or the owner.",
      "Press Include or Not now for the add-on. Declining keeps the row, so pages and magnets still work.",
      "`concierge install` in any of their threads undoes a decline later.",
      "Then press Done.",
    ],
  },
  site_replica: {
    verb: "confirm",
    bullets: ["Open the replica of their own site and walk it once. Then press Done."],
  },
  review_card_pdf: {
    verb: "wait",
    bullets: ["Runs itself and puts the printable card in the thread. Open it once before the call."],
  },
  pre_call_pages: {
    verb: "pick",
    bullets: [
      "`ladder` writes a rung per awareness stage, `ladder pick 4` anchors the offer at one.",
      "`pillar: 7` sets the offer page by its keyword number, `supports auto` takes the top six.",
      "`angles auto` gives each page three ideas, `angle 3 pick 2` keeps one. The idea comes before the line.",
      "`magnets` lists the offer each page hands over, `magnet 3 pick 2` keeps one.",
      "`headlines` lists the candidates, `headlines pick 4, 9, 12` keeps seven.",
      "Then press Done. Nothing here publishes.",
    ],
  },
  call_sheet: {
    verb: "wait",
    bullets: ["Runs itself and renders the call pack. Read it before you dial, not on the call."],
  },

  // ── During the call ─────────────────────────────────────────────────────────
  call_booked: {
    verb: "confirm",
    bullets: ["Press Done once the call is actually in a calendar, not once it has been offered."],
  },
  call_held: {
    verb: "confirm",
    bullets: [
      "On the call: read the NAP aloud, get the question set approved, confirm consent.",
      "Walk the preview and the drafted pages while they are watching.",
      "Then press Done.",
    ],
  },
  access_granted: {
    verb: "confirm",
    bullets: [
      "GBP manager access, Search Console and Analytics. All three, on the call, while they are in front of you.",
      "Then press Done. Asking for this after the call is how it never arrives.",
    ],
  },
  dns_records: {
    verb: "confirm",
    bullets: [
      "Open the DNS panel and read the records to whoever holds the registrar login.",
      "Press Done once they are entered, not once they resolve. Resolving is a later step.",
    ],
  },
  agreement_signed: {
    verb: "send",
    bullets: [
      "Send the signing link from the agreement panel while they are still on the call.",
      "Then press Done once it is executed, not once it is sent.",
    ],
  },

  // ── After the call ──────────────────────────────────────────────────────────
  day_zero_archive: {
    verb: "confirm",
    bullets: [
      "‼️ The one hard rail. Nothing publishes until this is archived.",
      "Press Done once the Day 0 run is recorded, and never to tidy the board.",
    ],
  },
  gbp_buildout: {
    verb: "confirm",
    bullets: ["Build the profile out: categories, services, hours, photos. Then press Done."],
  },
  citation_cleanup: {
    verb: "confirm",
    bullets: ["Work the cleanup list until the name, address and phone agree everywhere. Then press Done."],
  },
  subdomain_live: {
    verb: "confirm",
    bullets: [
      "The records have to actually resolve now, not just be entered.",
      "`rerun` re-probes it. If it still says not found, it is DNS, not the board.",
      "Then press Done.",
    ],
  },
  first_page: {
    verb: "confirm",
    bullets: [
      "In the page studio channel, not here: `page <client>`, then `draft`, `check` and `polish`.",
      "The gate blocks on evidence and only warns on style. A block means a claim has no source.",
      "Then press Done.",
    ],
  },
  cards_printed: {
    verb: "confirm",
    bullets: ["Press Done once the review cards are physically printed and with the client."],
  },
  review_request_configured: {
    verb: "confirm",
    bullets: ["Set up how review requests actually go out, then press Done."],
  },
  referral_engine_handed: {
    verb: "confirm",
    bullets: [
      "`review link: <url>` records where their reviews are collected.",
      "Hand the tool over and show somebody there how to use it. Then press Done.",
    ],
  },
  concierge_live: {
    verb: "decide",
    bullets: [
      "Press Turn the concierge ON. It appears on their pages within five minutes.",
      "`booking: <their booking link>` sets where their patients go. A phone number or `booking: callback` also work.",
      "The audience has to be confirmed too, or it greets people and strands them.",
      "Then press Done. The switch alone does not tick this step.",
    ],
  },
  tracking_installed: {
    verb: "confirm",
    bullets: [
      "Check the tag actually fires on a real page view, not that it was pasted in.",
      "Then press Done.",
    ],
  },
  self_report_field: {
    verb: "confirm",
    bullets: [
      "Add the how-did-you-hear-about-us field to their booking form. It is the only attribution we get.",
      "Then press Done.",
    ],
  },
  time_log_entries: {
    verb: "wait",
    bullets: ["Runs itself off the time log. If it is empty, nobody has logged any hours for this client."],
  },
  weekly_report: {
    verb: "wait",
    bullets: ["Runs itself on a schedule. Read the first one before it reaches the client."],
  },
  day_30_date: {
    verb: "decide",
    bullets: [
      "Set the day 30 retest date, which is when the baseline gets measured again.",
      "Then press Done.",
    ],
  },
};

/** One readiness line, when the step carries a dataset worth counting. */
export interface Readiness {
  label: string;
  have: number;
  need: number;
  missing: readonly string[];
}

export interface DoThisNowContext {
  readiness?: Readiness | null;
}

/**
 * The four documents step 11 brings back, in the order the script asks for them.
 *
 * ‼️ KINDS, NOT THE `research:` PREFIXES. avatar-framework.ts owns the prefixes a person types;
 * these are what those parse into. Counting the prefixes would count what was SAID, and the whole
 * point of the line is what was STORED.
 */
const AVATAR_DOCUMENT_KINDS = [
  ["deep_research", "research"],
  ["avatar_sheet", "avatar sheet"],
  ["short_offer", "short offer"],
  ["necessary_beliefs", "beliefs"],
] as const;

/**
 * A dataset count for the steps that carry one, else null.
 *
 * Matthew, 2026-09-17: "creating a new avatar (and completing all of the necessary datasets we have
 * in order to have a full avatar ready to make it into production, the 4 documents)."
 *
 * ‼️ EVERY FAILURE RETURNS null RATHER THAN A ZERO. "0 of 4" on a card is a statement that nothing
 * was pasted back, and rendering that because a select errored would send somebody to redo research
 * they already did. An absent line is honest; a wrong count is not.
 */
export async function readinessFor(clientId: string, stepKey: StepKey): Promise<Readiness | null> {
  // ‼️ STEP 11 KEEPS ITS OWN COUNT, AND IT IS NOT A PARALLEL GAP ENGINE. step-gaps.ts reports 46
  // missing FIELDS here, which is true and useless on a card: twenty of them are headings of one
  // document. "Documents: 2 of 4" is the same fact at the altitude a person acts on, and the four
  // kinds below are what the step actually collects. Every other step is answered generically by
  // gapsFor at the end of this function, so nothing returns a flat null any more.
  if (stepKey !== "avatar_harvest") return await genericReadiness(clientId, stepKey);

  const { supabaseAdmin } = await import("@/lib/db");
  const { data, error } = await supabaseAdmin
    .from("audience_documents")
    .select("kind")
    .eq("client_id", clientId)
    .in(
      "kind",
      AVATAR_DOCUMENT_KINDS.map(([k]) => k)
    )
    .is("superseded_at", null);

  if (error || !data) {
    console.error(`[do-this-now] readiness read failed: ${error?.message ?? "no rows"}`);
    return null;
  }

  const have = new Set(data.map((r) => String(r.kind)));
  return {
    label: "Documents",
    have: have.size,
    need: AVATAR_DOCUMENT_KINDS.length,
    missing: AVATAR_DOCUMENT_KINDS.filter(([k]) => !have.has(k)).map(([, label]) => label),
  };
}

/**
 * The same line for every other step, derived from what that step declares it needs.
 *
 * ‼️ NULL FOR A STEP THAT ASKS FOR NOTHING, AND NULL ON ANY FAILURE. Thirty-one of the forty-one
 * steps declare `{ kind: "nothing" }` in step-needs.ts, and "0 of 0" on their cards would be noise.
 * A thrown read is null for the reason the block above gives: an absent line is honest, a wrong
 * count is not, and a card must never fail because a count could not be taken.
 */
async function genericReadiness(clientId: string, stepKey: StepKey): Promise<Readiness | null> {
  try {
    const { STEP_NEEDS } = await import("./step-needs");
    const declared = STEP_NEEDS[stepKey];
    if (declared.kind === "nothing") return null;
    if (!declared.needs.length) return null;

    const { gapsFor } = await import("./step-gaps");
    const g = await gapsFor(clientId, stepKey);
    // The datasets could not be read, so what is missing is unknown rather than empty.
    if (g.unreadable.length) return null;
    return {
      label: "Fields",
      have: g.have,
      need: g.need,
      missing: g.gaps.filter((x) => x.blocking).map((x) => x.field.label),
    };
  } catch (e) {
    console.error(`[do-this-now] readiness read failed: ${(e as Error).message}`);
    return null;
  }
}

/**
 * The block, or [] when there is nothing honest to say.
 *
 * ‼️ RETURNS [] FOR A STEP WITH NO ENTRY RATHER THAN A HEADING WITH NOTHING UNDER IT. The type makes
 * that unreachable today; it stays because a runtime key from the database is not a StepKey just
 * because it is typed as one.
 */
export function doThisNowLines(stepKey: StepKey, ctx: DoThisNowContext = {}): string[] {
  const action = STEP_ACTIONS[stepKey];
  if (!action || !action.bullets.length) return [];

  const lines = [`*Do this now:*  _${VERB_LABEL[action.verb]}_`];

  for (const b of action.bullets) lines.push(`  • ${b}`);

  if (ctx.readiness) {
    const { label, have, need, missing } = ctx.readiness;
    lines.push(
      missing.length
        ? `  • ${label}: ${have} of ${need}. Still missing: ${missing.join(", ")}.`
        : `  • ${label}: ${have} of ${need}. All in.`
    );
  }

  return lines;
}

/** Every step has one. Exported so the probe can assert it without re-deriving the list. */
export function stepsWithoutAnAction(): string[] {
  return DELIVERY_STEPS.filter((s) => !STEP_ACTIONS[s.key as StepKey]?.bullets?.length).map((s) => s.key);
}
