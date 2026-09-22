// Everything known about one lead, in one object, with every field saying whether we actually have it.
//
// Matthew, 2026-09-17: "Scan all of the data this lead currently has and it asks bulletpoint questions
// with the things we are missing in order to complete X onboarding step in the process, this way it has
// full context on all of the lead."
//
// ‼️ THIS IS NOT A SEVENTH ASSEMBLY, AND A PROBE ENFORCES THAT. Six reads already assemble a picture of
// a client (clientProfile, completenessFor, step-engine's loadFacts, planMapData, storyContextFor, and
// the dashboard page's inline block). A seventh that issued its own SQL would drift from all of them.
// So: THE ONLY TABLE THIS FILE SELECTS FROM IS client_datasets, which nothing else reads. Everything
// else is a call into the reader that already owns those rows, and when a reader double-fetches the fix
// is a parameter on that reader, never a query here. _probe-lead-context.ts greps this file and fails on
// any other table name.
//
// ‼️ READ ONLY, LIKE client-reads.ts. Nothing here writes and nothing here starts. In particular it does
// NOT call reachableCursor(): that function tops up missing step rows, which is a write, and a context
// assembled to describe the board must not change it. See `board.reachable` below.

import { DELIVERY_STEPS, stepNumber, type StepKey } from "@/config/delivery-steps";
import { supabaseAdmin } from "@/lib/db";
import { scopedOnce } from "./lead-scope";
import { auditsForLead, clientIdentity, clientSteps, type ClientRef, type LeadAudit } from "./client-reads";
import { audiencesFor, type ResolvedAudience } from "./audiences";
import { EMPTY_OFFER, loadOffer, loadOfferForAudience, type StoredOffer } from "./offers";
import {
  documentKey,
  documentsFor,
  documentFingerprint,
  type AudienceDocument,
  type DocumentKind,
} from "./audience-documents";
import { loadKeywords, keywordFingerprint } from "./client-keywords";
import { avatarBriefFor } from "./avatars";
import { readClientEvents, type ClientEventRow } from "./client-events";
import { completenessFor, type CompletenessInputs } from "./dataset-completeness";
import type { DatasetReport } from "./dataset-spec";

// ─────────────────────────────────────────────────────────────────────────────
// The tri-state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Why a thing is not here. Four different facts that a single `null` used to flatten into one.
 *
 * ‼️ `unreadable` IS NOT `missing` AND THE DIFFERENCE IS THE PRODUCT. dataset-completeness.ts degrades
 * every read error to a zero, which is fine for a card that says "6 fields empty". It is NOT fine for a
 * scanner whose whole contract is "if we already hold it, do not ask for it": a broken select would turn
 * into an ask for work somebody already did, which is the fastest way to make people stop reading these
 * cards. An unreadable field is reported as unreadable and is NEVER rendered as a question.
 */
export type MissingBecause =
  /** Nothing in the system asks for this yet. dataset-spec's `filledBy.asked === false`. */
  | "never_asked"
  /** The question exists and has not been answered. */
  | "asked_unanswered"
  /** It cannot be asked until something upstream exists: no audience, so no vocabulary. */
  | "blocked"
  /** The read failed. Not the same fact as empty. */
  | "unreadable";

/**
 * A fact, and whether we have it.
 *
 * ‼️ A DISCRIMINATED UNION, NOT A WRAPPER WITH A NULLABLE `value`. On the `missing` arm the `value` key
 * does not exist, so `h.value ?? ""` does not compile. That turns "report, never invent" from a review
 * comment into a type error, which matters because the tempting places to default are exactly the ones
 * that hurt: an empty quote bank is visible, a wrong one is not.
 *
 * ‼️ THERE IS DELIBERATELY NO `unwrap(h, fallback)` HELPER. Adding one re-opens the hole this closes.
 */
export type Held<T> =
  | { state: "present"; value: T; at: string | null; source: string }
  | { state: "stale"; value: T; at: string | null; source: string; why: string }
  | { state: "missing"; because: MissingBecause; why: string };

export type Presence = Held<unknown>["state"];

/** Present when there is a value, missing with the given reason when there is not. */
export function held<T>(
  value: T | null | undefined,
  opts: { at?: string | null; source: string; why: string; because?: MissingBecause }
): Held<T> {
  const empty =
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0);
  if (empty) return { state: "missing", because: opts.because ?? "asked_unanswered", why: opts.why };
  return { state: "present", value: value as T, at: opts.at ?? null, source: opts.source };
}

