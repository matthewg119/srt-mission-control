// The stages, and the only place they are defined. Eight as of 2026-10-03.
//
// This file used to be presentation metadata for Zoho's MCA picklist, which is why an old version
// carried two pipelines and eighteen stages. SRT is off business funding, so the funding
// vocabulary is gone and the stage column is owned here now, not by Zoho.
//
// Anything that renders, filters, validates or cadences a stage imports from this file. The old
// copies scattered across the codebase are what let template-editor.tsx drift into offering
// "Contract In" and "Funded" as stages that no lead could ever be in.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ THE 2026-10-03 REWRITE: FOUR STAGES LEFT, THREE ARRIVED, AND do_not_contact
//    STOPPED BEING A STAGE.
//
// Matthew named the eight he wants and asked for the rest deleted. Retired, and where their rows
// went (docs/2026-10-03-eight-stages.sql does exactly this):
//
//   Untouched              -> New Lead              a rename, the meaning is unchanged
//   Email Pitch            -> Working               a pitch that went out IS a contacted lead
//   Loom Sent              -> Follow Up             warmer than a pitch, colder than a reply
//   Negotiating / Follow-up-> Follow Up             a rename
//   Take Off List          -> Not Interested        the LABEL merges; the FLAG does not, see below
//
// ‼️ THE ONE THING THAT WOULD HAVE BROKEN, AND HOW IT DID NOT.
// `Take Off List` was never just a label: landing on it flipped contacts.do_not_contact, and that
// flag is what every outreach path in the codebase actually respects. Deleting the stage without
// replacing the mechanism would have removed the only way to stop contacting somebody.
//
// So do_not_contact is now what it should always have been: A FLAG ON THE RECORD, NOT A POSITION
// IN A PIPELINE. It is set explicitly (setDoNotContact in src/lib/crm.ts, the toggle on the lead
// profile and the board card menu), it is unchanged in the database, and every existing row keeps
// the flag the old stage gave it. A lead can now be "Not Interested" and still callable next
// quarter, which is the common case, or flagged do-not-contact at any stage, which the old model
// could only express by also calling the deal over.
//
// ‼️ AND ONE THING I WARNED WOULD BREAK AND DOES NOT. The funnel's "do not send a second
// walkthrough" suppression reads audit_reports.loom_url / loom_state, never this stage: see
// priorReportFor() and call-script.ts. Retiring `Loom Sent` costs visibility on the leads page
// and costs the suppression nothing. thread-assistant.ts, which was the only writer of that
// stage, now writes Follow Up.
// ─────────────────────────────────────────────────────────────────────────────

export interface StageMeta {
  name: string;
  color: string;
  /** One line, shown under the column heading on the pipeline board. */
  blurb: string;
}

export interface StagePipeline {
  name: string;
  stages: readonly StageMeta[];
}

/**
 * Arrived and nobody has decided anything about it yet.
 *
 * ‼️ IT IS NOT THE SAME AS "No Contact" AND THE TWO MUST BOTH SURVIVE. This is the ABSENCE of a
 * decision: rows the scrapers, funnels and bulk loads created without ever writing
 * application_stage, and after the Zoho import there are thousands. "No Contact" is a decision
 * somebody made. Collapsing them buries real uncontacted leads under imported noise on the same
 * call board, which is why they also carry different cadences below.
 */
export const STAGE_NEW_LEAD = "New Lead";

/** Somebody looked at this lead and said we have not reached them yet. */
export const STAGE_NO_CONTACT = "No Contact";

/** In conversation. Reached them, and the pitch is live. */
export const STAGE_WORKING = "Working";

/**
 * High intent, right now.
 *
 * Matthew asked for this one by name on 2026-10-03. It is the only stage on the board that is
 * about TEMPERATURE rather than about what has happened, which is why it sits between Working and
 * Appointment Booked rather than in the sequence of events: a lead is moved here by a person who
 * just spoke to them, not by anything automatic. It carries the fastest cadence of any stage and
 * it scores on the call board.
 */
export const STAGE_HOT = "Hot";

/** There is a meeting in the calendar. */
export const STAGE_APPOINTMENT_BOOKED = "Appointment Booked";

/** Live conversation that needs chasing. Was "Negotiating / Follow-up". */
export const STAGE_FOLLOW_UP = "Follow Up";

