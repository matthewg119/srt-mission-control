// The five stages, and the only place they are defined.
//
// This file used to be presentation metadata for Zoho's MCA picklist, which is
// why the old version carried two pipelines and eighteen stages. SRT is off
// business funding, so the funding vocabulary (Underwriting, Shopping,
// Pre-Approved, VC / DL, Contracts Out, Pending Stips, Funding Call, In
// Funding) is gone and the stage column is owned here now, not by Zoho.
//
// Anything that renders, filters, validates or cadences a stage imports from
// this file. The old copies scattered across the codebase are what let
// template-editor.tsx drift into offering "Contract In" and "Funded" as stages
// that no lead could ever be in.

export interface StageMeta {
  name: string;
  color: string;
}

export interface StagePipeline {
  name: string;
  stages: readonly StageMeta[];
}

/**
 * Never had a stage on it. Not the same thing as "No contact".
 *
 * "No contact" is a decision: somebody looked at this lead and said we have not
 * reached them yet. "Untouched" is the absence of one, and after the Zoho import
 * there are a lot of them: rows the scrapers, funnels and bulk loads created
 * without ever writing application_stage. Lumping them into No contact would
 * bury real uncontacted leads under imported noise on the same call board.
 */
export const STAGE_UNTOUCHED = "Untouched";
export const STAGE_NO_CONTACT = "No contact";
export const STAGE_WORKING = "Working";
export const STAGE_EMAIL_PITCH = "Email Pitch";
export const STAGE_NEGOTIATING = "Negotiating / Follow-up";
export const STAGE_CLOSED = "Closed";

export const AEO_PIPELINE: StagePipeline = {
  name: "Pipeline",
  stages: [
    { name: STAGE_UNTOUCHED, color: "#64748B" },
    { name: STAGE_NO_CONTACT, color: "#1B65A7" },
    { name: STAGE_WORKING, color: "#9C27B0" },
    { name: STAGE_EMAIL_PITCH, color: "#00BCD4" },
    { name: STAGE_NEGOTIATING, color: "#F5A623" },
    { name: STAGE_CLOSED, color: "#6B7280" },
  ],
} as const;

export const STAGE_PIPELINES: readonly StagePipeline[] = [AEO_PIPELINE];

/** The five, flat. Filter chips, status pickers and the write allowlist. */
export const ALL_STAGES: readonly StageMeta[] = AEO_PIPELINE.stages;

export const STAGE_NAMES: readonly string[] = ALL_STAGES.map((s) => s.name);

const STAGE_BY_LOWER = new Map(ALL_STAGES.map((s) => [s.name.toLowerCase(), s]));

export function stageColor(stage: string | null | undefined): string {
  if (!stage) return "#9CA3AF";
  return STAGE_BY_LOWER.get(String(stage).trim().toLowerCase())?.color ?? "#9CA3AF";
}

// ── Normalization ────────────────────────────────────────────────────
// The migration collapsed contacts.application_stage to these five, but the
// column is free-form text with no CHECK constraint, and inbound webhooks,
// the medspa/TRT syncs and any hand-edited row can still hand us something
// else. Everything that accepts a stage from outside runs it through here, so
// a stray value can never put a sixth chip on the leads page.

/** Legacy value -> new stage. Mirrors the SQL migration exactly; if you change
 *  one, change the other. Keys are lowercase. */
const STAGE_ALIASES: Record<string, string> = {
  // Reached them.
  "working - contacted": STAGE_WORKING,
  "working - application out": STAGE_WORKING,
  contacted: STAGE_WORKING,
  working: STAGE_WORKING,

  // Done with, one way or the other. Won business closes too: there is no
  // funding deal left to work, and the AEO pitch starts from scratch.
  closed: STAGE_CLOSED,
  "closed - not converted": STAGE_CLOSED,
  "closed - converted": STAGE_CLOSED,
  converted: STAGE_CLOSED,
  funded: STAGE_CLOSED,
  "dead declined": STAGE_CLOSED,
  "deal lost": STAGE_CLOSED,
  declined: STAGE_CLOSED,
  "not interested": STAGE_CLOSED,
  unresponsive: STAGE_CLOSED,
  lost: STAGE_CLOSED,
  "bad lead": STAGE_CLOSED,
  "wrong number": STAGE_CLOSED,
  duplicate: STAGE_CLOSED,
  "junk lead": STAGE_CLOSED,
  "lost lead": STAGE_CLOSED,
  "take off list": STAGE_CLOSED,
};