export function missing(because: MissingBecause, why: string): Held<never> {
  return { state: "missing", because, why };
}

export function stale<T>(value: T, opts: { at?: string | null; source: string; why: string }): Held<T> {
  return { state: "stale", value, at: opts.at ?? null, source: opts.source, why: opts.why };
}

/** Whether we hold a usable value, stale or not. For a caller deciding whether to ask for it. */
export function isHeld<T>(h: Held<T>): h is Extract<Held<T>, { state: "present" | "stale" }> {
  return h.state !== "missing";
}

// ─────────────────────────────────────────────────────────────────────────────
// Slices
// ─────────────────────────────────────────────────────────────────────────────

export type LeadSlice = "core" | "documents" | "keywords" | "pages" | "audits" | "research" | "history" | "gaps";

/** What a step card needs. Everything else is a panel's question and is loaded on request. */
export const CARD_SLICES = ["core", "documents", "gaps"] as const satisfies readonly LeadSlice[];
export const ALL_SLICES = [
  "core",
  "documents",
  "keywords",
  "pages",
  "audits",
  "research",
  "history",
  "gaps",
] as const satisfies readonly LeadSlice[];

// ─────────────────────────────────────────────────────────────────────────────
// The shape
// ─────────────────────────────────────────────────────────────────────────────

export interface LeadAudience {
  row: ResolvedAudience;
  vocabulary: Held<{ buyerSingular: string; offerSingular: string }>;
  buyerMarket: Held<string>;
  confirmed: Held<string>;
  documents: Record<DocumentKind, Held<AudienceDocument>>;
}

export interface LeadOffer {
  row: StoredOffer;
  audienceId: string | null;
  treatment: Held<string>;
  terms: Held<string[]>;
  outcomePromise: Held<string>;
  price: Held<string>;
  guarantee: Held<string>;
  positioning: Held<string>;
  magnetKey: Held<string>;
  anchorStage: Held<number>;
  locked: Held<string>;
  /** The proposal, carried separately so a card can quote it without implying it was decided. */
  proposedTreatment: string | null;
}

export interface LeadStep {
  key: StepKey;
  number: number;
  label: string;
  phase: string;
  status: string;
  verifiedSource: string | null;
  completedAt: string | null;
  blockedBy: readonly StepKey[];
  /** A blocking step completed AFTER this one did, so what this produced was aimed at an older answer. */
  staleAfter: readonly StepKey[];
}

export interface ResearchPull {
  id: string;
  kind: string;
  provider: string | null;
  costUsd: number;
  fetchedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  hitCount: number;
}

export interface LeadKeywords {
  total: number;
  approved: number;
  byRole: Record<string, number>;
  byStage: Record<string, number>;
}

export interface LeadPage {
  id: string;
  slug: string;
  title: string | null;
  status: string;
}

/**
 * One necessary belief, addressed the way every other reader of them already does.
 *
 * ‼️ `{id, text}`, NOT A BARE STRING, BECAUSE THAT IS WHAT THE WRITER STORES. framework-thread.ts
 * stores `parsed.beliefs` as `[{id:"B1", text}]` and page-stories.ts, offer-ladder.ts and
 * draft-page.ts all render `${b.id}: ${b.text}`. This field used to be typed `readonly string[]`
 * and cast straight across, so the first card to print a belief would have printed [object Object].
 * The id is load-bearing: draft-page.ts cites beliefs by it.
 */
export interface LeadBelief {
  id: string;
  text: string;
}

export interface LeadContext {
  clientId: string;
  /** Slices actually loaded. A branch not in here is "we did not look", never "it is not there". */
  loaded: ReadonlySet<LeadSlice>;
  /** Every read that failed, verbatim. Non-empty means some field is `unreadable`. */
  readErrors: readonly string[];

  identity: {
    ref: ClientRef;
    name: string;
    domain: Held<string>;
    website: Held<string>;
    vertical: Held<string>;
    businessType: Held<string>;
    city: Held<string>;
    intakeCompletedAt: Held<string>;
    day0ArchivedAt: Held<string>;
  };

