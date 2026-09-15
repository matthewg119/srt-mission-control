// The one thing this client sells that we are aiming everything at.
//
// ‼️ THERE WAS NO OFFER, AND THE FIELD THAT WAS SUPPOSED TO BE ONE HAD ALMOST NO READER.
//
// `clients` has no offer column, no primary_offer, no target_keywords. The closest thing is
// `services.primary_treatment`, whose own config comment (src/config/client-intake.ts:124-131)
// says:
//
//   "THIS IS THE ONE FIELD THE WHOLE BUILD IS AIMED AT, AND IT DID NOT EXIST UNTIL NOW ... It is
//    deliberately NOT the same question as step 3's highest margin: the most profitable service
//    and the one an owner wants more of are often different, and the pages, the posts and the
//    lead magnet all follow this one."
//
// And the substitution chain did not read it. `treatmentPrimary` in question-sets.ts resolved
// `ideal_patient.highest_margin || firstLine(services.services_list) || services.primary_service`,
// and `primary_treatment` appears at no position in that list. Only deep-research-run.ts read it.
// So the one required intake field the whole build is aimed at reached the research prompt and
// reached nothing else: not step 12's question set, not step 13's page candidates, not the
// `[treatment]` substitution, not the magnet ladder.
//
// That is the same reader-with-no-writer class this repo keeps finding, inverted. It is why step
// 12's PDF reads as padding: the corpus is a whole-vertical phrase harvest with nothing tying it
// to what this client actually sells, so filling sixty slots pads it with junk.
//
// ─────────────────────────────────────────────────────────────────────────────
// TWO STEPS, AND THEY ARE DIFFERENT KINDS OF ACT
//
// Matthew: "I want to pick it live with my customer in the call but select one simple offer from
// one of our options, and if not I need to create one and upload it in Slack to have the first
// sample, but always need to have one preselected, and in the live call we can get the inputs to
// put together the keyword and positioning strategy."
//
//   offer_proposed  the system PROPOSES one, from what intake already said. Automatic, so there
//                   is always one preselected and it never blocks the board.
//   offer_locked    a person LOCKS one, having heard the answer. Manual. Since 2026-09-11 that
//                   happens on the PREP CALL before the onboarding call, not on the call itself,
//                   and the same call captures the words their customers use for it (`terms:`).
//
// Same split as every proposed_* slot in this repo, and the same reason: a proposal is a
// reading of the record and a lock is a decision somebody made out loud.
//
// ‼️ THE PROPOSAL MAKES NO MODEL CALL. It does not need one. `primary_treatment` is REQUIRED at
// intake and it is literally the answer to "which one service do you most want more appointments
// for". A model asked to infer the same thing from an audit would produce a guess with no
// provenance, next to a field that already carries the client's own words. Every proposal
// therefore carries WHERE it came from, and "nothing on file" is a legitimate outcome that says
// so rather than inventing an answer.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "@/lib/db";
import { hasBannedDash } from "@/lib/copy-guard";
import { normalizePhrase } from "./phrase-quality";

/** Where a proposed treatment came from. Never absent: a value with no provenance is a guess. */
export type OfferSource =
  /** services.primary_treatment, the intake question aimed at exactly this. */
  | "primary_treatment"
  /** ideal_patient.highest_margin. A different question, and often a different answer. */
  | "highest_margin"
  /** The first line of services_list, which is a menu we are taking the top of. */
  | "services_list"
  /** A person typed it on the call. Only ever on the locked half. */
  | "call";

export interface StoredOffer {
  // ── The proposal. Written by the runner, overwritten freely, never shown as decided. ──
  proposedTreatment: string | null;
  proposedSource: OfferSource | null;
  proposedAt: string | null;

  // ── The lock. Written by a person, on the call. ──
  /** What they sell that everything is aimed at. Feeds [treatment] and client_pages.treatment. */
  treatment: string | null;
  /** The free thing given away for it: a lead_magnets.magnet_key. Optional; a treatment alone
   *  is a usable lock, and the magnet can be drafted afterwards in the page studio. */
  magnetKey: string | null;
  /** How they want it positioned, in their words, captured on the call. */
  positioning: string | null;
  lockedAt: string | null;
  lockedBy: string | null;

  /**
   * The words their CUSTOMERS use for it, captured on the prep call: `terms: lip flip, lip
   * filler, lip injections`.
   *
   * ‼️ THIS IS WHAT MAKES KEYWORD RELEVANCE REAL. The treatment is how the business names it
   * ("AEO Services for med spas") and almost no phrase a buyer types contains that string, so a
   * test built on the treatment alone aimed nothing at the offer. The terms, plus the keyword
   * step's naming variants, are the offer vocabulary isAboutOffer() reads.
   */
  terms: string[];
  termsAt: string | null;

  /**
   * The outcome promised ("more appointments", "more jobs"), `outcome:` on the prep call.
   *
   * ‼️ ON THE OFFER, NOT THE AUDIENCE (Matthew, 2026-09-15): one audience can be sold two offers with
   * two outcomes. Declared missing in dataset-spec.ts from the day it was written.
   */
  outcomePromise: string | null;
  outcomeSetAt: string | null;
  /** The price as the client states it ("$399 per session"), `price:` on the prep call. */
  price: string | null;
  priceSetAt: string | null;

  /**
   * The risk reversal as the client will actually honour it, `guarantee:` on the prep call or at step 21.
   *
   * ‼️ THE LADDER MAY ONLY PROMISE WHAT THIS SAYS (2026-09-16). offer-ladder.ts refuses a rung whose claim
   * or risk reversal guarantees anything while this is empty: a guarantee a model invented is a promise
   * the client never made, printed on pages under their name.
   */
  guarantee: string | null;
  guaranteeSetAt: string | null;
  /** The awareness stage (5 unaware to 1 most aware) whose rung was picked as the anchor at step 21. */
  anchorStage: 1 | 2 | 3 | 4 | 5 | null;

  // ── Where it lives. Null on an offer read from the deprecated clients.offer mirror. ──
  /** client_offers.id. */
  id: string | null;
  /** The audience this offer is sold to. loadOffer returns the PRIMARY audience's primary offer. */
  audienceId: string | null;
}

/** More than this is a list of everything they do, which is the menu the lock exists to avoid. */
export const TERMS_MAX = 30;

