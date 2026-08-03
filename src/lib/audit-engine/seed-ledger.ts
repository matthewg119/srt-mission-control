// Which belief this thread has already installed, and which one comes next.
//
// The rule from SRT_Belief_Seeding_Module.md that this file exists to enforce: a belief already
// installed is NEVER installed again. Repeating a seed is what turns a sequence into nagging —
// the prospect has already accepted the premise, so restating it reads as though we were not
// listening. The one exception is an objection, which is evidence that a link in the chain
// broke; there the diagnostic table picks the broken belief deliberately, even if it was seeded
// before.
//
// WHY THE DB AND NOT THE SLACK THREAD: the module describes the ledger as a scan of prior SEED
// LOG blocks in the thread. Reading it back out of Slack means re-parsing text we formatted
// ourselves, and a thread whose messages were edited or deleted would silently lose entries. The
// row is the source of truth; the SEED LOG block posted to Slack is a human-readable mirror of
// it, which is also what makes the log safe to reformat later without changing behavior.

import { supabaseAdmin } from "@/lib/db";
import {
  BELIEF_SEEDS,
  preSellBeliefsFor,
  type BeliefId,
  type BeliefSeed,
  type PreSellOption,
} from "./email-assistant";
import {
  B4_GBP_RATING_MIN,
  B4_GBP_REVIEWS_MIN,
  RANKING_BRAG_PATTERNS,
} from "@/config/pitch";
import type { AuditReportRow } from "./types";

/** Which draft installed a seed. Mirrors the module's "Email:" field. */
export type SeedStage =
  | "draft 1"
  | "nudge"
  | "reveal"
  | "delivery"
  | "price"
  | "objection";

export interface InstalledSeed {
  belief: BeliefId;
  stage: SeedStage;
  /** The exact line that went in, quoted verbatim in the SEED LOG. */
  line: string;
  /** ISO timestamp. Stamped here rather than by the DB so the log can print it without a re-read. */
  at: string;
}

export interface SeedLedger {
  installed: InstalledSeed[];
  /** The three options last offered under a draft, so `seed N` knows what N refers to. */
  offered: PreSellOption[];
}

const EMPTY: SeedLedger = { installed: [], offered: [] };

/** Tolerant of null and of any older shape, so a row written before this column existed reads clean. */
export function readLedger(report: Pick<AuditReportRow, "seed_ledger">): SeedLedger {
  const raw = report.seed_ledger as Partial<SeedLedger> | null | undefined;
  if (!raw || typeof raw !== "object") return { ...EMPTY };
  return {
    installed: Array.isArray(raw.installed) ? raw.installed : [],
    offered: Array.isArray(raw.offered) ? raw.offered : [],
  };
}

export function installedBeliefs(ledger: SeedLedger): BeliefId[] {
  return ledger.installed.map((s) => s.belief);
}

/**
 * The belief a cold draft should open with.
 *
 * B1 (behavior) by default. B4 ("different game, different winners") when their Google presence
 * is genuinely strong, because leading with absence to someone proud of a 4.9 and 2,000 reviews
 * reads as an insult they can immediately disprove — B4 concedes the strength first and then
 * says it does not carry over, which is both true and much harder to argue with.
 *
 * Falls through to the next un-installed belief once the obvious one is spent.
 */
export function selectBelief(
  report: Pick<AuditReportRow, "gbp_rating" | "gbp_reviews" | "intake_answers">,
  ledger: SeedLedger
): BeliefSeed {
  const used = new Set(installedBeliefs(ledger));
  const strongProfile =
    typeof report.gbp_rating === "number" &&
    typeof report.gbp_reviews === "number" &&
    report.gbp_rating >= B4_GBP_RATING_MIN &&
    report.gbp_reviews >= B4_GBP_REVIEWS_MIN;
  const braggedOnCall =
    !!report.intake_answers && RANKING_BRAG_PATTERNS.some((re) => re.test(report.intake_answers!));

  const preferred: BeliefId = strongProfile || braggedOnCall ? "B4" : "B1";
  if (!used.has(preferred)) return BELIEF_SEEDS.find((b) => b.id === preferred)!;

  // Preferred one is spent. preSellBeliefsFor already knows the house order and skips what is
  // used, so reuse it rather than keeping a second copy of that ordering here.
  return preSellBeliefsFor([...used])[0];
}

/** Persist the three options a draft was posted with, so `seed N` can resolve N later. */
export async function saveOffered(reportId: string, ledger: SeedLedger, offered: PreSellOption[]): Promise<SeedLedger> {
  const next: SeedLedger = { ...ledger, offered };
  await supabaseAdmin.from("audit_reports").update({ seed_ledger: next }).eq("id", reportId);
  return next;
}

export interface InstallResult {
  ledger: SeedLedger;
  chosen: PreSellOption;
}

/**
 * Record that one of the offered lines went into the draft.
 *
 * Returns null when `pick` is out of range, which happens if the card scrolled out of the thread
 * or the report was re-drafted since — the caller says so rather than installing the wrong seed.
 */
export async function installSeed(
  report: Pick<AuditReportRow, "id" | "seed_ledger">,
  pick: number,
  stage: SeedStage
): Promise<InstallResult | null> {
  const ledger = readLedger(report);
  const chosen = ledger.offered[pick - 1];
  if (!chosen) return null;

  const entry: InstalledSeed = {
    belief: chosen.belief,
    stage,
    line: chosen.line,
    at: new Date().toISOString(),
  };
  // Re-installing the same belief is a no-op on the ledger rather than a duplicate row, so the
  // "already installed" list stays a set and the linter's rule 7 cannot be defeated by pressing
  // the same button twice.
  const installed = ledger.installed.some((s) => s.belief === chosen.belief)
    ? ledger.installed
    : [...ledger.installed, entry];

  const next: SeedLedger = { installed, offered: ledger.offered };
  await supabaseAdmin.from("audit_reports").update({ seed_ledger: next }).eq("id", report.id);
  return { ledger: next, chosen };
}

function countSentences(s: string): number {
  const m = s.trim().match(/[.!?]+(?=\s|$)/g);
  return m ? m.length : s.trim() ? 1 : 0;
}

/**
 * The SEED LOG block. INTERNAL — posted to Slack as its own message, never inside the
 * copy-paste block, because it is a note to Matthew and not part of the email.
 *
 * Field-for-field the module's contract (Email / Creencia instalada / Lineas anadidas / Frases
 * nuevas vs. control / Creencias ya instaladas / Siguiente disponible), with English labels to
 * match the rest of the Slack surface.
 */
export function formatSeedLog(entry: InstalledSeed, ledger: SeedLedger): string {
  const installed = installedBeliefs(ledger);
  const nextUp = preSellBeliefsFor(installed)[0];
  return [
    ":ledger: *SEED LOG* · internal, not part of the email",
    `Draft: ${entry.stage}`,
    `Belief installed: *${entry.belief}*`,
    `Line added: "${entry.line}"`,
    `New sentences vs control: ${countSentences(entry.line)}`,
    `Already installed in this thread: ${installed.length ? installed.join(", ") : "none"}`,
    `Next available: ${nextUp ? nextUp.id : "none left"}`,
  ].join("\n");
}