  audiences: readonly LeadAudience[];
  primaryAudience: LeadAudience | null;
  avatar: {
    slug: Held<string>;
    vertical: Held<string>;
    research: Held<string>;
    timesReused: Held<number>;
  };
  offers: readonly LeadOffer[];
  primaryOffer: LeadOffer | null;
  /** The primary audience's documents, the ones every card means when it says "on file". */
  documents: Record<DocumentKind, Held<AudienceDocument>>;
  beliefs: Held<readonly LeadBelief[]>;
  ladder: Held<{ rungs: readonly unknown[]; anchoredAt: number | null }>;

  keywords: Held<LeadKeywords>;
  pages: Held<readonly LeadPage[]>;
  audits: Held<readonly LeadAudit[]>;
  research: Held<readonly ResearchPull[]>;
  history: Held<readonly ClientEventRow[]>;
  gaps: Held<readonly DatasetReport[]>;

  board: {
    steps: readonly LeadStep[];
    /**
     * Read-only derivation for REPORTING.
     *
     * ‼️ reachableCursor() IN step-engine.ts STAYS THE ONE AUTHORITY FOR WHAT MAY BE POSTED. It also
     * seeds missing step rows, which is a write, so this file cannot call it. This walk answers the
     * same question from rows already read and never writes, which is why it is named differently.
     */
    reachable: readonly StepKey[];
    cursor: Held<StepKey>;
    blocked: readonly { key: StepKey; on: readonly StepKey[] }[];
  };
}

const ALL_KINDS: readonly DocumentKind[] = [
  "sales_letter",
  "deep_research",
  "avatar_sheet",
  "short_offer",
  "necessary_beliefs",
  "awareness_ladder",
];

/** The kinds that hang off the AUDIENCE. Everything else hangs off an offer, per the check constraint. */
const AUDIENCE_KINDS: readonly DocumentKind[] = ["deep_research", "avatar_sheet"];

/** Why each document matters, in the words a card can print. */
const KIND_WHY: Record<DocumentKind, string> = {
  deep_research: "nothing has been pasted, so every later document is written without the research behind it",
  avatar_sheet: "nothing has been pasted, so every headline is written without knowing who it is for",
  short_offer: "the ladder can be written without it, but every rung argues from the treatment rather than the offer",
  necessary_beliefs: "this is what every page is supposed to install, and there is no belief on file to install",
  sales_letter: "the long-form argument the pages are compressed from",
  awareness_ladder: "one claim, one risk reversal and one anchor per stage of awareness",
};

function documentHeld(
  doc: AudienceDocument | null,
  kind: DocumentKind,
  offer: StoredOffer | null,
  unreadable: boolean
): Held<AudienceDocument> {
  if (unreadable) {
    return missing("unreadable", "audience_documents could not be read, so this is unknown rather than absent");
  }
  if (!doc) return missing("asked_unanswered", KIND_WHY[kind]);

  // ‼️ A SUPERSEDED ROW REACHED US THROUGH THE "else the newest" FALLBACK, which means a replacement did
  // not finish. The document is real and one re-send from live, so it is stale, never missing.
  if (doc.supersededAt) {
    return stale(doc, {
      at: doc.createdAt,
      source: `audience_documents:${doc.id.slice(0, 8)}`,
      why: "it was replaced and the replacement did not land, so this is the last complete version",
    });
  }

  // An approval is pinned to the offer it was approved against. A new treatment or outcome is a
  // different offer to have written this about.
  if (
    doc.status === "approved" &&
    offer &&
    doc.offerFingerprint &&
    doc.offerFingerprint !== documentFingerprint(offer)
  ) {
    return stale(doc, {
      at: doc.approvedAt ?? doc.createdAt,
      source: `audience_documents:${doc.id.slice(0, 8)}`,
      why: "it was approved against a different treatment or outcome than the offer now carries",
    });
  }

  return { state: "present", value: doc, at: doc.createdAt, source: `audience_documents:${doc.id.slice(0, 8)}` };
}

function emptyDocuments(unreadable: boolean): Record<DocumentKind, Held<AudienceDocument>> {
  const out = {} as Record<DocumentKind, Held<AudienceDocument>>;
  for (const k of ALL_KINDS) out[k] = documentHeld(null, k, null, unreadable);
  return out;
}

/**
 * The beliefs out of a stored necessary_beliefs document.
 *
 * ‼️ THE SHAPE THE WRITER WROTE, READ BACK EXACTLY. framework-thread.ts stores
 * `[{id:"B1", text}]`. A bare string array is tolerated because it costs one branch and a document
 * written by hand or by an older path is still a document somebody produced; it is renumbered
 * rather than renamed, so an id always exists for draft-page.ts to cite.
 */
