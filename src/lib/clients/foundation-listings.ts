// Foundation listings: the board of 138, and the ONE place a submission's words come from.
//
// docs/2026-09-29-offsite.sql is the table. src/config/foundation-platforms.ts is the registry and
// says at length why it is a second registry rather than a tier of presence-platforms.ts.
//
// ─── NOTHING HERE SUBMITS ANYTHING ──────────────────────────────────────────────────────────
//
// ‼️ A SUBMISSION IS ASSERTED AND A LISTING GOING LIVE IS OBSERVED. Those are two different facts
// and the status column keeps them apart:
//
//   missing     nobody has done anything. The seeded state.
//   queued      somebody has claimed the row and is about to fill the form.
//   submitted   a PERSON says they filled it in. We have their word and nothing else.
//   live        a URL came back 200 when we asked. Evidence, with verified_at beside it.
//   rejected    they said no, or the profile was taken down.
//
// The same distinction client_dns_records already draws, and the reason is the same: a board that
// collapsed "I did it" into "it is there" would report a footprint that does not exist, on exactly
// the argument this whole lane rests on. markSubmitted() will never write `live`, and the verifier
// is the only thing that does.
//
// There is no automated form fill and there is not going to be one. Every one of these platforms
// forbids it, a machine-filled listing is the kind of footprint that gets a domain penalised
// rather than cited, and the build this belongs to states flatly that nothing posts to a forum, a
// comment section, or a profile.
//
// ─── THE MESSAGE COMES FROM ONE PLACE ───────────────────────────────────────────────────────
//
// ‼️ describeListing() IS THE ONLY WRITER OF A SUBMISSION'S DESCRIPTION AND NOTHING RETYPES ONE
// PER DIRECTORY. That is not tidiness, it is the argument: an inconsistent footprint teaches the
// engines an inconsistent answer, so 138 directories carrying 138 slightly different descriptions
// of the same business is the failure mode this lane exists to prevent. The source of truth
// already exists, in two halves that are both required:
//
//   offer_locked          treatment, outcome, price, guarantee. Facts a PERSON locked on a call.
//   audience_documents    the `short_offer` document for that audience and offer.
//
// It refuses rather than improvising when either half is missing. A description assembled from an
// unlocked proposal would put a sentence nobody agreed to on 138 third-party domains, where it
// cannot be edited afterwards and where an engine will read it as what the business claims.
//
// ─── THE WEEKLY VERIFIER RIDES AN EXISTING CRON ─────────────────────────────────────────────
//
// ‼️ NO NEW vercel.json ENTRY. vercel.json already carries 17 against a Hobby plan that documents
// 2, which is the reason every weekly job in this repo is a passenger on
// /api/cron/followup-digest. runFoundationListingVerify() is built to that shape: day gated
// inside, never throws into its caller, returns a plain object. report-reminders.ts and
// policy-scan.ts are the two worked examples.
//
// ‼️ THE CALL SITE IN THAT ROUTE IS STILL OWED. The route file is not this lane's to edit, so the
// one line that makes this fire is a separate commit by whoever owns
// src/app/api/cron/followup-digest/route.ts. Until it lands this function is correct and never
// called, which is inert rather than wrong, and it is why the verifier is idempotent on the day
// instead of on a cursor: a first run weeks from now behaves the same as a first run tomorrow.

import { supabaseAdmin } from "@/lib/db";
import { hasBannedDash } from "@/lib/copy-guard";
import {
  FOUNDATION_PLATFORMS,
  FOUNDATION_TYPES,
  SRT_TYPES,
  TYPE_LABELS,
  foundationPlatformByKey,
  foundationPlatformsFor,
  nextBatch,
  totalMinutes,
  type FoundationPlatform,
  type FoundationType,
} from "@/config/foundation-platforms";
import { loadOfferStrict, isLocked, type StoredOffer } from "./offers";
import { currentDocument } from "./audience-documents";
import { notifyThread } from "./delivery-checklist";

const LISTINGS_SQL = "docs/2026-09-29-offsite.sql";

/** The slug SRT's own client row lives under. A slug, never an id: SRT has been re-onboarded twice. */
export const SRT_SLUG = "srt-agency-llc";

export type ListingStatus = "missing" | "queued" | "submitted" | "live" | "rejected";

/**
 * Who a listing belongs to.
 *
 * ‼️ owner_kind IS NOT A NULLABLE client_id AND THE PAIR IS CHECKED IN SQL. `srt` owns no clients
 * row from the table's point of view, so owner_id is null for it and a CHECK enforces the pairing.
 * A nullable client_id would make every per-client query need an `is not null` that somebody
 * eventually forgets.
 *
 * ‼️ SRT IS ALSO A CLIENT ROW, AND BOTH FACTS ARE TRUE AT ONCE. The listing rows are owned by
 * `srt`; the OFFER the description is built from is read off the srt-agency-llc client row like
 * anybody else's. That is what "SRT is itself a client on this board" means, and it is why there is
 * no second description writer for us.
 */