/**
 * The deal ended. Won, signed, or concluded.
 *
 * ‼️ IT NO LONGER MEANS "lost" AS WELL, AND THAT IS THE POINT OF SPLITTING IT. The old aliases
 * sent declined, dead, lost and unresponsive here, so a won client and a flat no sat in the same
 * bucket and the board could not show a close rate. Those now land on Not Interested.
 */
export const STAGE_CLOSED = "Closed";

/**
 * They said no, or the record is not worth working.
 *
 * Terminal, like Closed, but it is a different answer and the board shows them apart. It does NOT
 * set do_not_contact: somebody not interested this quarter is a normal thing to pitch again, and
 * the flag is a separate, explicit decision now. See the header.
 */
export const STAGE_NOT_INTERESTED = "Not Interested";

/**
 * Left to right, cold to done. The board renders in this order and so does every picker.
 *
 * ‼️ ORDER IS SEMANTIC HERE, NOT COSMETIC. The pipeline board reads it as the column order and
 * the lead profile reads it as the picker order, so reordering this array moves the board.
 */
export const AEO_PIPELINE: StagePipeline = {
  name: "Pipeline",
  stages: [
    { name: STAGE_NEW_LEAD, color: "#64748B", blurb: "Arrived, nobody has looked yet" },
    { name: STAGE_NO_CONTACT, color: "#0E8C77", blurb: "Looked at, not reached" },
    { name: STAGE_WORKING, color: "#9C27B0", blurb: "In conversation" },
    { name: STAGE_HOT, color: "#EF4444", blurb: "High intent, call today" },
    { name: STAGE_APPOINTMENT_BOOKED, color: "#2563EB", blurb: "Meeting in the calendar" },
    { name: STAGE_FOLLOW_UP, color: "#F5A623", blurb: "Needs chasing" },
    { name: STAGE_CLOSED, color: "#16A34A", blurb: "Won or concluded" },
    { name: STAGE_NOT_INTERESTED, color: "#C0392B", blurb: "Said no" },
  ],
} as const;

export const STAGE_PIPELINES: readonly StagePipeline[] = [AEO_PIPELINE];

/** All of them, flat. Filter chips, status pickers and the write allowlist. */
export const ALL_STAGES: readonly StageMeta[] = AEO_PIPELINE.stages;

export const STAGE_NAMES: readonly string[] = ALL_STAGES.map((s) => s.name);

const STAGE_BY_LOWER = new Map(ALL_STAGES.map((s) => [s.name.toLowerCase(), s]));

export function stageColor(stage: string | null | undefined): string {
  if (!stage) return "#9CA3AF";
  return STAGE_BY_LOWER.get(String(stage).trim().toLowerCase())?.color ?? "#9CA3AF";
}

export function stageMeta(stage: string | null | undefined): StageMeta | null {
  if (!stage) return null;
  return STAGE_BY_LOWER.get(String(stage).trim().toLowerCase()) ?? null;
}

// ── Normalization ────────────────────────────────────────────────────
// contacts.application_stage is free-form text with no CHECK constraint, and inbound webhooks,
// the medspa/TRT syncs and any hand-edited row can still hand us something else. Everything that
// accepts a stage from outside runs it through here, so a stray value can never put an extra
// column on the board.
//
// ‼️ THE FIVE RETIRED STAGES ARE ALIASES AND MUST STAY ALIASES FOR EVER. The migration rewrites
// every row that exists today, but a Slack button, a saved template, a queued automation and an
// in-flight webhook can all still name one tomorrow. An unaliased "Loom Sent" would fall through
// to the unknown-value default and quietly land somebody on No Contact.