function readBeliefsParsed(parsed: Record<string, unknown> | null | undefined): LeadBelief[] | null {
  const raw = (parsed as { beliefs?: unknown } | null | undefined)?.beliefs;
  if (!Array.isArray(raw)) return null;
  const out: LeadBelief[] = [];
  for (const b of raw) {
    if (typeof b === "string") {
      const text = b.trim();
      if (text) out.push({ id: `B${out.length + 1}`, text });
      continue;
    }
    const o = b as { id?: unknown; text?: unknown } | null;
    const text = typeof o?.text === "string" ? o.text.trim() : "";
    if (!text) continue;
    out.push({ id: typeof o?.id === "string" && o.id ? o.id : `B${out.length + 1}`, text });
  }
  return out.length ? out : null;
}

/**
 * The rungs out of a stored awareness_ladder document.
 *
 * ‼️ THE NESTING IS THE WHOLE POINT. writeLadder stores `{ ladder, inputs, model }` and the rungs
 * are under `ladder`. `parsed.rungs` is read as a fallback and not as the primary, so a document
 * written in the shallow shape is still understood without pretending it is the one we write.
 */
function readLadderParsed(
  parsed: Record<string, unknown> | null | undefined,
  anchorStage: number | null
): { rungs: readonly unknown[]; anchoredAt: number | null } | null {
  const p = parsed as { ladder?: { rungs?: unknown }; rungs?: unknown } | null | undefined;
  const nested = p?.ladder?.rungs;
  const rungs = Array.isArray(nested) ? nested : Array.isArray(p?.rungs) ? (p.rungs as unknown[]) : null;
  if (!rungs || !rungs.length) return null;
  return { rungs, anchoredAt: anchorStage };
}

export interface LeadContextOptions {
  include?: readonly LeadSlice[];
}

/**
 * Everything we hold about one lead.
 *
 * Memoized per unit of work by lead-scope.ts, so a card that asks three questions reads once. Outside a
 * scope it reads for real every time, which is what makes the probe's query count a measurement.
 */
export async function leadContext(clientId: string, opts: LeadContextOptions = {}): Promise<LeadContext> {
  const slices = new Set<LeadSlice>(opts.include ?? CARD_SLICES);
  slices.add("core");
  const key = `leadContext:${clientId}:${[...slices].sort().join(",")}`;
  return scopedOnce(key, () => assemble(clientId, slices));
}