export const EMPTY_OFFER: StoredOffer = {
  proposedTreatment: null,
  proposedSource: null,
  proposedAt: null,
  treatment: null,
  magnetKey: null,
  positioning: null,
  lockedAt: null,
  lockedBy: null,
  terms: [],
  termsAt: null,
  outcomePromise: null,
  outcomeSetAt: null,
  price: null,
  priceSetAt: null,
  guarantee: null,
  guaranteeSetAt: null,
  anchorStage: null,
  id: null,
  audienceId: null,
};

const SOURCES: readonly OfferSource[] = [
  "primary_treatment",
  "highest_margin",
  "services_list",
  "call",
];

/**
 * Placeholder answers people give a required field they do not want to answer.
 *
 * ‼️ MEASURED, AND SRT'S OWN ROW IS THE CASE. `ideal_patient.highest_margin` on SRT Agency is
 * literally the string "any". Proposing "any" as the offer would put it into [treatment], so
 * every tracked question, every page candidate and every magnet query would be aimed at a word
 * that means the opposite of one service.
 *
 * Exactly the same shape as the competitor box containing "a", which usableCompetitorName() in
 * question-sets.ts was written to catch, and which isExcludedFromShortlist handles for
 * aggregators. A required field does not make an answer.
 *
 * ‼️ IT REFUSES RATHER THAN GUESSING PAST IT. The chain falls through to the next source, and
 * when every source is a placeholder the proposal is EMPTY and says so, which is a state the
 * board can act on. Silently proposing "any" is a state nobody would ever notice.
 */
const PLACEHOLDERS = new Set([
  "any",
  "all",
  "all of them",
  "everything",
  "various",
  "many",
  "n/a",
  "na",
  "none",
  "no",
  "yes",
  "tbd",
  "unsure",
  "not sure",
  "dont know",
  "don't know",
  "other",
  "misc",
  "general",
  "services",
  "everything we do",
  "the whole menu",
]);

/**
 * A service name somebody could aim a page at, or null.
 *
 * Mechanical, like usableCompetitorName: at least three characters, at least two letters
 * together, and not one of the placeholders above. It does NOT check the words are a real
 * treatment, because a vocabulary would refuse a real business's real service for not being on
 * a list somebody wrote in advance.
 */
export function usableTreatment(raw: unknown): string | null {
  const value = text(raw);
  if (!value) return null;
  if (value.length < 3) return null;
  if (!/[A-Za-z]{2,}/.test(value)) return null;
  if (PLACEHOLDERS.has(value.toLowerCase().replace(/[.!?]+$/, ""))) return null;
  return value;
}

function text(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value === "" ? null : value;
}

/**
 * The stored bag, validated.
 *
 * Drop-never-repair, the same discipline readTheme() and readSkin() follow: a field that is not
 * the shape it should be becomes null rather than being coerced into something plausible.
 */
export function readOffer(raw: unknown): StoredOffer {
  if (!raw || typeof raw !== "object") return { ...EMPTY_OFFER };
  const bag = raw as Record<string, unknown>;
  const source = text(bag.proposedSource);

  return {
    proposedTreatment: text(bag.proposedTreatment),
    proposedSource: source && SOURCES.includes(source as OfferSource) ? (source as OfferSource) : null,
    proposedAt: text(bag.proposedAt),
    treatment: text(bag.treatment),
    magnetKey: text(bag.magnetKey),
    positioning: text(bag.positioning),
    lockedAt: text(bag.lockedAt),
    lockedBy: text(bag.lockedBy),
    terms: readTerms(bag.terms),
    termsAt: text(bag.termsAt),
    outcomePromise: text(bag.outcomePromise),
    outcomeSetAt: text(bag.outcomeSetAt),
    price: text(bag.price),
    priceSetAt: text(bag.priceSetAt),
    guarantee: text(bag.guarantee),
    guaranteeSetAt: text(bag.guaranteeSetAt),
    anchorStage: stageOrNull(bag.anchorStage),
    id: null,
    audienceId: null,
  };
}

function stageOrNull(v: unknown): 1 | 2 | 3 | 4 | 5 | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? (n as 1 | 2 | 3 | 4 | 5) : null;
}

/** A client_offers row as a StoredOffer. Same drop-never-repair discipline as readOffer. */
function offerFromRow(row: Record<string, unknown>): StoredOffer {
  const source = text(row.proposed_source);
  return {
    proposedTreatment: text(row.proposed_treatment),
    proposedSource: source && SOURCES.includes(source as OfferSource) ? (source as OfferSource) : null,
    proposedAt: text(row.proposed_at),
    treatment: text(row.treatment),
    magnetKey: text(row.magnet_key),
    positioning: text(row.positioning),
    lockedAt: text(row.locked_at),
    lockedBy: text(row.locked_by),
    terms: readTerms(row.terms),
    termsAt: text(row.terms_at),
    outcomePromise: text(row.outcome_promise),
    outcomeSetAt: text(row.outcome_set_at),
    price: text(row.price),
    priceSetAt: text(row.price_set_at),
    guarantee: text(row.guarantee),
    guaranteeSetAt: text(row.guarantee_set_at),
    anchorStage: stageOrNull(row.anchor_stage),
    id: text(row.id),
    audienceId: text(row.audience_id),
  };
}

/** The columns a StoredOffer writes. id and audience_id are never rewritten by an update. */
function rowFromOffer(offer: StoredOffer): Record<string, unknown> {
  return {
    proposed_treatment: offer.proposedTreatment,
    proposed_source: offer.proposedSource,
    proposed_at: offer.proposedAt,
    treatment: offer.treatment,
    magnet_key: offer.magnetKey,
    positioning: offer.positioning,
    locked_at: offer.lockedAt,
    locked_by: offer.lockedBy,
    terms: offer.terms,
    terms_at: offer.termsAt,
    outcome_promise: offer.outcomePromise,
    outcome_set_at: offer.outcomeSetAt,
    price: offer.price,
    price_set_at: offer.priceSetAt,
    guarantee: offer.guarantee,
    guarantee_set_at: offer.guaranteeSetAt,
    anchor_stage: offer.anchorStage,
    updated_at: new Date().toISOString(),
  };
}