const STAGE_ALIASES: Record<string, string> = {
  // ── The five retired on 2026-10-03 ──
  untouched: STAGE_NEW_LEAD,
  "email pitch": STAGE_WORKING,
  "loom sent": STAGE_FOLLOW_UP,
  "loom emailed": STAGE_FOLLOW_UP,
  "loom delivered": STAGE_FOLLOW_UP,
  "video sent": STAGE_FOLLOW_UP,
  "walkthrough sent": STAGE_FOLLOW_UP,
  "negotiating / follow-up": STAGE_FOLLOW_UP,
  negotiating: STAGE_FOLLOW_UP,
  "follow-up": STAGE_FOLLOW_UP,
  followup: STAGE_FOLLOW_UP,
  "take off list": STAGE_NOT_INTERESTED,

  // ── New arrivals, by the names people actually type ──
  "new lead": STAGE_NEW_LEAD,
  new: STAGE_NEW_LEAD,
  hot: STAGE_HOT,
  "hot lead": STAGE_HOT,
  "appointment booked": STAGE_APPOINTMENT_BOOKED,
  "appointment set": STAGE_APPOINTMENT_BOOKED,
  "meeting booked": STAGE_APPOINTMENT_BOOKED,
  booked: STAGE_APPOINTMENT_BOOKED,
  "demo booked": STAGE_APPOINTMENT_BOOKED,
  "call booked": STAGE_APPOINTMENT_BOOKED,

  // Reached them.
  "working - contacted": STAGE_WORKING,
  "working - application out": STAGE_WORKING,
  contacted: STAGE_WORKING,
  working: STAGE_WORKING,

  // ‼️ WON AND LOST PART COMPANY HERE, AND THEY USED TO NOT.
  // Everything that means "we got the business" stays on Closed; everything that means "they said
  // no" moves to Not Interested. Before this split both sets pointed at Closed, which is why the
  // book could not report a close rate.
  closed: STAGE_CLOSED,
  "closed - converted": STAGE_CLOSED,
  converted: STAGE_CLOSED,
  funded: STAGE_CLOSED,
  won: STAGE_CLOSED,
  "closed won": STAGE_CLOSED,
  signed: STAGE_CLOSED,

  "not interested": STAGE_NOT_INTERESTED,
  "closed - not converted": STAGE_NOT_INTERESTED,
  "closed lost": STAGE_NOT_INTERESTED,
  "dead declined": STAGE_NOT_INTERESTED,
  "deal lost": STAGE_NOT_INTERESTED,
  declined: STAGE_NOT_INTERESTED,
  unresponsive: STAGE_NOT_INTERESTED,
  lost: STAGE_NOT_INTERESTED,
  "lost lead": STAGE_NOT_INTERESTED,
  "do not call": STAGE_NOT_INTERESTED,
  "do-not-call": STAGE_NOT_INTERESTED,
  dnc: STAGE_NOT_INTERESTED,
  "remove from list": STAGE_NOT_INTERESTED,
  "opted out": STAGE_NOT_INTERESTED,
  "bad lead": STAGE_NOT_INTERESTED,
  "junk lead": STAGE_NOT_INTERESTED,
  "wrong number": STAGE_NOT_INTERESTED,
  "bad number": STAGE_NOT_INTERESTED,
  "out of business": STAGE_NOT_INTERESTED,
  duplicate: STAGE_NOT_INTERESTED,
  dnq: STAGE_NOT_INTERESTED,
};

/**
 * Substring fallback for the values Zoho stored off-picklist. "Not interested" was live on 29 of a
 * 2,400-lead sample against a list that said "Not Interested", so exact matching alone silently
 * left dead leads workable.
 *
 * ‼️ ONE LIST NOW, NOT TWO. There used to be a TAKE_OFF list checked before this one, because
 * "Junk Lead - Dead" had to be junk first and dead second. Both destinations are Not Interested
 * now, so the ordering problem is gone with the stage.
 */
const NOT_INTERESTED_KEYWORDS = [
  "declined", "dead", "lost", "not interested", "dnq", "junk", "duplicate",
  "do not call", "do-not-call", "opted out", "wrong number", "bad number",
  "out of business", "take off",
];

/**
 * Any stage string -> one of the eight.
 *
 * Null or blank means nobody ever set one, which is New Lead. An unrecognized NON-blank value is
 * different: somebody wrote something, we just do not know what it meant, so it falls to No
 * Contact rather than being called new. Neither default hides the lead: both stay on the call
 * board.
 */
export function normalizeStage(stage: string | null | undefined): string {
  if (!stage) return STAGE_NEW_LEAD;
  const lower = String(stage).trim().toLowerCase();
  if (!lower) return STAGE_NEW_LEAD;
  if (STAGE_BY_LOWER.has(lower)) return STAGE_BY_LOWER.get(lower)!.name;
  if (STAGE_ALIASES[lower]) return STAGE_ALIASES[lower];
  if (NOT_INTERESTED_KEYWORDS.some((k) => lower.includes(k))) return STAGE_NOT_INTERESTED;
  return STAGE_NO_CONTACT;
}