async function assemble(clientId: string, slices: ReadonlySet<LeadSlice>): Promise<LeadContext> {
  const readErrors: string[] = [];
  const note = (what: string, e: unknown) => {
    readErrors.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
  };

  // ── Wave 1: the rows everything else is keyed on ─────────────────────────────────────────────
  const [identityRead, steps, audienceRows, primaryOfferRow] = await Promise.all([
    clientIdentity(clientId).catch((e) => {
      note("clients", e);
      return { error: String(e) };
    }),
    clientSteps(clientId).catch((e) => {
      note("client_delivery_steps", e);
      return [] as Awaited<ReturnType<typeof clientSteps>>;
    }),
    audiencesFor(clientId).catch((e) => {
      note("client_audiences", e);
      return [] as ResolvedAudience[];
    }),
    loadOffer(clientId).catch((e) => {
      note("client_offers", e);
      return EMPTY_OFFER;
    }),
  ]);

  const who = "error" in identityRead ? null : identityRead;
  if (!who && "error" in identityRead) readErrors.push(`clients: ${identityRead.error}`);
  const ref: ClientRef = who?.ref ?? { id: clientId, name: "this client", slug: null, domain: null };
  // An unreadable clients row is not an empty one: every identity field below says so rather than
  // reporting a business with no domain and no vertical, which reads as a client nobody set up.
  const idBecause: MissingBecause = who ? "asked_unanswered" : "unreadable";

  // ── Wave 2: keyed reads ──────────────────────────────────────────────────────────────────────
  const audienceIds = audienceRows.map((a) => a.id);
  const docsRead = await documentsFor({ clientId, audienceIds });
  if (!docsRead.ok) readErrors.push(docsRead.error);
  const docs: ReadonlyMap<string, AudienceDocument> = docsRead.ok ? docsRead.docs : new Map();
  const docsUnreadable = !docsRead.ok;

  // Each audience's own primary offer, loaded once and shared with completenessFor below.
  const offersByAudience = new Map<string, StoredOffer | null>();
  await Promise.all(
    audienceRows.map(async (a) => {
      try {
        offersByAudience.set(a.id, await loadOfferForAudience(a.id));
      } catch (e) {
        note(`client_offers(${a.slug})`, e);
        offersByAudience.set(a.id, null);
      }
    })
  );

  const primaryRow = audienceRows.find((a) => a.isPrimary) ?? audienceRows[0] ?? null;

  const audiences: LeadAudience[] = audienceRows.map((row) => {
    const own = offersByAudience.get(row.id) ?? null;
    const offer = row.isPrimary ? own ?? primaryOfferRow : own;
    const offerId = offer?.id ?? null;

    const perKind = {} as Record<DocumentKind, Held<AudienceDocument>>;
    for (const kind of ALL_KINDS) {
      const onAudience = AUDIENCE_KINDS.includes(kind);
      if (!onAudience && !offerId) {
        // Not "nobody pasted it": it cannot be pasted yet. A different fact, and a card that asked
        // for it would be asking for something the table would refuse.
        perKind[kind] = missing("blocked", "it belongs to an offer and no offer is on file for this audience yet");
        continue;
      }
      const doc = docs.get(documentKey(row.id, onAudience ? null : offerId, kind)) ?? null;
      perKind[kind] = documentHeld(doc, kind, offer, docsUnreadable);
    }

    const vocab =
      row.vocabulary?.buyerSingular && row.vocabulary?.offerSingular
        ? { buyerSingular: row.vocabulary.buyerSingular, offerSingular: row.vocabulary.offerSingular }
        : null;

    return {
      row,
      vocabulary: held(vocab, {
        at: row.vocabularyConfirmedAt,
        source: "client_audiences.vocabulary",
        why: "the words this audience uses for itself and for what it buys are not confirmed",
      }),
      buyerMarket: held(row.buyerMarket, {
        source: "client_audiences.buyer_market",
        why: "we do not know what market this audience is about",
      }),
      confirmed: held(row.confirmedAt, {
        at: row.confirmedAt,
        source: "client_audiences.confirmed_at",
        why: "nobody has confirmed this audience",
      }),
      documents: perKind,
    };
  });

  const primary = audiences.find((a) => a.row.isPrimary) ?? audiences[0] ?? null;
  const documents = primary ? primary.documents : emptyDocuments(docsUnreadable);

  // ── Offers ───────────────────────────────────────────────────────────────────────────────────
  const offerRows: StoredOffer[] = audienceRows.length
    ? audienceRows.map((a) => offersByAudience.get(a.id) ?? (a.isPrimary ? primaryOfferRow : EMPTY_OFFER))
    : [primaryOfferRow];

  const offers: LeadOffer[] = offerRows.map((row) => ({
    row,
    audienceId: row.audienceId,
    // ‼️ A PROPOSAL IS NOT AN OFFER. A proposed-only offer is MISSING, never stale: nobody decided it,
    // so there is no older decision for it to have drifted from.
    treatment: held(row.treatment, {
      at: row.lockedAt,
      source: "client_offers.treatment",
      why: row.proposedTreatment
        ? "a proposal is on file and nobody has locked it"
        : "nothing is on file for what this client sells",
    }),
    terms: held(row.terms, {
      at: row.termsAt,
      source: "client_offers.terms",
      why: "the words their customers use for it are not captured",
    }),
    outcomePromise: held(row.outcomePromise, {
      at: row.outcomeSetAt,
      source: "client_offers.outcome_promise",
      why: "the outcome promised is not on file",
    }),
    price: held(row.price, { at: row.priceSetAt, source: "client_offers.price", why: "the price or ticket is not on file" }),
    guarantee: held(row.guarantee, {
      at: row.guaranteeSetAt,
      source: "client_offers.guarantee",
      why: "no risk reversal is on file, so no rung may promise one",
    }),
    positioning: held(row.positioning, {
      source: "client_offers.positioning",
      why: "how they want it positioned is not captured",
    }),
    magnetKey: held(row.magnetKey, { source: "client_offers.magnet_key", why: "no anchor magnet is picked" }),
    anchorStage: held(row.anchorStage, {
      source: "client_offers.anchor_stage",
      why: "no rung of the awareness ladder is anchored",
    }),
    locked: held(row.lockedAt, { at: row.lockedAt, source: "client_offers.locked_at", why: "the offer is not locked" }),
    proposedTreatment: row.proposedTreatment,
  }));

  const primaryOffer = offers.find((o) => o.audienceId && o.audienceId === primaryRow?.id) ?? offers[0] ?? null;
  const primaryOfferStored = primaryOffer?.row ?? primaryOfferRow;

  // ── Avatar ───────────────────────────────────────────────────────────────────────────────────
  let brief: Awaited<ReturnType<typeof avatarBriefFor>> = null;
  if (primaryRow?.researchAvatarSlug) {
    try {
      brief = await avatarBriefFor(primaryRow.researchVertical, primaryRow.researchAvatarSlug);
    } catch (e) {
      note("avatar_briefs", e);
    }
  }
  const ownResearch = isHeld(documents.deep_research) ? documents.deep_research.value.content : null;
  const avatar = {
    slug: held(primaryRow?.researchAvatarSlug ?? null, {
      source: "client_audiences.research_avatar_slug",
      why: "no avatar is confirmed, so there is no shared research to read",
    }),
    vertical: held(primaryRow?.researchVertical ?? null, {
      source: "client_audiences.research_vertical",
      why: "no research vertical is set for this audience",
    }),
    // ‼️ THE CLIENT'S OWN RESEARCH OUTRANKS THE SHARED BRIEF, the rule dataset-completeness.ts states:
    // the shared copy can belong to another client, and this audience's answer is about THIS audience.
    research: held(ownResearch ?? brief?.researchText ?? null, {
      source: ownResearch ? "audience_documents:deep_research" : "avatar_briefs.research_text",
      why: "no deep research is on file for this audience or its shared avatar",
    }),
    timesReused: held(brief?.timesReused ?? null, {
      source: "avatar_briefs.times_reused",
      why: "no shared brief exists for this avatar yet",
    }),
  };

  // ── Beliefs and the ladder, read out of documents already loaded ─────────────────────────────
  const beliefsDoc = documents.necessary_beliefs;
  const beliefs: Held<readonly LeadBelief[]> = isHeld(beliefsDoc)
    ? held(readBeliefsParsed(beliefsDoc.value.parsed), {
        at: beliefsDoc.value.createdAt,
        source: `audience_documents:${beliefsDoc.value.id.slice(0, 8)}`,
        why: "the beliefs document is on file but no belief could be parsed out of it",
      })
    : beliefsDoc;

  const ladderDoc = documents.awareness_ladder;
  const ladder: Held<{ rungs: readonly unknown[]; anchoredAt: number | null }> = isHeld(ladderDoc)
    ? held(
        // ‼️ parsed.ladder.rungs, NOT parsed.rungs, AND THE ONE LEVEL WAS A SILENT FAILURE.
        // writeLadder stores `parsed: { ladder, inputs, model }` and ladderState() reads
        // `parsed.ladder.rungs`. This read was one level too shallow, so the only client with an
        // approved five-rung ladder reported it as missing and every card built on it would have
        // asked for a ladder that was already written. Measured on srt-agency-llc, 2026-09-17.
        readLadderParsed(ladderDoc.value.parsed, primaryOfferStored.anchorStage),
        {
          at: ladderDoc.value.createdAt,
          source: `audience_documents:${ladderDoc.value.id.slice(0, 8)}`,
          why: "the ladder document is on file but no rung could be parsed out of it",
        }
      )
    : ladderDoc;

  // ── The board. Derived from rows already read, never written. ────────────────────────────────
  const byKey = new Map(steps.map((s) => [s.key as StepKey, s]));
  const isDone = (k: StepKey) => {
    const s = byKey.get(k);
    return s?.status === "complete" || s?.status === "skipped";
  };

  const leadSteps: LeadStep[] = DELIVERY_STEPS.map((step) => {
    // DELIVERY_STEPS is typed readonly DeliveryStep[], which widens `key` back to string; StepKey is
    // derived from the const array behind it. stepNumber() takes the narrow type, so narrow once here.
    const d = { ...step, key: step.key as StepKey, blockedBy: (step.blockedBy ?? []) as readonly StepKey[] };
    const s = byKey.get(d.key);
    const completedAt = s?.completedAt ?? null;
    const blockedBy = d.blockedBy;
    // A step whose blocker finished AFTER it did produced its output against an older answer. Same
    // predicate reaimStaleDependents() uses; the WRITER is deliberately not reused, only the test.
    const staleAfter = completedAt
      ? blockedBy.filter((b) => {
          const at = byKey.get(b)?.completedAt;
          return Boolean(at && at > completedAt);
        })
      : [];
    return {
      key: d.key,
      number: stepNumber(d.key),
      label: d.label,
      phase: d.phase,
      status: s?.status ?? "pending",
      verifiedSource: s?.verifiedSource ?? null,
      completedAt,
      blockedBy,
      staleAfter,
    };
  });

  const reachable: StepKey[] = [];
  const blocked: Array<{ key: StepKey; on: readonly StepKey[] }> = [];
  for (const step of DELIVERY_STEPS) {
    const dKey = step.key as StepKey;
    if (isDone(dKey)) continue;
    const outstanding = ((step.blockedBy ?? []) as readonly StepKey[]).filter((b) => !isDone(b));
    if (outstanding.length) {
      blocked.push({ key: dKey, on: outstanding });
      continue;
    }
    reachable.push(dKey);
    // One at a time: the walk stops at the first step a person has to do.
    if (step.mode !== "auto") break;
  }

  // ── Lazy slices ──────────────────────────────────────────────────────────────────────────────
  // ‼️ A SLICE NOT ASKED FOR IS `unreadable`, NEVER `missing`. "We did not look" and "it is not there"
  // are different facts, and a card that turned the first into a question would ask for data we hold.
  const notLoaded = (what: string): Held<never> =>
    missing("unreadable", `the ${what} slice was not loaded, so this is unknown rather than absent`);

  let keywords: Held<LeadKeywords> = notLoaded("keywords");
  if (slices.has("keywords")) {
    const loaded = await loadKeywords(clientId);
    if ("error" in loaded) {
      readErrors.push(`client_keywords: ${loaded.error}`);
      keywords = missing("unreadable", `client_keywords could not be read (${loaded.error})`);
    } else {
      const live = loaded.rows.filter((r) => !r.dropped);
      const byRole: Record<string, number> = {};
      const byStage: Record<string, number> = {};
      for (const r of live) {
        const role = r.role ?? "unpicked";
        byRole[role] = (byRole[role] ?? 0) + 1;
        const stage = String(r.awarenessStage ?? "unstaged");
        byStage[stage] = (byStage[stage] ?? 0) + 1;
      }
      const value: LeadKeywords = {
        total: live.length,
        approved: live.filter((r) => r.approved).length,
        byRole,
        byStage,
      };
      // ‼️ client-keywords' OWN fingerprint, not the documents one. They are different functions with
      // the same name: treatment|terms|audience here, treatment|outcome there.
      const current = keywordFingerprint(
        primaryOfferStored.treatment ?? "",
        primaryOfferStored.terms,
        (primaryRow?.stance ?? "patient") as Parameters<typeof keywordFingerprint>[2]
      );
      const drifted = loaded.fingerprints.size > 0 && !loaded.fingerprints.has(current);
      keywords = !live.length
        ? missing("asked_unanswered", "no keyword has been proposed for this client yet")
        : drifted
          ? stale(value, {
              source: "client_keywords.offer_fingerprint",
              why: "they were expanded for a different offer than the one on file now",
            })
          : { state: "present", value, at: null, source: "client_keywords" };
    }
  }

  let pages: Held<readonly LeadPage[]> = notLoaded("pages");
  if (slices.has("pages")) {
    try {
      const { clientPages } = await import("./client-reads");
      const rows = await clientPages(clientId);
      pages = held(
        rows.map((p) => ({ id: p.id, slug: p.slug, title: p.title, status: p.status })),
        { source: "client_pages", why: "no page has been drafted for this client" }
      );
    } catch (e) {
      note("client_pages", e);
      pages = missing("unreadable", "client_pages could not be read");
    }
  }

  let audits: Held<readonly LeadAudit[]> = notLoaded("audits");
  if (slices.has("audits")) {
    try {
      const rows = await auditsForLead({
        clientId,
        domain: who?.ref.domain ?? ref.domain,
        contactId: who?.contactId ?? null,
        limit: 50,
      });
      audits = held(rows, { source: "audit_reports", why: "no audit is on file for this lead, by link or by host" });
    } catch (e) {
      note("audit_reports", e);
      audits = missing("unreadable", "audit_reports could not be read");
    }
  }

  let research: Held<readonly ResearchPull[]> = notLoaded("research");
  if (slices.has("research")) {
    // ‼️ THE ONE TABLE THIS FILE SELECTS FROM. Nothing else reads the paid-pull cache back, which is
    // why there is no reader to call. Measured 2026-09-17: zero rows, because only two of the repo's
    // web-pull sites go through getOrFetch() at all.
    const { data, error } = await supabaseAdmin
      .from("client_datasets")
      .select("id, kind, provider, cost_usd, fetched_at, expires_at, hit_count")
      .eq("client_id", clientId)
      .order("fetched_at", { ascending: false })
      .limit(200);
    if (error) {
      readErrors.push(`client_datasets: ${error.message}`);
      research = missing("unreadable", `client_datasets could not be read (${error.message})`);
    } else {
      const now = Date.now();
      const rows: ResearchPull[] = (data ?? []).map((r) => {
        const expiresAt = (r.expires_at as string | null) ?? null;
        return {
          id: String(r.id),
          kind: String(r.kind),
          provider: (r.provider as string | null) ?? null,
          costUsd: Number(r.cost_usd ?? 0),
          fetchedAt: (r.fetched_at as string | null) ?? null,
          expiresAt,
          expired: Boolean(expiresAt && Date.parse(expiresAt) < now),
          hitCount: Number(r.hit_count ?? 0),
        };
      });
      research = held(rows, { source: "client_datasets", why: "no paid pull has ever been stored for this lead" });
    }
  }

  let history: Held<readonly ClientEventRow[]> = notLoaded("history");
  if (slices.has("history")) {
    try {
      const rows = await readClientEvents({ clientId, limit: 200 });
      history = held(rows, { source: "client_events", why: "nothing has been said or done about this client yet" });
    } catch (e) {
      note("client_events", e);
      history = missing("unreadable", "client_events could not be read");
    }
  }

  let gaps: Held<readonly DatasetReport[]> = notLoaded("gaps");
  if (slices.has("gaps")) {
    try {
      // Everything it would otherwise re-read is handed in. See CompletenessInputs for why that lever
      // exists rather than a second copy of the rules about which offer applies to an option audience.
      const given: CompletenessInputs = {
        audiences: audienceRows,
        primaryOffer: primaryOfferRow,
        offersByAudience,
        ...(docsRead.ok ? { documents: docs } : {}),
      };
      const all = await completenessFor(clientId, given);
      gaps = held(
        all.flatMap((a) => a.reports),
        { source: "dataset-spec", why: "no dataset could be evaluated for this client" }
      );
    } catch (e) {
      note("dataset-completeness", e);
      gaps = missing("unreadable", "the datasets could not be evaluated");
    }
  }

  return {
    clientId,
    loaded: slices,
    readErrors,
    identity: {
      ref,
      name: ref.name,
      domain: held(who?.ref.domain ?? null, { source: "clients.domain", why: "no domain is on file", because: idBecause }),
      website: held(who?.website ?? null, { source: "clients.website", why: "no website is on file", because: idBecause }),
      vertical: held(who?.vertical ?? null, {
        source: "clients.vertical_slug",
        why: "the vertical is not classified",
        because: idBecause,
      }),
      businessType: held(who?.businessType ?? null, {
        source: "clients.business_type",
        why: "the business type is not classified",
        because: idBecause,
      }),
      city: held(who?.city ?? null, { source: "clients.city", why: "no city is on file", because: idBecause }),
      intakeCompletedAt: held(who?.intakeCompletedAt ?? null, {
        source: "clients.intake_completed_at",
        why: "intake is not finished",
        because: idBecause,
      }),
      day0ArchivedAt: held(who?.day0ArchivedAt ?? null, {
        source: "clients.day_0_archived_at",
        why: "Day 0 has not been archived, so nothing may publish",
        because: idBecause,
      }),
    },
    audiences,
    primaryAudience: primary,
    avatar,
    offers,
    primaryOffer,
    documents,
    beliefs,
    ladder,
    keywords,
    pages,
    audits,
    research,
    history,
    gaps,
    board: {
      steps: leadSteps,
      reachable,
      cursor: held(reachable[reachable.length - 1] ?? null, {
        source: "client_delivery_steps",
        why: "every step is done, or every remaining one is blocked",
      }),
      blocked,
    },
  };
}