/** Substring fallback for the values Zoho stored off-picklist. "Not interested"
 *  was live on 29 of a 2,400-lead sample against a list that said "Not
 *  Interested", so exact matching alone silently left dead leads workable. */
const CLOSED_KEYWORDS = [
  "declined", "dead", "dnq", "lost", "junk", "duplicate", "not interested",
];

/**
 * Any stage string -> one of the six.
 *
 * Null or blank means nobody ever set one, which is "Untouched". An unrecognized
 * NON-blank value is different: somebody wrote something, we just do not know
 * what it meant, so it falls to "No contact" rather than being called untouched.
 * Neither default hides the lead: both stay on the call board.
 */
export function normalizeStage(stage: string | null | undefined): string {
  if (!stage) return STAGE_UNTOUCHED;
  const lower = String(stage).trim().toLowerCase();
  if (!lower) return STAGE_UNTOUCHED;
  if (STAGE_BY_LOWER.has(lower)) return STAGE_BY_LOWER.get(lower)!.name;
  if (STAGE_ALIASES[lower]) return STAGE_ALIASES[lower];
  if (CLOSED_KEYWORDS.some((k) => lower.includes(k))) return STAGE_CLOSED;
  return STAGE_NO_CONTACT;
}

// ── Terminal vs pre-contact ──────────────────────────────────────────

/** Genuinely done. Never call these. */
export const TERMINAL_STAGES: readonly string[] = [STAGE_CLOSED];

export function isTerminalStage(stage: string | null | undefined): boolean {
  if (!stage) return false;
  return normalizeStage(stage) === STAGE_CLOSED;
}

/**
 * Pre-contact rather than closed.
 *
 * "No contact" and "Untouched" MUST both be here. isDeadStage() gates the
 * worklist's hard drop in src/lib/worklist.ts, and after the migration the
 * overwhelming majority of the book sits at one of these two. If this list
 * loses either entry, the call board goes empty and it looks like data loss
 * rather than a config bug.
 */
export const PRE_CONTACT_STAGES: readonly string[] = [STAGE_UNTOUCHED, STAGE_NO_CONTACT];

const PRE_CONTACT_LOWER = new Set(PRE_CONTACT_STAGES.map((s) => s.toLowerCase()));

/** Stop working this. The opposite of "there is nothing to work yet". */
export function isDeadStage(stage: string | null | undefined): boolean {
  if (!stage) return false;
  if (PRE_CONTACT_LOWER.has(String(stage).trim().toLowerCase())) return false;
  return isTerminalStage(stage);
}

// ── Follow-up cadence ────────────────────────────────────────────────
// How long a lead in each stage may sit untouched before the worklist surfaces
// it. firstTouchHours applies when there has been no activity at all;
// repeatDays applies after the first touch. src/lib/worklist.ts uses this
// alongside isDeadStage(), which is why they live together.

export interface StageCadence {
  firstTouchHours: number;
  repeatDays: number;
}

export const STAGE_CADENCE: Record<string, StageCadence> = {
  // Bulk-imported and never looked at. Workable, but it should not outrank a
  // lead someone deliberately marked as not yet contacted, so the repeat is
  // slower. The worklist's age tie-breakers do the rest of the sorting.
  [STAGE_UNTOUCHED]: { firstTouchHours: 24, repeatDays: 7 },
  // Speed to lead: a brand-new lead is worth 15 minutes, not a day.
  [STAGE_NO_CONTACT]: { firstTouchHours: 0.25, repeatDays: 1 },
  [STAGE_WORKING]: { firstTouchHours: 24, repeatDays: 3 },
  // A pitch email needs time to be read before the nudge is anything but noise.
  [STAGE_EMAIL_PITCH]: { firstTouchHours: 48, repeatDays: 3 },
  // Live conversation. A missed day here is what costs the yes.
  [STAGE_NEGOTIATING]: { firstTouchHours: 24, repeatDays: 2 },
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
export const HOT_STAGES: readonly string[] = [STAGE_NEGOTIATING];