// ── Terminal vs pre-contact ──────────────────────────────────────────

/** The deal is over, one way or the other. Nothing to work. */
export const TERMINAL_STAGES: readonly string[] = [STAGE_CLOSED, STAGE_NOT_INTERESTED];

const TERMINAL_LOWER = new Set(TERMINAL_STAGES.map((s) => s.toLowerCase()));

export function isTerminalStage(stage: string | null | undefined): boolean {
  if (!stage) return false;
  return TERMINAL_LOWER.has(normalizeStage(stage).toLowerCase());
}

/**
 * Pre-contact rather than closed.
 *
 * ‼️ BOTH ENTRIES MUST STAY. isDeadStage() gates the worklist's hard drop in
 * src/lib/worklist.ts, and the overwhelming majority of the book sits at one of these two. If
 * this list loses either entry the call board goes empty and it looks like data loss rather than
 * a config bug.
 */
export const PRE_CONTACT_STAGES: readonly string[] = [STAGE_NEW_LEAD, STAGE_NO_CONTACT];

const PRE_CONTACT_LOWER = new Set(PRE_CONTACT_STAGES.map((s) => s.toLowerCase()));

/** Stop working this. The opposite of "there is nothing to work yet". */
export function isDeadStage(stage: string | null | undefined): boolean {
  if (!stage) return false;
  if (PRE_CONTACT_LOWER.has(String(stage).trim().toLowerCase())) return false;
  return isTerminalStage(stage);
}

// ── Follow-up cadence ────────────────────────────────────────────────
// How long a lead in each stage may sit untouched before the worklist surfaces it.
// firstTouchHours applies when there has been no activity at all; repeatDays applies after the
// first touch. src/lib/worklist.ts uses this alongside isDeadStage().

export interface StageCadence {
  firstTouchHours: number;
  repeatDays: number;
}

export const STAGE_CADENCE: Record<string, StageCadence> = {
  // Bulk-imported and never looked at. Workable, but it should not outrank a lead someone
  // deliberately marked as not yet contacted, so the repeat is slower.
  [STAGE_NEW_LEAD]: { firstTouchHours: 24, repeatDays: 7 },
  // Speed to lead: a brand-new lead is worth 15 minutes, not a day.
  [STAGE_NO_CONTACT]: { firstTouchHours: 0.25, repeatDays: 1 },
  [STAGE_WORKING]: { firstTouchHours: 24, repeatDays: 3 },
  // ‼️ THE FASTEST ON THE BOARD, BECAUSE SOMEBODY PUT THEM HERE BY HAND. Nothing lands a lead on
  // Hot automatically; a person who just spoke to them did. Four hours is roughly "later the same
  // day", which is what that person meant by moving the card.
  [STAGE_HOT]: { firstTouchHours: 4, repeatDays: 1 },
  // There is a meeting. The chase is about keeping it, not about making it.
  [STAGE_APPOINTMENT_BOOKED]: { firstTouchHours: 24, repeatDays: 2 },
  // Live conversation. A missed day here is what costs the yes.
  [STAGE_FOLLOW_UP]: { firstTouchHours: 24, repeatDays: 2 },
};

export const DEFAULT_CADENCE: StageCadence = { firstTouchHours: 24, repeatDays: 5 };

const CADENCE_LOWER = new Map(
  Object.entries(STAGE_CADENCE).map(([k, v]) => [k.toLowerCase(), v])
);

export function cadenceFor(stage: string | null | undefined): StageCadence {
  if (!stage) return STAGE_CADENCE[STAGE_NO_CONTACT];
  return (
    CADENCE_LOWER.get(String(stage).trim().toLowerCase()) ??
    CADENCE_LOWER.get(normalizeStage(stage).toLowerCase()) ??
    DEFAULT_CADENCE
  );
}

/** Where a missed day actually costs the deal. Scores +25 on the call board. */
export const HOT_STAGES: readonly string[] = [
  STAGE_HOT,
  STAGE_APPOINTMENT_BOOKED,
  STAGE_FOLLOW_UP,
];