/** The jsonb shape of the deprecated clients.offer mirror. Where it lives is not part of it. */
function bagFromOffer(offer: StoredOffer): Record<string, unknown> {
  const { id: _id, audienceId: _audienceId, ...bag } = offer;
  return bag;
}

/** Stored terms, validated. An offer written before terms existed reads as an empty list. */
export function readTerms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => text(t))
    .filter((t): t is string => t !== null)
    .slice(0, TERMS_MAX);
}

/**
 * `terms: lip flip, lip filler, lip injections`, parsed.
 *
 * Commas, pipes, semicolons or new lines separate them, because a person dictating a list uses
 * whichever comes out. Each is 2 to 60 characters, carries no dash (copy-guard), and duplicates on
 * the normal form collapse to the first spelling given. Pure, so the probe proves it.
 */
export function parseTerms(raw: string): { ok: true; terms: string[] } | { ok: false; error: string } {
  const parts = raw
    .split(/[,|;\n]+/)
    .map((p) => p.trim().replace(/^["'“”‘’]+|["'“”‘’.]+$/g, "").trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { ok: false, error: "there are no terms in that. `terms: lip flip, lip filler, lip injections`" };
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (p.length < 2 || p.length > 60) {
      return { ok: false, error: `"${p}" is not a term somebody says. Keep each one between 2 and 60 characters.` };
    }
    if (hasBannedDash(p)) return { ok: false, error: `"${p}" has a dash in it. Use a space.` };
    const key = normalizePhrase(p);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }

  if (out.length > TERMS_MAX) {
    return {
      ok: false,
      error: `that is ${out.length} terms. Keep it to the ${TERMS_MAX} or fewer their customers actually say.`,
    };
  }
  return { ok: true, terms: out };
}

/** Locked, in the only sense anything downstream cares about: a person named the thing. */
export function isLocked(offer: StoredOffer): boolean {
  return offer.treatment !== null && offer.lockedAt !== null;
}

/**
 * What the client is actually aimed at right now, and how sure we are.
 *
 * ‼️ THE LOCKED VALUE OUTRANKS THE PROPOSAL AND THE PROPOSAL OUTRANKS NOTHING. A proposal is a
 * reading of the intake form; it is offered so that the call has a starting point, and it must
 * never be interpolated into a client-facing sentence as though somebody had agreed to it.
 * Callers that need certainty check isLocked(); callers that just need a word for a card can
 * read `effective` and print `certain` beside it.
 */
export function effectiveTreatment(offer: StoredOffer): {
  value: string | null;
  certain: boolean;
  source: OfferSource | null;
} {
  if (isLocked(offer)) {
    return { value: offer.treatment, certain: true, source: "call" };
  }
  return { value: offer.proposedTreatment, certain: false, source: offer.proposedSource };
}

/** One sentence for a card or a panel. Says what IS, including when that is nothing. */
export function offerLine(offer: StoredOffer): string {
  if (isLocked(offer)) {
    const magnet = offer.magnetKey ? `, offered with \`${offer.magnetKey}\`` : "";
    return `Locked on *${offer.treatment}*${magnet}, by ${offer.lockedBy ?? "somebody"}.`;
  }
  if (offer.proposedTreatment) {
    return (
      `Proposed: *${offer.proposedTreatment}* (${describeSource(offer.proposedSource)}). ` +
      `Nobody has confirmed it, so nothing downstream treats it as decided.`
    );
  }
  return "No offer proposed and none locked. Everything downstream is aimed at the whole menu.";
}

function describeSource(source: OfferSource | null): string {
  switch (source) {
    case "primary_treatment":
      return "their own answer to which service they want more appointments for";
    case "highest_margin":
      return "their highest margin service, which is a different question";
    case "services_list":
      return "the first line of their services list, which is a menu we took the top of";
    case "call":
      return "the call";
    default:
      return "no recorded source";
  }
}

/** The first line of a free-text block. Same shape question-sets.ts uses on services_list. */
function firstLine(raw: unknown): string | null {
  const value = text(raw);
  if (!value) return null;
  return text(value.split(/[\n;]/)[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Where the offer lives
//
// ‼️ client_offers, UNDER THE CLIENT'S PRIMARY AUDIENCE, SINCE 2026-09-15. docs/2026-09-15-offers-and-
// framework.sql answers the three reasons docs/2026-09-08-client-offer.sql gave for one jsonb column.
// The one that still binds everything here: loadOffer returns ONE offer, so [treatment] stays singular
// for every reader.
//
// ‼️ clients.offer IS A ONE-RELEASE MIRROR. Every write copies into it so a rollback reads a current
// offer, and loadOffer falls back to it only when client_offers itself is missing. Nothing outside this
// file may read that column; test-onboarding-artifacts.ts asserts it.
// ─────────────────────────────────────────────────────────────────────────────

/** PostgREST's "that table does not exist", in both the Postgres and the schema-cache spelling. */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

type PrimaryOffer =
  | { kind: "found"; audienceId: string; row: Record<string, unknown> | null }
  | { kind: "no_audience" }
  | { kind: "table_missing" }
  | { kind: "unreadable"; error: string };

/** The primary audience, and its primary offer row if it has one. */
async function primaryOffer(clientId: string): Promise<PrimaryOffer> {
  const { data: aud, error: audErr } = await supabaseAdmin
    .from("client_audiences")
    .select("id")
    .eq("client_id", clientId)
    .eq("is_primary", true)
    .maybeSingle();
  if (audErr) return { kind: "unreadable", error: `client_audiences is unreadable (${audErr.message})` };
  if (!aud) return { kind: "no_audience" };

  const audienceId = aud.id as string;
  const { data: row, error } = await supabaseAdmin
    .from("client_offers")
    .select("*")
    .eq("audience_id", audienceId)
    .eq("is_primary", true)
    .maybeSingle();
  if (isMissingTable(error)) return { kind: "table_missing" };
  if (error) return { kind: "unreadable", error: `client_offers is unreadable (${error.message})` };
  return { kind: "found", audienceId, row: (row as Record<string, unknown> | null) ?? null };
}

/** The deprecated mirror, read ONLY when client_offers does not exist yet. */
async function legacyOffer(clientId: string): Promise<StoredOffer> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("offer")
    .eq("id", clientId)
    .maybeSingle();
  return readOffer((data as { offer?: unknown } | null)?.offer);
}

/**
 * The offer everything is aimed at: the primary audience's primary offer.
 *
 * An empty offer (never null) when nothing is on file, the same contract it always had. A client with no
 * audience reads as having no offer; the writers below say how to fix that.
 */
export async function loadOffer(clientId: string): Promise<StoredOffer> {
  const found = await primaryOffer(clientId);
  switch (found.kind) {
    case "found":
      return found.row ? offerFromRow(found.row) : { ...EMPTY_OFFER, audienceId: found.audienceId };
    case "table_missing":
      return legacyOffer(clientId);
    case "no_audience":
      return { ...EMPTY_OFFER };
    case "unreadable":
      console.error("[clients/offers] offer unreadable:", found.error);
      return { ...EMPTY_OFFER };
  }
}

/**
 * Like loadOffer, but a read failure is RETURNED rather than turned into an empty offer.
 *
 * For verifiers: "the query failed" must never render as "nothing was proposed", which would send
 * somebody to check an intake form that is fine.
 */
export async function loadOfferStrict(clientId: string): Promise<{ ok: true; offer: StoredOffer } | { ok: false; error: string }> {
  const found = await primaryOffer(clientId);
  if (found.kind === "unreadable") return { ok: false, error: found.error };
  return { ok: true, offer: await loadOffer(clientId) };
}

/** An audience's own primary offer. For the completeness card, which reads every audience. */
export async function loadOfferForAudience(audienceId: string): Promise<StoredOffer | null> {
  const { data, error } = await supabaseAdmin
    .from("client_offers")
    .select("*")
    .eq("audience_id", audienceId)
    .eq("is_primary", true)
    .maybeSingle();
  if (error || !data) return null;
  return offerFromRow(data as Record<string, unknown>);
}

/**
 * Write the offer back where it lives, and mirror it into clients.offer.
 *
 * ‼️ A CLIENT WITH NO AUDIENCE IS REFUSED, NOT GIVEN AN OFFER THAT BELONGS TO NOBODY. The sentence names
 * `audience: <preset>`, the hand repair, so the refusal is somewhere to go.
 */
async function writeOffer(
  clientId: string,
  next: StoredOffer
): Promise<{ ok: true; offer: StoredOffer } | { ok: false; error: string }> {
  const found = await primaryOffer(clientId);

  if (found.kind === "unreadable") return { ok: false, error: found.error };
  if (found.kind === "no_audience") {
    const { AUDIENCE_REPAIR } = await import("./audiences");
    return {
      ok: false,
      error: `this client has no audience yet, and an offer is sold to an audience. ${AUDIENCE_REPAIR}`,
    };
  }

  let saved: StoredOffer = next;
  if (found.kind === "found") {
    if (found.row) {
      const { data, error } = await supabaseAdmin
        .from("client_offers")
        .update(rowFromOffer(next))
        .eq("id", found.row.id as string)
        .select("*")
        .single();
      if (error) return { ok: false, error: error.message };
      saved = offerFromRow(data as Record<string, unknown>);
    } else {
      const { data, error } = await supabaseAdmin
        .from("client_offers")
        .insert({ ...rowFromOffer(next), client_id: clientId, audience_id: found.audienceId, is_primary: true })
        .select("*")
        .single();
      // 23505 on the one-primary index is two writes racing to create the first offer. The other one won.
      if (error) {
        return {
          ok: false,
          error: error.code === "23505" ? "another change to this offer landed at the same moment. Send it again." : error.message,
        };
      }
      saved = offerFromRow(data as Record<string, unknown>);
    }
  }

  // The mirror. A failure here is logged, never returned: the offer IS saved, and a stale mirror only
  // matters to a rollback, which the table-missing fallback above does not reach.
  const { error: mirrorErr } = await supabaseAdmin
    .from("clients")
    .update({ offer: bagFromOffer(saved) })
    .eq("id", clientId);
  if (mirrorErr) {
    if (found.kind === "table_missing") return { ok: false, error: mirrorErr.message };
    console.error("[clients/offers] clients.offer mirror not written:", mirrorErr.message);
  }

  return { ok: true, offer: saved };
}

/**
 * The avatar changed, so a new audience became primary with no offer under it.
 *
 * ‼️ THE OLD TREATMENT COMES ACROSS AS A PROPOSAL, NEVER A LOCK. The lock was agreed for a different
 * buyer. As a proposal it is what the prep call's card opens with, and `offer: yes` re-locks it for the
 * new audience, which fires the re-aim through the normal path. Without this, changing the avatar left
 * the new audience with no offer at all and every [treatment] fell back to the intake answers, silently.
 */
export async function carryOfferToAudience(args: {
  clientId: string;
  fromAudienceId: string;
  toAudienceId: string;
}): Promise<string | null> {
  if (args.fromAudienceId === args.toAudienceId) return null;
  const [from, to] = await Promise.all([
    loadOfferForAudience(args.fromAudienceId),
    loadOfferForAudience(args.toAudienceId),
  ]);
  if (to || !from) return null;
  const treatment = from.treatment ?? from.proposedTreatment;
  if (!treatment) return null;

  const { error } = await supabaseAdmin.from("client_offers").insert({
    ...rowFromOffer({
      ...EMPTY_OFFER,
      proposedTreatment: treatment,
      proposedSource: from.treatment ? "call" : from.proposedSource,
      proposedAt: new Date().toISOString(),
    }),
    client_id: args.clientId,
    audience_id: args.toAudienceId,
    is_primary: true,
  });
  if (error) return null;
  return treatment;
}

/**
 * Propose one, from what intake already said. No model, no guess, always a provenance.
 *
 * ‼️ THE ORDER IS THE ARGUMENT AND IT IS NOT THE SAME ORDER treatmentPrimary USED.
 *
 * `primary_treatment` is FIRST here because it is the question that asks this exact thing:
 * "which one service do you most want more appointments for?", required, single line, with help
 * text saying it is what the pages, the posts and the free offer are aimed at.
 * `highest_margin` is second: the most profitable service and the one they want more of are
 * often different, and when they disagree the one they ASKED for wins. `services_list` is last
 * and is the weakest, because taking the top line of a menu is a guess about ordering.
 *
 * ‼️ IT NEVER OVERWRITES A LOCK. Re-running the proposal on a client whose offer was agreed on a
 * call would replace a decision with a reading of a form. Only the proposal half is written.
 */
export async function proposeOffer(
  clientId: string
): Promise<{ ok: true; offer: StoredOffer; changed: boolean } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("services, ideal_patient")
    .eq("id", clientId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "no client row" };

  const services = (data.services ?? {}) as Record<string, unknown>;
  const ideal = (data.ideal_patient ?? {}) as Record<string, unknown>;
  const current = await loadOffer(clientId);

  // ‼️ usableTreatment, NOT text. A required field does not make an answer: SRT's own
  // highest_margin is the string "any", and proposing that would aim the whole build at a word
  // meaning the opposite of one service. Each source falls through to the next, and when they
  // are all placeholders the proposal is empty and the card says to ask on the call.
  const candidates: Array<{ value: string | null; source: OfferSource }> = [
    { value: usableTreatment(services.primary_treatment), source: "primary_treatment" },
    { value: usableTreatment(ideal.highest_margin), source: "highest_margin" },
    { value: usableTreatment(firstLine(services.services_list)), source: "services_list" },
  ];

  const found = candidates.find((c) => c.value !== null) ?? null;

  const next: StoredOffer = {
    ...current,
    proposedTreatment: found?.value ?? null,
    proposedSource: found?.source ?? null,
    proposedAt: new Date().toISOString(),
  };

  const changed =
    current.proposedTreatment !== next.proposedTreatment ||
    current.proposedSource !== next.proposedSource;

  const saved = await writeOffer(clientId, next);
  if (!saved.ok) return saved;
  return { ok: true, offer: saved.offer, changed };
}

/**
 * Lock one. A person, on the call, having heard the answer.
 *
 * ‼️ A LOCK IS THE ONLY THING ANYTHING DOWNSTREAM READS AS DECIDED, so it records who and when,
 * the same shape confirmAvatar() and the theme's confirmedAt use. A treatment alone is a
 * complete lock: the magnet can be drafted afterwards in the page studio, and refusing a lock
 * for want of a magnet would hold the whole build over a thing that is written later.
 */
export async function lockOffer(args: {
  clientId: string;
  treatment: string;
  magnetKey?: string | null;
  positioning?: string | null;
  by: string;
}): Promise<
  | { ok: true; offer: StoredOffer; treatmentChanged: boolean; wasLocked: boolean }
  | { ok: false; error: string }
> {
  const treatment = usableTreatment(args.treatment);
  if (!treatment) {
    return {
      ok: false,
      error:
        "that is not a service anybody can aim a page at. One thing they sell, in their own " +
        "words, not \"any\" or \"everything\".",
    };
  }

  const current = await loadOffer(args.clientId);
  const wasLocked = isLocked(current);

  // ‼️ WHAT CHANGED IS RETURNED, BECAUSE A RE-LOCK IS NOT ALWAYS A NEW DECISION. `offer: same
  // thing | better positioning` re-stamps the lock and changes nothing anything downstream is
  // aimed at, so re-running the keyword expansion over it would spend a model call and un-approve
  // a set somebody already approved. Compared on the normal form: "Lip filler." is not a new offer.
  const treatmentChanged =
    !wasLocked || normalizePhrase(current.treatment ?? "") !== normalizePhrase(treatment);

  // ‼️ AFTER DAY 0 THE TREATMENT CANNOT MOVE, THE SAME RULE THE AVATAR FOLLOWS (avatars.ts). The
  // tracked question set is frozen at Day 0 and the day 30/60/90 numbers are read against it and
  // against the pages aimed at this treatment. Changing what everything is aimed at afterwards
  // moves the baseline under a measurement already taken. Positioning and terms can still change.
  if (wasLocked && treatmentChanged) {
    const { data: row } = await supabaseAdmin
      .from("clients")
      .select("day_0_archived_at")
      .eq("id", args.clientId)
      .maybeSingle();
    const day0 = (row as { day_0_archived_at?: string | null } | null)?.day_0_archived_at ?? null;
    if (day0) {
      return {
        ok: false,
        error:
          `Day 0 was archived on ${day0.slice(0, 10)}, and the tracked set and every page are measured ` +
          `against "${current.treatment}". Changing what they are aimed at now would move the baseline ` +
          "the day 30/60/90 numbers are read against. Positioning and terms can still change.",
      };
    }
  }

  const next: StoredOffer = {
    ...current,
    treatment,
    magnetKey: args.magnetKey === undefined ? current.magnetKey : text(args.magnetKey),
    positioning: args.positioning === undefined ? current.positioning : text(args.positioning),
    lockedAt: new Date().toISOString(),
    lockedBy: args.by,
  };

  const saved = await writeOffer(args.clientId, next);
  if (!saved.ok) return saved;
  return { ok: true, offer: saved.offer, treatmentChanged, wasLocked };
}

/**
 * Take the lock off, and keep the proposal.
 *
 * ‼️ FOR A REHEARSAL, NOT FOR A CHANGE OF MIND. `offer: something else` is how an offer changes;
 * that re-locks and fires the re-aim, which is the honest path. This is for _reset-client-board,
 * where the whole point is to walk the prep call again from a clean start: a board that was reset
 * while still holding a locked offer skips straight past the one step the reset exists to rehearse.
 *
 * ‼️ THE PROPOSAL SURVIVES ON PURPOSE. proposedTreatment is a reading of the intake form, not a
 * decision, so it is still true after a reset and it is what the prep call's card opens with.
 * Everything the LOCK carries goes: the treatment, the positioning, the customer terms and the
 * anchor magnet, because each of those is something a person said on a call that is about to be
 * held again.
 *
 * It fires no cascade. The caller is deleting the board rows anyway, so re-aiming steps that are
 * about to be re-seeded would post notes about work nobody has done yet.
 */
export async function unlockOffer(clientId: string): Promise<{ ok: true; offer: StoredOffer } | { ok: false; error: string }> {
  const current = await loadOffer(clientId);

  const next: StoredOffer = {
    ...current,
    treatment: null,
    magnetKey: null,
    positioning: null,
    lockedAt: null,
    lockedBy: null,
    terms: [],
    termsAt: null,
    outcomePromise: null,
    outcomeSetAt: null,
    price: null,
    priceSetAt: null,
    guarantee: null,
    guaranteeSetAt: null,
    anchorStage: null,
  };

  return writeOffer(clientId, next);
}

/**
 * Store the words their customers use for the offer. Replaces the list; `terms:` again with the
 * full list is how one is added or removed, which keeps the thread the record of what was said.
 *
 * Refuses on an unlocked offer: terms for an offer nobody agreed to are terms for a proposal.
 */
export async function setOfferTerms(args: {
  clientId: string;
  terms: string[];
}): Promise<{ ok: true; offer: StoredOffer; changed: boolean } | { ok: false; error: string }> {
  const current = await loadOffer(args.clientId);
  if (!isLocked(current)) {
    return {
      ok: false,
      error: "the offer is not locked yet. `offer: <what they sell>` first, then the words customers use for it.",
    };
  }

  const before = new Set(current.terms.map(normalizePhrase));
  const after = new Set(args.terms.map(normalizePhrase));
  const changed = before.size !== after.size || [...after].some((t) => !before.has(t));

  const next: StoredOffer = { ...current, terms: args.terms, termsAt: new Date().toISOString() };
  const saved = await writeOffer(args.clientId, next);
  if (!saved.ok) return saved;
  return { ok: true, offer: saved.offer, changed };
}

/**
 * The outcome the offer promises, or its price, in the client's words. `outcome:` and `price:` on the
 * prep call, each its own message.
 *
 * Refuses on an unlocked offer, the same rule terms follow: an outcome for an offer nobody agreed to is
 * an outcome for a proposal. Returns whether the value changed, because a new outcome makes an approved
 * sales letter stale (its approval fingerprint includes it).
 */
export async function setOfferDetail(args: {
  clientId: string;
  field: "outcome" | "price" | "guarantee";
  value: string;
}): Promise<{ ok: true; offer: StoredOffer; changed: boolean } | { ok: false; error: string }> {
  const value = text(args.value);
  if (!value || value.length < 2) {
    return {
      ok: false,
      error:
        args.field === "outcome"
          ? "that is not an outcome. In plain words, what they get: `outcome: more appointments`."
          : args.field === "price"
            ? "that is not a price. As they state it: `price: $399 per session`."
            : "that is not a guarantee. As the client will honour it: `guarantee: free until 5 AI inquiries, then $499/month`.",
    };
  }
  if (hasBannedDash(value)) {
    return { ok: false, error: "it contains an em dash, an en dash or a double hyphen, which no copy may carry." };
  }

  const current = await loadOffer(args.clientId);
  if (!isLocked(current)) {
    return {
      ok: false,
      error: `the offer is not locked yet. \`offer: <what they sell>\` first, then \`${args.field}:\`.`,
    };
  }

  const now = new Date().toISOString();
  const before =
    args.field === "outcome" ? current.outcomePromise : args.field === "price" ? current.price : current.guarantee;
  const next: StoredOffer =
    args.field === "outcome"
      ? { ...current, outcomePromise: value, outcomeSetAt: now }
      : args.field === "price"
        ? { ...current, price: value, priceSetAt: now }
        : { ...current, guarantee: value, guaranteeSetAt: now };

  const saved = await writeOffer(args.clientId, next);
  if (!saved.ok) return saved;
  return { ok: true, offer: saved.offer, changed: normalizePhrase(before ?? "") !== normalizePhrase(value) };
}

/**
 * Name the ANCHOR: the one offer every page's lead magnet is a framing of.
 *
 * ‼️ THIS IS THE FIRST WRITER `magnetKey` HAS EVER HAD. It was declared, displayed by offerLine
 * and read by a verifier, and nothing set it, so the step card promising "the lead magnet on each
 * one built around whatever is locked here" described code that did not exist. Matthew,
 * 2026-09-11: every page's magnet should lead back to one core offer (for SRT, the AI visibility
 * audit), so the anchor is now a real decision with a real writer.
 *
 * ‼️ IT DOES NOT RE-LOCK. lockOffer stamps lockedAt and lockedBy, which record when the offer
 * was agreed. Choosing which magnet anchors it is a separate decision made later, in the page
 * studio, and re-stamping the lock would rewrite when the offer itself was decided.
 *
 * Refuses on an unlocked offer: an anchor for an offer nobody agreed to is a pitch aimed at a
 * reading of the intake form.
 */
export async function setAnchorMagnet(args: {
  clientId: string;
  magnetKey: string | null;
}): Promise<{ ok: true; offer: StoredOffer } | { ok: false; error: string }> {
  const current = await loadOffer(args.clientId);
  const key = text(args.magnetKey);

  if (key && !isLocked(current)) {
    return {
      ok: false,
      error: "the offer is not locked yet. `offer: <what they sell>` first, then the anchor.",
    };
  }

  const next: StoredOffer = { ...current, magnetKey: key };
  return writeOffer(args.clientId, next);
}

/** Record which awareness rung the anchor was picked from. Null clears it. */
export async function setAnchorStage(args: {
  clientId: string;
  stage: 1 | 2 | 3 | 4 | 5 | null;
}): Promise<{ ok: true; offer: StoredOffer } | { ok: false; error: string }> {
  const current = await loadOffer(args.clientId);
  if (args.stage !== null && !isLocked(current)) {
    return { ok: false, error: "the offer is not locked yet. `offer: <what they sell>` first." };
  }
  return writeOffer(args.clientId, { ...current, anchorStage: args.stage });
}

// ─────────────────────────────────────────────────────────────────────────────
// The thread reply
//
// ‼️ THE PREFIX IS EXACT AND THE HANDLER RETURNS null ON A MISS, the same contract
// handleAvatarThreadReply and handleSkinThreadReply keep. Free text in a step thread is answered
// by a model, so a sentence that merely contains the word "offer" is a sentence and must fall
// through. `offer:` with a colon is somebody addressing the machine.
//
// The route gets a call, not an implementation.
// ─────────────────────────────────────────────────────────────────────────────

/** Only in this step's thread. Anywhere else the words are conversation. */
const OFFER_STEPS = new Set(["offer_locked", "pre_call_pages"]);

/**
 * The commands step 21's thread also takes (2026-09-16). The awareness ladder is written from the outcome,
 * the price and the guarantee, and asking somebody to scroll back to the prep call's thread to type them
 * is how they end up typed into the wrong one. `offer:` and `terms:` stay on the prep call: changing
 * either re-aims the keyword set, which is not something to do from the page plan.
 */
const DETAIL_ONLY_STEPS = new Set(["pre_call_pages"]);

const OFFER_PREFIX = /^\s*offer\s*:/i;

/** Is this somebody answering the offer question? Explicit, never sniffed. */
export function isOfferReply(text: string): boolean {
  return OFFER_PREFIX.test(text);
}

/** `terms: lip flip, lip filler` in the same thread. Its own prefix, never an `offer:` reply. */
const TERMS_PREFIX = /^\s*terms\s*:/i;

/** What the route posts, and what it runs after posting. */
export interface OfferReply {
  message: string;
  /**
   * The re-aim, when the lock or the terms changed after the step was already done.
   *
   * ‼️ RETURNED, NOT RUN. It reopens the keyword step, whose runner makes a model call inside the
   * cascade, and the Slack events route has to answer inside three seconds. The route posts this
   * reply first and runs `after` in waitUntil, the same shape the `run` command uses.
   */
  after?: () => Promise<void>;
}

async function offerStepDone(clientId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("status")
    .eq("client_id", clientId)
    .eq("step_key", "offer_locked")
    .maybeSingle();
  return (data as { status?: string } | null)?.status === "complete";
}

async function reaim(clientId: string, change: { treatmentChanged: boolean; termsChanged: boolean }) {
  const { reaimDownstream } = await import("./offer-cascade");
  await reaimDownstream(clientId, change);
}

type ReaimChange = { treatmentChanged: boolean; termsChanged: boolean };

/** One command's answer: what to say, and the re-aim it asks for. */
interface DirectivePart {
  message: string;
  reaim?: ReaimChange;
}

/** What one Slack message in the offer thread is, read by its FIRST line. */
/** `outcome: more appointments` and `price: $399 per session`, since the client_offers cutover. */
const OUTCOME_PREFIX = /^\s*outcome\s*:/i;
const PRICE_PREFIX = /^\s*price\s*:/i;
const GUARANTEE_PREFIX = /^\s*guarantee\s*:/i;

/** The one-line commands of the offer thread. Each is one message. */
export type OfferCommandKind = "offer" | "terms" | "outcome" | "price" | "guarantee";

const COMMAND_PREFIXES: ReadonlyArray<readonly [OfferCommandKind, RegExp]> = [
  ["offer", OFFER_PREFIX],
  ["terms", TERMS_PREFIX],
  ["outcome", OUTCOME_PREFIX],
  ["price", PRICE_PREFIX],
  ["guarantee", GUARANTEE_PREFIX],
];

/** What one Slack message in the offer thread is, read by its FIRST line. */
export type OfferCommand =
  /** The first line is not one of the commands, so the message is conversation. */
  | { kind: "none" }
  | {
      kind: OfferCommandKind;
      /** The command's own line, prefix removed. Never the lines after it. */
      value: string;
      /** Lines after the first, reported back as not saved, never folded into the value. */
      extra: string[];
    }
  /** A second command line in the same message. Refused, never merged. */
  | { kind: "combined"; commands: OfferCommandKind[] };

function commandOf(line: string): OfferCommandKind | null {
  for (const [kind, prefix] of COMMAND_PREFIXES) if (prefix.test(line)) return kind;
  return null;
}

function prefixOf(kind: OfferCommandKind): RegExp {
  return COMMAND_PREFIXES.find(([k]) => k === kind)![1];
}

/**
 * Read one message as ONE command, decided by its first line.
 *
 * ‼️ THIS IS THE FIX FOR A LOCK THAT CORRUPTED ITSELF, 2026-09-14. Both prefixes are anchored at `^`
 * with no `m` flag, and the terms branch tested the WHOLE message. So `offer: yes` and `terms: a, b`
 * sent as one two-line message failed the terms test (the message starts with "offer:"), fell into
 * the offer branch, and `yes\nterms: ...` failed the full-string accept test and was locked as the
 * treatment. srt-agency-llc's treatment became that blob with terms: [].
 *
 * ‼️ A COMBINED MESSAGE IS REFUSED, NEVER MERGED. Decided 2026-09-15 (the avatar and offer framework
 * build): one command per message, for every prefix in this thread. Merging looks friendlier and is
 * the wrong call here, because this thread is about to take PASTED DOCUMENTS (`letter replace:`), and
 * a sales letter can carry a line that starts "Offer: 3 free sessions". A parser that went looking
 * for commands on every line would lock that as the treatment. Reading only the first line cannot.
 *
 * ‼️ A CONTINUATION LINE IS NOT PART OF THE VALUE. Folding "they want it natural" onto the line above
 * would lock a sentence as the treatment, the same failure in a smaller size.
 */
export function readOfferCommand(text: string): OfferCommand {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const kind = lines.length ? commandOf(lines[0]) : null;
  if (!kind) return { kind: "none" };

  const rest = lines.slice(1);
  const others = rest.map(commandOf).filter((c): c is OfferCommandKind => c !== null);
  if (others.length) return { kind: "combined", commands: [kind, ...others] };

  return { kind, value: lines[0].replace(prefixOf(kind), "").trim(), extra: rest };
}

/** `outcome:` or `price:`, answered in the same shape as `terms:`. */
async function detailReply(clientId: string, field: "outcome" | "price" | "guarantee", raw: string): Promise<DirectivePart> {
  const res = await setOfferDetail({ clientId, field, value: raw });
  if (!res.ok) return { message: `:warning: Not saved: ${res.error}` };
  const value = field === "outcome" ? res.offer.outcomePromise : field === "price" ? res.offer.price : res.offer.guarantee;
  return {
    message: [
      `:white_check_mark: *${field === "outcome" ? "Outcome" : field === "price" ? "Price" : "Guarantee"} saved:* ${value}.`,
      field === "outcome"
        ? "Headlines and CTAs for this audience promise this, and the sales letter is written toward it."
        : field === "price"
          ? "Price pages and the sales letter read this as the client states it."
          : "The awareness ladder may promise exactly this and nothing more. `ladder` at step 21 rewrites it with the guarantee in.",
      !res.changed ? "_The same as before, so nothing downstream changes._" : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

async function termsReply(clientId: string, raw: string): Promise<DirectivePart> {
  const parsed = parseTerms(raw);
  if (!parsed.ok) return { message: `:warning: Not saved: ${parsed.error}` };

  const res = await setOfferTerms({ clientId, terms: parsed.terms });
  if (!res.ok) return { message: `:warning: Not saved: ${res.error}` };

  const { stepNumber } = await import("@/config/delivery-steps");
  const done = await offerStepDone(clientId);
  const n = res.offer.terms.length;

  return {
    message: [
      `:white_check_mark: *${n} term${n === 1 ? "" : "s"} saved:* ${res.offer.terms.join(", ")}.`,
      `Step ${stepNumber("keyword_set")} expands every way the offer is said from these and the ` +
        "treatment, and tests every phrase's relevance against them.",
      !res.changed
        ? "_The same list as before, so nothing downstream changes._"
        : done
          ? "This step is already done, so the keyword set is re-run against the new terms now. It says so in its own thread."
          : "*Next:* press [Done] on this step.",
    ].join("\n"),
    reaim: res.changed && done ? { treatmentChanged: false, termsChanged: true } : undefined,
  };
}

export async function handleOfferThreadReply(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<OfferReply | null> {
  if (!input.stepKey || !OFFER_STEPS.has(input.stepKey)) return null;

  const cmd = readOfferCommand(input.text);
  // ‼️ STILL null ON A MISS. Only a FIRST line starting `offer:` or `terms:` is a command; anything
  // else, including a pasted document with such a line further down, falls through untouched.
  if (cmd.kind === "none") return null;
  if (DETAIL_ONLY_STEPS.has(input.stepKey) && (cmd.kind === "offer" || cmd.kind === "terms")) return null;

  if (cmd.kind === "combined") {
    const named = [...new Set(cmd.commands)].map((c) => `\`${c}:\``).join(" and ");
    return {
      message:
        `:warning: Nothing saved. That message has ${named} in it, and this thread takes one command ` +
        "per message, so none of them was applied. Send each one as its own message.",
    };
  }

  const part =
    cmd.kind === "terms"
      ? await termsReply(input.clientId, cmd.value)
      : cmd.kind === "outcome" || cmd.kind === "price" || cmd.kind === "guarantee"
        ? await detailReply(input.clientId, cmd.kind, cmd.value)
        : await offerLockReply(input.clientId, cmd.value, input.by);

  const extra = cmd.extra.length
    ? [
        "",
        `_Not saved, because only the \`${cmd.kind}:\` line itself is read: ${cmd.extra
          .map((l) => `"${l.length > 80 ? `${l.slice(0, 80)}...` : l}"`)
          .join(", ")}._`,
      ]
    : [];

  const change = part.reaim;
  return {
    message: [part.message, ...extra].join("\n"),
    after: change ? () => reaim(input.clientId, change) : undefined,
  };
}

/** The `offer:` line: take the proposal, or lock what they said. */
async function offerLockReply(clientId: string, body: string, by: string): Promise<DirectivePart> {
  const input = { clientId, by };
  const current = await loadOffer(input.clientId);

  // ‼️ `offer: yes` TAKES THE PROPOSAL, AND IT IS STILL A LOCK. The value written is the
  // proposed one, but lockedAt and lockedBy record that a person said so, which is the whole
  // distinction this pair of steps exists to draw. Accepting a proposal is a decision.
  const accepting = /^(yes|y|ok|okay|confirm|confirmed|that one|keep it)$/i.test(body);

  if (accepting && !current.proposedTreatment) {
    return {
      message:
        ":warning: There is nothing proposed to accept. Reply `offer: <what they sell>` with " +
        "their own words instead.",
    };
  }

  // "what they sell | how they want it positioned". A pipe because a comma is punctuation
  // somebody uses inside an answer and a pipe is not.
  const [rawTreatment, ...rest] = accepting ? [current.proposedTreatment ?? ""] : body.split("|");
  const treatment = (rawTreatment ?? "").trim();
  const positioning = rest.join("|").trim();

  if (!treatment) {
    return {
      message:
        ":warning: I did not get a name out of that. `offer: lip filler`, or " +
        "`offer: lip filler | the one they book again` to capture the positioning too.",
    };
  }

  const res = await lockOffer({
    clientId: input.clientId,
    treatment,
    positioning: positioning || undefined,
    by: input.by,
  });

  if (!res.ok) return { message: `:warning: Could not lock that: ${res.error}` };

  const { stepNumber } = await import("@/config/delivery-steps");
  const done = await offerStepDone(input.clientId);

  // ‼️ "PRESS DONE" ONLY WHEN THERE IS A DONE TO PRESS. A re-lock on a finished step used to be
  // told to press a button that had already been pressed, while nothing it fed was re-run.
  const next: string[] = [];
  if (!done) {
    next.push(
      `  • Press [Done] on this step. That opens step ${stepNumber("keyword_set")}'s keyword set ` +
        "and re-runs anything that already ran against the proposal."
    );
  } else if (res.treatmentChanged) {
    next.push(
      "  • This step was already done, so what was aimed at the old offer is re-aimed now: the " +
        "keyword set re-expands and the research prompt is posted again. Each says so in its own thread."
    );
  } else {
    next.push("  • The treatment is the same, so nothing downstream changes.");
  }
  if (!res.offer.terms.length) {
    next.push(
      "  • `terms: <what their customers call it>, <another>` adds the words the keyword step matches against."
    );
  }
  if (!res.offer.positioning) {
    next.push(
      "  • No positioning captured. `offer: " + res.offer.treatment + " | <how they want to be " +
        "known for it>` adds it without changing the lock."
    );
  }

  return {
    message: [
      `:white_check_mark: *Locked on ${res.offer.treatment}.*`,
      ...(res.offer.positioning ? [`_Positioning: ${res.offer.positioning}_`] : []),
      ...(accepting ? ["_Took the proposal, and it is a decision now rather than a reading._"] : []),
      "",
      "*Next:*",
      ...next,
    ].join("\n"),
    reaim: done && res.treatmentChanged ? { treatmentChanged: true, termsChanged: false } : undefined,
  };
}