export type ListingOwner =
  | { kind: "client"; clientId: string }
  | { kind: "srt" };

export interface ListingRow {
  id: string;
  ownerKind: "client" | "srt";
  ownerId: string | null;
  platformKey: string;
  status: ListingStatus;
  submittedAt: string | null;
  liveUrl: string | null;
  verifiedAt: string | null;
  costCents: number;
  notes: string | null;
  /** The registry row, or null for a platform_key that has left the registry. */
  platform: FoundationPlatform | null;
}

const COLUMNS =
  "id, owner_kind, owner_id, platform_key, status, submitted_at, live_url, verified_at, cost_cents, notes";

function rowToListing(r: Record<string, unknown>): ListingRow {
  const platformKey = String(r.platform_key);
  return {
    id: String(r.id),
    ownerKind: r.owner_kind === "srt" ? "srt" : "client",
    ownerId: (r.owner_id as string | null) ?? null,
    platformKey,
    status: (r.status as ListingStatus) ?? "missing",
    submittedAt: (r.submitted_at as string | null) ?? null,
    liveUrl: (r.live_url as string | null) ?? null,
    verifiedAt: (r.verified_at as string | null) ?? null,
    costCents: Number(r.cost_cents ?? 0),
    notes: (r.notes as string | null) ?? null,
    platform: foundationPlatformByKey(platformKey) ?? null,
  };
}

function missingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message ?? "");
}

/** The pair of columns that address an owner, in the shape the CHECK constraint wants. */
function ownerFilter(owner: ListingOwner): { owner_kind: string; owner_id: string | null } {
  return owner.kind === "srt"
    ? { owner_kind: "srt", owner_id: null }
    : { owner_kind: "client", owner_id: owner.clientId };
}

/** How an owner reads on a card. */
export function ownerLabel(owner: ListingOwner): string {
  return owner.kind === "srt" ? "SRT" : "this client";
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The description. One writer, and it refuses rather than improvising.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * How many characters of the short offer a directory field will actually take.
 *
 * Most of these forms cap a description somewhere between 200 and 1000 characters and none of them
 * says so before you paste. One length for all 138 is the only way the footprint stays identical,
 * so this is the smallest useful cap rather than the largest possible one, and `long` below carries
 * the untrimmed version for the forms that take it.
 */
const SHORT_MAX = 300;
const LONG_MAX = 1000;

export interface ListingDescription {
  /** One line. The name and what it is, for a form with a 60 to 80 character field. */
  tagline: string;
  /** Up to SHORT_MAX characters. The field almost every directory actually has. */
  short: string;
  /** Up to LONG_MAX characters. For the forms that ask for a paragraph. */
  long: string;
  /** Where each half came from, so a card can say it rather than implying it was written for this form. */
  sources: string[];
  /**
   * What is wrong with the text, NAMED and not silently repaired.
   *
   * A fault does not block anything, because nothing here submits: a person reads the card, sees
   * the fault, and fixes the SOURCE document so all 138 change at once. Repairing it here would
   * fix one paste and leave the short offer saying the wrong thing forever, which is the mistake
   * a stored fault is a frozen verdict already records.
   */
  faults: string[];
}

/** A paragraph, trimmed at a sentence boundary where there is one, so a cut never lands mid word. */
function clipTo(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (lastStop > max * 0.6) return cut.slice(0, lastStop + 1).trim();
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}.`;
}

/**
 * The prose of a short offer document, without its markdown.
 *
 * The framework's short offer is a headed template (Price, Product, and the rest), and pasting the
 * headings into a directory field would read as a form somebody forgot to fill in. Heading lines are
 * dropped and the sentences under them are kept in order.
 *
 * ‼️ EVERY RULE BELOW IS A MEASURED FINDING OFF srt-agency-llc's OWN SHORT OFFER, 2026-09-29, NOT A
 * PRECAUTION. That one document carries all four shapes, and each did visible damage:
 *
 *   `> quoted line`      the field opened with a stray "> ", so every one of 138 listings would have
 *                        started with a markdown character.
 *   `---`                a section rule survived into the middle of the sentence, where it is also
 *                        a BANNED DOUBLE HYPHEN, so the description raised a dash fault about
 *                        punctuation that was never prose. sales-letter.ts records the same false
 *                        positive from the same cause.
 *   `**Label:**`         emphasis around a label whose colon is INSIDE the markers produced
 *                        "Label::" once the markers came off.
 *   `1. numbered`        list numbering read as part of the sentence.
 *
 * Exported so scripts/_probe-foundation-listings.ts pins those four against the real function rather
 * than against a copy of it that would drift.
 */
export function offerProse(shortOfferContent: string): string {
  const lines: string[] = [];

  for (const raw of shortOfferContent.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;

    // A horizontal rule is structure, and it is the one that also trips the dash guard.
    if (/^([-*_])\s*(?:\1\s*){2,}$/.test(line)) continue;
    // An ATX heading.
    if (/^#{1,6}\s/.test(line)) continue;

    line = line
      .replace(/^>+\s*/, "")
      .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/\*\*|__/g, "")
      .trim();

    if (!line) continue;
    // A bare label with nothing after it: the template's own scaffolding.
    if (/^[A-Za-z][A-Za-z0-9 ()/'’-]{0,40}:$/.test(line)) continue;

    lines.push(line);
  }

  return lines
    .join(" ")
    // "Label::" from a colon that sat inside the emphasis markers.
    .replace(/:\s*:+/g, ":")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The words that go in every form, for one client's locked offer.
 *
 * ‼️ REFUSES ON AN UNLOCKED OFFER. effectiveTreatment() would happily hand back a proposal read off
 * an intake form, and this is the one caller that must never take it: a proposal interpolated here
 * ends up on 138 domains as a claim the business made, where nobody can edit it and an engine will
 * quote it back. isLocked() is the gate, exactly as offer-ladder.ts treats a guarantee.
 *
 * ‼️ REFUSES ON A MISSING SHORT OFFER TOO, rather than falling back to the offer fields alone. The
 * fields are a treatment and a price; the short offer is why anyone should care. A footprint built
 * from the fields alone would be 138 identical stubs, which is a consistent message and not a
 * useful one.
 */
export async function describeListing(
  clientId: string
): Promise<{ ok: true; description: ListingDescription } | { ok: false; error: string }> {
  const loaded = await loadOfferStrict(clientId);
  if (!loaded.ok) return { ok: false, error: `the offer could not be read: ${loaded.error}` };

  const offer = loaded.offer;
  if (!isLocked(offer)) {
    return {
      ok: false,
      error:
        "no offer is locked for this client, so there is nothing to say on 138 directories. " +
        "A proposal read off the intake form is not an answer: lock the offer at step `offer_locked` first.",
    };
  }
  if (!offer.audienceId || !offer.id) {
    return {
      ok: false,
      error:
        "the locked offer has no audience or no offer row, so its short offer document cannot be addressed. " +
        "That is an offer stored on the deprecated clients.offer mirror; re-lock it on the audience.",
    };
  }

  const doc = await currentDocument({ audienceId: offer.audienceId, offerId: offer.id, kind: "short_offer" });
  if (!doc.ok) return { ok: false, error: doc.error };
  if (!doc.doc || !doc.doc.content.trim()) {
    return {
      ok: false,
      error:
        "no short offer document is on file for this audience and offer. Every submission's description " +
        "is built from it, so writing 138 of them by hand is the thing being refused, not the fallback.",
    };
  }

  const { name } = await clientName(clientId);
  const prose = offerProse(doc.doc.content);
  const description = assembleDescription({ name, offer, prose, docStatus: doc.doc.status });
  return { ok: true, description };
}

/**
 * The assembly itself, pure, so the probe can exercise it without a database.
 *
 * Exported for exactly that reason and for no other: everything in the application calls
 * describeListing(), which is the half that reads the two sources of truth.
 */
export function assembleDescription(args: {
  name: string;
  offer: Pick<StoredOffer, "treatment" | "outcomePromise" | "price" | "guarantee" | "positioning">;
  prose: string;
  docStatus?: "draft" | "approved";
}): ListingDescription {
  const { name, offer, prose } = args;
  const treatment = (offer.treatment ?? "").trim();

  const tagline = clipTo(
    offer.outcomePromise ? `${name}: ${treatment} for ${offer.outcomePromise}.` : `${name}: ${treatment}.`,
    80
  );

  // The offer's own facts, in a fixed order, so two directories never disagree about the price.
  const facts: string[] = [];
  if (offer.outcomePromise) facts.push(`What it is for: ${offer.outcomePromise}.`);
  if (offer.price) facts.push(`Price: ${offer.price}.`);
  if (offer.guarantee) facts.push(`Guarantee: ${offer.guarantee}.`);

  const body = [prose, ...facts].filter(Boolean).join(" ");
  const short = clipTo(body || tagline, SHORT_MAX);
  const long = clipTo(body || tagline, LONG_MAX);

  const sources = [
    "offer_locked: the treatment, and whichever of outcome, price and guarantee are on file",
    args.docStatus === "approved"
      ? "audience_documents.short_offer, approved"
      : "audience_documents.short_offer, still a DRAFT",
  ];

  const faults: string[] = [];
  // ‼️ NAMED, NOT REPAIRED. The dash is in the short offer document, which is where it has to be
  // fixed: stripping it here would leave the document wrong and every future paste wrong with it.
  if (hasBannedDash(long)) {
    faults.push(
      "the short offer contains an em dash, en dash or a double hyphen, which SRT copy does not use. " +
        "Fix the short offer document, not the paste."
    );
  }
  if (!offer.outcomePromise) faults.push("no outcome is on the offer, so the description says what it is and not what it is for.");
  if (!offer.price) faults.push("no price is on the offer. Some directories have a required pricing field.");
  if (args.docStatus === "draft") {
    faults.push("the short offer is a draft. Approving it before 138 copies of it go out is the cheaper order.");
  }
  if (prose.length < 80) {
    faults.push("the short offer's prose is under 80 characters once its headings are dropped, which is thin for a directory field.");
  }

  return { tagline, short, long, sources, faults };
}

/** The client's display name, for the tagline. */
async function clientName(clientId: string): Promise<{ name: string }> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name")
    .eq("id", clientId)
    .maybeSingle();
  const name =
    ((data?.dba_name as string | null) || (data?.legal_name as string | null) || "").trim() || "this business";
  return { name };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The board
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Put a `missing` row on the board for every platform this owner belongs on.
 *
 * ‼️ THE TYPES ARE PASSED IN AND THIS FUNCTION NEVER GUESSES THEM FOR A CLIENT. An empty list is
 * refused rather than read as "all of them", because "all of them" is how a med spa lands on an AI
 * tool directory, and a silent default is worse than a refusal a person can answer. SRT's own types
 * are SRT_TYPES in the registry, which is allowed to be a constant because there is exactly one SRT.
 *
 * ‼️ A CLIENT'S TYPES HAVE NOWHERE TO LIVE YET AND THAT IS STATED RATHER THAN WORKED AROUND. The
 * natural home is a column beside client_audiences.presence_platform_keys, which is the same shape
 * for the same reason; adding it is a migration and this build writes no SQL. Until it exists, a
 * client board is opened by a person naming the types, which is the honest version of the same
 * decision.
 *
 * Idempotent. listing_submissions has a unique index on (owner_kind, coalesce(owner_id, ''),
 * platform_key), so a second run inserts nothing and CANNOT reset a row somebody has already
 * advanced to `submitted`.
 */
export async function seedListings(args: {
  owner: ListingOwner;
  types: readonly string[];
}): Promise<
  | { ok: true; seeded: number; already: number; platforms: number; unknownTypes: string[] }
  | { ok: false; error: string }
> {
  const { platforms, unknown } = foundationPlatformsFor(args.types);
  if (unknown.length) {
    return {
      ok: false,
      error: `these are not platform types: ${unknown.join(", ")}. The seven are ${FOUNDATION_TYPES.join(", ")}.`,
    };
  }
  if (!platforms.length) {
    return {
      ok: false,
      error:
        "no platform types were named, so there is nothing to seed. Naming none is not the same as naming all: " +
        `the seven are ${FOUNDATION_TYPES.join(", ")}.`,
    };
  }

  const existing = await loadListings(args.owner);
  if (!existing.ok) return { ok: false, error: existing.error };
  const have = new Set(existing.rows.map((r) => r.platformKey));

  const toInsert = platforms.filter((p) => !have.has(p.key));
  if (!toInsert.length) {
    return { ok: true, seeded: 0, already: platforms.length, platforms: platforms.length, unknownTypes: [] };
  }

  const owner = ownerFilter(args.owner);
  const { error } = await supabaseAdmin.from("listing_submissions").insert(
    toInsert.map((p) => ({
      ...owner,
      platform_key: p.key,
      status: "missing" as const,
      // The registry's cost, copied at seed time so a board totals what it actually cost rather
      // than what the registry says today. A platform that starts charging must not rewrite history.
      cost_cents: p.costCents,
    }))
  );

  if (error) {
    if (missingTable(error)) return { ok: false, error: `run ${LISTINGS_SQL} on this database first.` };
    return { ok: false, error: `the listings could not be seeded: ${error.message}` };
  }

  return {
    ok: true,
    seeded: toInsert.length,
    already: platforms.length - toInsert.length,
    platforms: platforms.length,
    unknownTypes: [],
  };
}

/** Every row on one owner's board. */
export async function loadListings(
  owner: ListingOwner
): Promise<{ ok: true; rows: ListingRow[] } | { ok: false; error: string }> {
  const f = ownerFilter(owner);
  let query = supabaseAdmin.from("listing_submissions").select(COLUMNS).eq("owner_kind", f.owner_kind);
  query = f.owner_id === null ? query.is("owner_id", null) : query.eq("owner_id", f.owner_id);

  const { data, error } = await query;
  if (error) {
    if (missingTable(error)) return { ok: false, error: `run ${LISTINGS_SQL} on this database first.` };
    return { ok: false, error: `listing_submissions is unreadable: ${error.message}` };
  }
  return { ok: true, rows: (data ?? []).map((r) => rowToListing(r as Record<string, unknown>)) };
}

export interface ListingCounts {
  missing: number;
  queued: number;
  submitted: number;
  live: number;
  rejected: number;
  total: number;
  /** Rows whose platform_key is no longer in the registry. Named rather than counted as live work. */
  orphaned: number;
  /** Cents actually spent, from the rows, not from the registry. */
  spentCents: number;
}

export function countListings(rows: readonly ListingRow[]): ListingCounts {
  const counts: ListingCounts = {
    missing: 0,
    queued: 0,
    submitted: 0,
    live: 0,
    rejected: 0,
    total: rows.length,
    orphaned: 0,
    spentCents: 0,
  };
  for (const r of rows) {
    counts[r.status] += 1;
    if (!r.platform) counts.orphaned += 1;
    // Only what was actually done. A `missing` row's seeded cost has not been spent.
    if (r.status === "submitted" || r.status === "live") counts.spentCents += r.costCents;
  }
  return counts;
}

/**
 * Advance one row.
 *
 * ‼️ THIS FUNCTION CANNOT WRITE `live` AND THE REFUSAL IS THE POINT. `live` means a URL answered
 * when we asked it, so only markLive() below, called by the verifier or by a person pasting a URL
 * that is then checked, may set it. A person saying "it is up" is `submitted`.
 */
export async function setListingStatus(args: {
  owner: ListingOwner;
  platformKey: string;
  status: Exclude<ListingStatus, "live">;
  notes?: string | null;
}): Promise<{ ok: true; row: ListingRow } | { ok: false; error: string }> {
  if (!foundationPlatformByKey(args.platformKey)) {
    return { ok: false, error: `there is no platform called "${args.platformKey}" in the registry.` };
  }

  const patch: Record<string, unknown> = { status: args.status, updated_at: new Date().toISOString() };
  // submitted_at is when a person said they did it, and it is never cleared by a later status: the
  // date they filled the form is still true if the platform rejects it a week later.
  if (args.status === "submitted") patch.submitted_at = new Date().toISOString();
  if (args.notes !== undefined) patch.notes = args.notes;

  return applyPatch(args.owner, args.platformKey, patch);
}

/**
 * Record that a listing is live, with the URL that proves it.
 *
 * ‼️ verified_at IS WRITTEN HERE AND ONLY WITH A URL. The two columns travel together: a verified_at
 * without a live_url is a timestamp on nothing, and a live_url without a verified_at is a link
 * nobody has opened. Both or neither.
 */
export async function markLive(args: {
  owner: ListingOwner;
  platformKey: string;
  liveUrl: string;
  notes?: string | null;
}): Promise<{ ok: true; row: ListingRow } | { ok: false; error: string }> {
  const url = (args.liveUrl ?? "").trim();
  if (!/^https?:\/\/\S+\.\S+/i.test(url)) {
    return { ok: false, error: `"${url}" is not a URL, and a live listing is only ever recorded with one.` };
  }
  if (!foundationPlatformByKey(args.platformKey)) {
    return { ok: false, error: `there is no platform called "${args.platformKey}" in the registry.` };
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: "live",
    live_url: url,
    verified_at: now,
    updated_at: now,
  };
  if (args.notes !== undefined) patch.notes = args.notes;
  return applyPatch(args.owner, args.platformKey, patch);
}

async function applyPatch(
  owner: ListingOwner,
  platformKey: string,
  patch: Record<string, unknown>
): Promise<{ ok: true; row: ListingRow } | { ok: false; error: string }> {
  const f = ownerFilter(owner);
  let query = supabaseAdmin
    .from("listing_submissions")
    .update(patch)
    .eq("owner_kind", f.owner_kind)
    .eq("platform_key", platformKey);
  query = f.owner_id === null ? query.is("owner_id", null) : query.eq("owner_id", f.owner_id);

  const { data, error } = await query.select(COLUMNS).maybeSingle();
  if (error) {
    if (missingTable(error)) return { ok: false, error: `run ${LISTINGS_SQL} on this database first.` };
    return { ok: false, error: `the listing could not be updated: ${error.message}` };
  }
  if (!data) {
    return {
      ok: false,
      error: `${ownerLabel(owner)} has no board row for "${platformKey}". Seed the board before advancing a row on it.`,
    };
  }
  return { ok: true, row: rowToListing(data as Record<string, unknown>) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The card
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What the board looks like, in Slack markup.
 *
 * Reports the description's faults rather than hiding them, and prints the next batch with the
 * submit URL beside each row, because runner v3's rule holds here too: never "submit the listing",
 * always the exact address to open.
 */
export function formatListingCard(args: {
  owner: ListingOwner;
  rows: readonly ListingRow[];
  types: readonly FoundationType[];
  description: ListingDescription | null;
  descriptionError?: string | null;
  batchSize?: number;
}): string {
  const counts = countListings(args.rows);
  const eligible = foundationPlatformsFor(args.types).platforms;
  const started = new Set(args.rows.filter((r) => r.status !== "missing").map((r) => r.platformKey));

  const lines: string[] = [];
  lines.push(
    `:card_index_dividers: *Foundation listings for ${ownerLabel(args.owner)}.* ` +
      `${counts.total} on the board of ${eligible.length} eligible, out of ${FOUNDATION_PLATFORMS.length} in the registry.`
  );
  lines.push(
    `${counts.live} live, ${counts.submitted} submitted and waiting, ${counts.queued} queued, ` +
      `${counts.missing} not started, ${counts.rejected} rejected.`
  );
  if (counts.spentCents > 0) lines.push(`Spent so far: $${(counts.spentCents / 100).toFixed(2)}.`);
  if (counts.orphaned > 0) {
    lines.push(
      `:warning: ${counts.orphaned} row${counts.orphaned === 1 ? "" : "s"} name a platform that has left the registry. ` +
        `They are counted above and cannot be worked.`
    );
  }

  lines.push("", "*Per group*");
  for (const type of args.types) {
    const keys = new Set(eligible.filter((p) => p.type === type).map((p) => p.key));
    if (!keys.size) continue;
    const mine = args.rows.filter((r) => keys.has(r.platformKey));
    const live = mine.filter((r) => r.status === "live").length;
    lines.push(`• *${TYPE_LABELS[type]}*: ${live} live of ${keys.size}`);
  }

  lines.push("", "*The description every one of them gets*");
  if (args.description) {
    lines.push(`> ${args.description.tagline}`);
    lines.push(`> ${args.description.short}`);
    lines.push(`_From ${args.description.sources.join("; ")}._`);
    for (const f of args.description.faults) lines.push(`:warning: ${f}`);
  } else {
    lines.push(
      `:no_entry: There is no description yet, so nothing should be submitted. ${args.descriptionError ?? ""}`.trim()
    );
  }

  const batch = nextBatch(eligible, started, args.batchSize ?? 10);
  if (batch.length) {
    lines.push("", `*Next ${batch.length}*, strongest domain first, about ${totalMinutes(batch)} minutes all in.`);
    for (const p of batch) {
      const bits = [`DR ~${p.dr}`, `${p.minutes}m`];
      if (p.needsAccount) bits.push("account first");
      if (p.costCents > 0) bits.push(`$${(p.costCents / 100).toFixed(2)}`);
      lines.push(`• *${p.label}* (${bits.join(", ")}) ${p.submitUrl}`);
      if (p.note) lines.push(`    _${p.note}_`);
    }
  } else if (eligible.length) {
    lines.push("", "Every eligible platform has been started. Nothing is waiting on a submission.");
  }

  lines.push(
    "",
    "_Nothing here submits anything. Fill the form, then say so: a submission is asserted and a live listing is observed._"
  );
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The weekly verifier
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The day it runs, 0 being Sunday. Monday, so a vanished listing is on the week's board.
 *
 * Deliberately not Thursday: four weekly passengers already ride that day on this cron and a fifth
 * would make one slow HTTP sweep the reason the whole digest times out.
 */
const VERIFY_WEEKDAY = 1;

/** How many live rows one weekly run will re-check. A bound, so the digest cannot be the thing that breaks. */
const VERIFY_LIMIT = 60;

export interface VanishedListing {
  ownerKind: "client" | "srt";
  ownerId: string | null;
  platformKey: string;
  label: string;
  liveUrl: string;
  /** What actually happened: a status code, or the transport error. */
  reason: string;
}

export interface VerifyResult {
  checked: number;
  stillLive: number;
  vanished: VanishedListing[];
  /** Why nothing ran, when nothing ran. Null on a real run. */
  skipped: string | null;
}

/**
 * Re-check every live listing and flag the ones that went away.
 *
 * ‼️ A PASSENGER ON /api/cron/followup-digest, NOT AN EIGHTEENTH CRON. See the header.
 *
 * ‼️ A VANISHED LISTING IS THE SAME CLASS OF FACT AS A NAP MISMATCH AND IS REPORTED THE SAME WAY:
 * into the client's own ops thread, through notifyThread(), which is where presence findings land.
 * SRT's own rows have no client thread, so they go to #alerts-infra where every ops-level finding
 * already goes.
 *
 * ‼️ IT MOVES A ROW TO `rejected` RATHER THAN DELETING IT OR SILENTLY REWRITING verified_at. The
 * row's history is the point: "was live on the 3rd, gone on the 24th" is the finding, and a row
 * that quietly went back to `missing` would read as work nobody ever did.
 *
 * A transport failure is NOT a vanished listing. A timeout, a DNS blip or a 429 says something
 * about the network and nothing about the listing, so only a hard 404 or 410 counts. The rest are
 * left alone to be re-checked next week, which is the same judgement runAutomatedSweep makes about
 * a platform that would not load.
 */
export async function runFoundationListingVerify(
  opts: { dry?: boolean; force?: boolean } = {}
): Promise<VerifyResult> {
  const empty: VerifyResult = { checked: 0, stillLive: 0, vanished: [], skipped: null };

  if (!opts.force && new Date().getUTCDay() !== VERIFY_WEEKDAY) {
    return { ...empty, skipped: "not the verify weekday" };
  }

  const { data, error } = await supabaseAdmin
    .from("listing_submissions")
    .select(COLUMNS)
    .eq("status", "live")
    .not("live_url", "is", null)
    // Oldest verification first, so a bounded run always makes progress through the board.
    .order("verified_at", { ascending: true, nullsFirst: true })
    .limit(VERIFY_LIMIT);

  if (error) {
    if (missingTable(error)) return { ...empty, skipped: `${LISTINGS_SQL} has not been run` };
    return { ...empty, skipped: `listing_submissions is unreadable: ${error.message}` };
  }

  const rows = (data ?? []).map((r) => rowToListing(r as Record<string, unknown>));
  if (!rows.length) return { ...empty, skipped: "no live listings to re-check" };

  const vanished: VanishedListing[] = [];
  let stillLive = 0;
  const now = new Date().toISOString();

  for (const row of rows) {
    if (!row.liveUrl) continue;
    const check = await checkUrl(row.liveUrl);

    if (check.kind === "gone") {
      vanished.push({
        ownerKind: row.ownerKind,
        ownerId: row.ownerId,
        platformKey: row.platformKey,
        label: row.platform?.label ?? row.platformKey,
        liveUrl: row.liveUrl,
        reason: check.reason,
      });
      if (!opts.dry) {
        await supabaseAdmin
          .from("listing_submissions")
          .update({
            status: "rejected",
            // verified_at is the last time anybody LOOKED, which is now, and this is the look that
            // found it gone. Leaving the old value would say nobody had checked since it worked.
            verified_at: now,
            updated_at: now,
            notes: appendNote(row.notes, `${now.slice(0, 10)}: gone, ${check.reason}. Was live at ${row.liveUrl}`),
          })
          .eq("id", row.id);
      }
      continue;
    }

    if (check.kind === "live") {
      stillLive += 1;
      if (!opts.dry) {
        await supabaseAdmin
          .from("listing_submissions")
          .update({ verified_at: now, updated_at: now })
          .eq("id", row.id);
      }
    }
    // check.kind === "unknown": the network said nothing useful. Left exactly as it was, so the
    // oldest-first ordering brings it back next week.
  }

  if (!opts.dry && vanished.length) await reportVanished(vanished);

  return { checked: rows.length, stillLive, vanished, skipped: null };
}

/** One more line on the notes, never a replacement. The history is what makes a vanished listing legible. */
function appendNote(existing: string | null, line: string): string {
  const prior = (existing ?? "").trim();
  return prior ? `${prior}\n${line}` : line;
}

type UrlCheck =
  | { kind: "live" }
  /** A hard answer that the page is not there. Only 404 and 410 qualify. */
  | { kind: "gone"; reason: string }
  /** The network said nothing about the listing. Not a finding. */
  | { kind: "unknown"; reason: string };

/**
 * Is this listing still there?
 *
 * ‼️ ONLY 404 AND 410 COUNT AS GONE. A 403 is a bot wall, a 429 is rate limiting and a 5xx is their
 * outage: reporting any of those as a vanished listing would send somebody to re-submit a profile
 * that is sitting there perfectly fine, which is worse than missing a real one for a week.
 *
 * GET rather than HEAD, because several of these directories answer HEAD with a 405 and a GET with
 * a 200, and a 405 read as "gone" is the same false finding by a different route.
 */
async function checkUrl(url: string): Promise<UrlCheck> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "SRT-listing-verifier/1.0 (+https://srtagency.com)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404 || res.status === 410) return { kind: "gone", reason: `HTTP ${res.status}` };
    if (res.ok) return { kind: "live" };
    return { kind: "unknown", reason: `HTTP ${res.status}` };
  } catch (e) {
    return { kind: "unknown", reason: (e as Error).message };
  }
}

/**
 * Tell whoever owns the listing, in the place that owner's findings already go.
 *
 * Grouped by owner so a client with three vanished listings gets one message rather than three,
 * and every call is caught: a verifier that cannot post must not take the follow-up digest down.
 */
async function reportVanished(vanished: readonly VanishedListing[]): Promise<void> {
  const byOwner = new Map<string, VanishedListing[]>();
  for (const v of vanished) {
    const key = v.ownerKind === "srt" ? "srt" : `client:${v.ownerId}`;
    const list = byOwner.get(key) ?? [];
    list.push(v);
    byOwner.set(key, list);
  }

  for (const [key, list] of byOwner) {
    const body = [
      `:broken_heart: *${list.length} foundation listing${list.length === 1 ? "" : "s"} went away.*`,
      "A listing that vanished is the same class of finding as a NAP mismatch: the footprint says something different today than it said last week.",
      "",
      ...list.map((v) => `• *${v.label}*: ${v.reason}. Was at ${v.liveUrl}`),
      "",
      "_Each row is now `rejected` with the date on its notes. Re-submitting is a decision, not an automatic retry._",
    ].join("\n");

    if (key === "srt") {
      const { postInfraAlert } = await import("@/lib/alerts");
      await postInfraAlert(body).catch((e) =>
        console.error("[foundation-listings] SRT vanish report failed:", (e as Error).message)
      );
      continue;
    }

    const clientId = list[0]?.ownerId;
    if (!clientId) continue;
    await notifyThread(clientId, body).catch((e) =>
      console.error("[foundation-listings] client vanish report failed:", (e as Error).message)
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SRT's own board, for the ops workflow
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface SrtBoardResult {
  seeded: number;
  already: number;
  counts: ListingCounts;
  card: string;
}

/**
 * Open or refresh SRT's own board and return the card for it.
 *
 * ‼️ owner_kind IS `srt` AND THE OFFER IS READ OFF THE srt-agency-llc CLIENT ROW. Both halves are
 * deliberate and they are the reason there is not a second system for us: the listing rows cannot
 * live in the client registry (client_workflow_runs.client_id is NOT NULL, so an ops run stored
 * there is invisible to workflowRuns()), while the WORDS come from the same offer_locked and
 * short_offer machinery every client's do.
 *
 * ‼️ BY SLUG, NEVER BY A WRITTEN-DOWN ID. SRT has been re-onboarded twice, so every id for it
 * recorded anywhere in this repo is dead. resolveClient() states the same rule.
 *
 * A missing description does not stop the board being opened: knowing which 116 rows are waiting is
 * useful, and the card says in as many words that nothing should be submitted until the offer and
 * the short offer are both on file.
 */
export async function openSrtListingBoard(): Promise<
  { ok: true; result: SrtBoardResult } | { ok: false; error: string }
> {
  const { resolveClient } = await import("./client-reads");
  const found = await resolveClient(SRT_SLUG);
  if (!found.ok) {
    return {
      ok: false,
      error: `SRT's own client row could not be found by slug "${SRT_SLUG}": ${found.error}`,
    };
  }

  const owner: ListingOwner = { kind: "srt" };
  const seeded = await seedListings({ owner, types: SRT_TYPES });
  if (!seeded.ok) return { ok: false, error: seeded.error };

  const loaded = await loadListings(owner);
  if (!loaded.ok) return { ok: false, error: loaded.error };

  const described = await describeListing(found.client.id);
  const card = formatListingCard({
    owner,
    rows: loaded.rows,
    types: SRT_TYPES,
    description: described.ok ? described.description : null,
    descriptionError: described.ok ? null : described.error,
  });

  return {
    ok: true,
    result: {
      seeded: seeded.seeded,
      already: seeded.already,
      counts: countListings(loaded.rows),
      card,
    },
  };
}
