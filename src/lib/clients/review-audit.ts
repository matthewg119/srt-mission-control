// The review audit — delivery step 9, Runner v3 section 8 / SOP 2.2.
// (Step 8 as of 2026-08-25 the avatar sits above it; the KEY is unchanged, only the number.)
//
// Per review-bearing platform, for this client AND each of the three competitors picked at
// step 7: total reviews, average rating, date of the most recent one, how often the owner
// replies, and the themes in the negatives. It is findings section 3.
//
// ‼️ THIS STEP IS auto_then_manual, AND IT WAS DECLARED PLAIN `auto`. THAT WAS THE BUG.
//
// src/config/presence-platforms.ts records `api: false` on all nineteen platforms, and its
// header documents that Google Places, Bing Maps, Foursquare and Yelp Fusion were each checked
// on 2026-08-18 with no key available in this environment. Runner v3's own how-to-work section
// says the same thing in one line: "Presence-sweep keys: none."
//
// So there is no automated path to a review count, and there was never going to be one on this
// step's own terms. Ticking it as `auto` would mark a MEASUREMENT complete that measured
// nothing, and findings section 3 — a document that goes to the client — would print a
// placeholder table under a checklist claiming the review audit was done.
//
// What this runner does instead is the honest half: seed the capture rows, compose the exact
// search string for every subject on every platform, and post the card. A person fills the
// numbers in. That is exactly the shape `nap_sweep` already has, for exactly the same reason.
//
// ‼️ SEEDED ROWS READ "NOT RECORDED", NEVER ZERO.
// Zero reviews and un-checked are opposite claims about a business, and the one place that
// distinction gets destroyed is a nullable integer defaulted to 0. review_count stays NULL
// until somebody types a number.
//
// ‼️ NO MODEL WRITES "THEMES IN THE NEGATIVES" IN V1.
// It is the obvious place to put a Claude call and it is the wrong place. That sentence lands
// verbatim in a client-facing PDF, and a hallucinated theme in that document cannot be walked
// back. A person types what they read.

import { supabaseAdmin } from "@/lib/db";
import { ALL_PLATFORMS, platformByKey, type PresencePlatform } from "@/config/presence-platforms";
import { selectedCompetitors, REQUIRED_SELECTIONS } from "./competitors";
import { canonicalFor } from "./presence-sweep";
import { normalizeNameForCompare, stripEntitySuffix } from "./nap-compare";
import type { ReviewRead } from "./review-read";

/**
 * The platforms that actually carry public reviews.
 *
 * ‼️ MATTHEW'S FOUR, 2026-08-25: Google, Yelp, Trustpilot, BBB. RealSelf and Facebook LEFT this
 * grid and stayed in the presence sweep. They are still swept, still on the citation cleanup
 * list, still in findings section 2. What changed is that nobody is asked to read a review
 * count off them.
 *
 * ‼️ IT IS AN EXPLICIT KEY LIST OVER ALL_PLATFORMS, NOT A FILTER OF CORE_SIX, AND THAT IS A
 * MECHANICAL NECESSITY RATHER THAN A STYLE CHOICE. Trustpilot and BBB are EXTENDED rows. A
 * CORE_SIX.filter() would silently return two platforms instead of four, and the review grid
 * would come out half the size it should be with nothing to say why.
 *
 * The tiers are untouched by this. Being in the review grid is not a promotion: what tier a
 * platform sits in decides what week-one cleanup means in a document a client reads, and this
 * list decides nothing except who gets asked for a number.
 */
export const REVIEW_PLATFORM_KEYS: readonly string[] = ["google", "yelp", "trustpilot", "bbb"];

export const REVIEW_PLATFORMS: PresencePlatform[] = REVIEW_PLATFORM_KEYS.map((k) =>
  ALL_PLATFORMS.find((p) => p.key === k)
).filter((p): p is PresencePlatform => Boolean(p));


export interface ReviewAuditRow {
  id: string;
  subjectType: "client" | "competitor";
  competitorId: string | null;
  subjectName: string;
  platform: string;
  reviewCount: number | null;
  averageRating: number | null;
  mostRecentReviewAt: string | null;
  ownerResponseRate: number | null;
  negativeThemes: string[];
  checkedBy: string | null;
  checkedAt: string | null;
  /**
   * What a screenshot was READ as, waiting for a person to confirm it.
   *
   * ‼️ THIS IS NOT THE ANSWER AND MUST NEVER BE READ AS ONE. Runner v3 section 6: the tool
   * proposes, a person confirms. isRecorded() ignores it entirely, findings section 3 ignores
   * it, and the only thing that turns a proposal into a record is applyProposedReadings, which
   * runs from one button press.
   */
  proposed: ProposedReading | null;
  /** Where the proposal came from. Today always `screenshot` when set. */
  proposedSource: string | null;
  listingUrl: string | null;
  screenshotRef: string | null;
}

/**
 * One screenshot, read.
 *
 * ‼️ NO negativeThemes FIELD, DELIBERATELY, AND IT MUST NOT ACQUIRE ONE. Four of the five
 * things this grid holds are transcription and one is a summary. The summary is typed by a
 * person or it stays empty. See review-read.ts.
 *
 * ownerRepliesInLastTen is stored as the COUNT that was read, not as the rate the row holds.
 * The conversion to owner_response_rate happens once, on confirm, so what is stored as a
 * proposal is exactly what somebody can check against the picture.
 */
export interface ProposedReading {
  reviewCount: number | null;
  averageRating: number | null;
  mostRecentReviewAt: string | null;
  ownerRepliesInLastTen: number | null;
  listingUrl: string | null;
  /** client_docs.storage_ref for the screenshot this came off. The evidence, kept. */
  screenshotRef: string | null;
  /** The reader's own phrase for what it was looking at. */
  evidence: string;
  readAt: string;
}

/** A row nobody has filled in yet. The whole point of the tri-state. */
export function isRecorded(row: ReviewAuditRow): boolean {
  return row.checkedAt !== null && row.reviewCount !== null;
}

/**
 * Seed one row per subject per review platform.
 *
 * Idempotent, the same way seedPresenceSweep is: upsert with ignoreDuplicates, so re-running
 * adds rows for a competitor picked later without resetting a number a human already typed.
 *
 * ‼️ Called from BOTH the runner and step-engine's instructionsFor, because once this step is
 * `auto_then_manual` either path can post the card first. Same precedent as competitor_shortlist
 * calling buildShortlist from inside instructionsFor.
 */
export async function seedReviewAudit(
  clientId: string
): Promise<{ ok: boolean; seeded: number; competitors: number; error?: string }> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, seeded: 0, competitors: 0, error: "Client not found." };

  const clientName = (client.dba_name || client.legal_name || "Client") as string;
  const competitors = await selectedCompetitors(clientId);

  const subjects: Array<{ type: "client" | "competitor"; id: string | null; name: string }> = [
    { type: "client", id: null, name: clientName },
    ...competitors.map((c) => ({ type: "competitor" as const, id: c.id, name: c.name })),
  ];

  const rows = subjects.flatMap((s) =>
    REVIEW_PLATFORMS.map((p) => ({
      client_id: clientId,
      subject_type: s.type,
      competitor_id: s.id,
      subject_name: s.name,
      platform: p.key,
      source: "manual",
    }))
  );

  const { error } = await supabaseAdmin
    .from("review_audit_rows")
    .upsert(rows, { onConflict: "client_id,subject_type,competitor_key,platform", ignoreDuplicates: true });

  if (error) return { ok: false, seeded: 0, competitors: competitors.length, error: error.message };

  return { ok: true, seeded: rows.length, competitors: competitors.length };
}

export async function loadReviewAudit(clientId: string): Promise<ReviewAuditRow[]> {
  const { data } = await supabaseAdmin
    .from("review_audit_rows")
    .select(
      "id, subject_type, competitor_id, subject_name, platform, review_count, average_rating, most_recent_review_at, owner_response_rate, negative_themes, checked_by, checked_at, proposed, proposed_source, listing_url, screenshot_ref"
    )
    .eq("client_id", clientId);

  return (data ?? []).map((d) => ({
    id: d.id as string,
    subjectType: d.subject_type as "client" | "competitor",
    competitorId: (d.competitor_id as string | null) ?? null,
    subjectName: (d.subject_name as string) ?? "",
    platform: d.platform as string,
    reviewCount: (d.review_count as number | null) ?? null,
    averageRating: (d.average_rating as number | null) ?? null,
    mostRecentReviewAt: (d.most_recent_review_at as string | null) ?? null,
    ownerResponseRate: (d.owner_response_rate as number | null) ?? null,
    negativeThemes: (d.negative_themes as string[] | null) ?? [],
    checkedBy: (d.checked_by as string | null) ?? null,
    checkedAt: (d.checked_at as string | null) ?? null,
    proposed: (d.proposed as ProposedReading | null) ?? null,
    proposedSource: (d.proposed_source as string | null) ?? null,
    listingUrl: (d.listing_url as string | null) ?? null,
    screenshotRef: (d.screenshot_ref as string | null) ?? null,
  }));
}

/**
 * The capture card. Runner v3 section 3: the exact string to search, never "check the reviews".
 *
 * Modelled line for line on formatSweepCard, because the person doing this is copying and
 * pasting rather than deciding anything, and two cards for the same kind of work should not
 * read differently.
 *
 * ‼️ COMPETITORS ARE OPTIONAL AND THE CLIENT IS NOT. Matthew: "Review audit is good for the
 * customer but not neccesary for competitors, so make that optional, not for the subject
 * clients reviews, those we need to pull at least 1." The competitor rows are still SEEDED,
 * because they are the work list and findings section 3 is built from them when they are
 * filled, and they never block the step. The card says which is which in one line rather than
 * leaving somebody to discover it at the refusal.
 */
export function formatReviewAuditCard(args: {
  clientName: string;
  city: string;
  state: string;
  competitors: Array<{ name: string }>;
  rows: ReviewAuditRow[];
}): string {
  const inGrid = args.rows.filter((r) => REVIEW_PLATFORM_KEYS.includes(r.platform));
  const recorded = inGrid.filter(isRecorded).length;
  const proposed = inGrid.filter((r) => r.proposed !== null && !isRecorded(r)).length;
  const total = inGrid.length;

  const lines: string[] = [
    `*Review audit — ${recorded} of ${total} recorded${proposed ? `, ${proposed} proposed and waiting for you` : ""}*`,
    "No review provider is keyed (Google Places, Yelp Fusion, Foursquare all unkeyed), so every",
    "one of these is a manual read. Read-only, official pages only. Never a scrape.",
    "",
    "*Drop the screenshots in this thread and the numbers come off them.* Count, rating, date of",
    "the most recent one and how many of the last ten got an owner reply are all transcription,",
    "so they are read off the picture and land as a PROPOSAL. One tap on [Confirm these readings]",
    "writes them. Nothing is recorded until you tap it.",
    "",
    "*The themes in the negatives are the one thing nothing reads for you.* That sentence lands",
    "verbatim in a PDF a client reads, so a person types it or it stays empty.",
    "",
  ];

  if (args.competitors.length < REQUIRED_SELECTIONS) {
    lines.push(
      `${args.competitors.length} of ${REQUIRED_SELECTIONS} competitors are picked, so this card covers` +
        ` the client${args.competitors.length ? " and those" : " only"}.` +
        ` Pick the rest at the shortlist card and this refreshes.`,
      ""
    );
  }

  const subjects = [
    { name: args.clientName, label: "THE CLIENT" },
    ...args.competitors.map((c) => ({ name: c.name, label: "COMPETITOR" })),
  ];

  let n = 0;
  for (const subject of subjects) {
    lines.push(`*${subject.label}: ${subject.name}*`);
    for (const p of REVIEW_PLATFORMS) {
      n++;
      const search = p.search({ name: subject.name, city: args.city, state: args.state });
      lines.push(` ${n}. ${p.label} — search: \`${search}\`  <${p.url}|open>`);
    }
    lines.push("");
  }

  lines.push(
    "*Competitor counts are optional. The client's own are not.* [Done] needs at least one",
    "recorded row for the client and never asks about the competitors.",
    "",
    "*A platform you cannot find a listing on is a finding.* Say so, and screenshot the empty result.",
    "A row you skip renders as \"not recorded\", never as zero reviews. Those are opposite claims."
  );

  return lines.join("\n");
}

/**
 * The auto half: seed and describe. The numbers are a person's job.
 *
 * ‼️ It returns ok:true with fewer than three competitors rather than failing. An
 * auto_then_manual step that returns ok:false lands in terminal `error`, where nothing retries
 * it and the card never posts — so a shortlist that is one pick short would silently cost the
 * whole review audit. The card says how many are missing instead.
 */
export async function runReviewAudit(
  clientId: string
): Promise<{ ok: boolean; error?: string; note: string }> {
  const seeded = await seedReviewAudit(clientId);
  if (!seeded.ok) return { ok: false, error: seeded.error, note: "" };

  const canonical = await canonicalFor(clientId);

  return {
    ok: true,
    note:
      `Review audit seeded: ${seeded.seeded} rows across ${REVIEW_PLATFORMS.length} platforms for ` +
      `the client and ${seeded.competitors} competitor${seeded.competitors === 1 ? "" : "s"}. ` +
      `Nothing is measured yet — no review API is keyed, so every row is a manual read.` +
      (canonical ? "" : " No canonical NAP on file, so the search strings use the client record as-is."),
  };
}

/** Platform label for the artifacts, so findings and the card cannot disagree. */
export function reviewPlatformLabel(key: string): string {
  return platformByKey(key)?.label ?? key;
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenshots into proposals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which row a screenshot belongs to.
 *
 * Two independent questions and BOTH have to answer with exactly one: which PLATFORM (from the
 * address bar, via resolvePlatformFromUrl, which is pure) and which SUBJECT (the business name
 * printed on the listing, fuzzy-matched against the client and the picked competitors).
 *
 * ‼️ ZERO MATCHES AND TWO MATCHES ARE THE SAME ANSWER, on both axes. The same rule the presence
 * sweep carries. A review count filed against the wrong competitor is a number in findings
 * section 3, which goes to the client, attributed to a business that never had it.
 */
export interface SubjectMatch {
  subjectType: "client" | "competitor";
  competitorId: string | null;
  subjectName: string;
}

/** Words that carry no identity, so they cannot be what makes two names "match". */
const NAME_NOISE = new Set([
  "the", "and", "of", "for", "at", "in", "on", "a", "an",
  "med", "spa", "medspa", "clinic", "center", "centre", "aesthetics", "aesthetic",
  "wellness", "beauty", "salon", "studio", "group", "agency", "company", "co",
]);

function nameTokens(name: string, extraNoise: Set<string>): Set<string> {
  return new Set(
    stripEntitySuffix(normalizeNameForCompare(name))
      .split(" ")
      .filter((w) => w.length > 1 && !NAME_NOISE.has(w) && !extraNoise.has(w))
  );
}

/**
 * Does the name on the listing describe this subject?
 *
 * Deliberately conservative in the direction that COSTS LESS. A miss means the screenshot is
 * reported as unmatched and somebody says which business it was, which is one message. A false
 * match writes a competitor's review count onto the client, or the reverse, into a document
 * that is shown to the owner.
 */
export function namesLikelySame(
  a: string | null | undefined,
  b: string | null | undefined,
  /**
   * Words that carry no identity FOR THIS CLIENT, on top of the general list.
   *
   * The city and state, passed by the caller that knows them. A directory routinely prints
   * "SRT Agency LLC Greensboro" where the record says "SRT Agency LLC", and without this the
   * one-token rule below rejects that correct match. It is a per-call fact rather than a
   * constant because "Greensboro" is noise in Greensboro and is identity in Raleigh.
   */
  extraNoise: string[] = []
): boolean {
  const noise = new Set(
    extraNoise.flatMap((w) => normalizeNameForCompare(w).split(" ")).filter((w) => w.length > 1)
  );
  const left = nameTokens(a ?? "", noise);
  const right = nameTokens(b ?? "", noise);
  if (left.size === 0 || right.size === 0) return false;

  let shared = 0;
  for (const t of left) if (right.has(t)) shared += 1;
  if (shared === 0) return false;

  // Every identifying word of the shorter name appears in the longer one.
  if (shared !== Math.min(left.size, right.size)) return false;

  // ‼️ A ONE-WORD NAME HAS TO MATCH EXACTLY, AND THIS IS THE CHECK THAT WAS MISSING.
  //
  // "Acme Med Spa" reduces to {acme} once the category words are dropped, and "Acme Dental"
  // reduces to {acme, dental}. Subset alone called those the same business, which would have
  // written a competitor's review count onto the client. When the shorter name carries only one
  // identifying word there is nothing left to disagree about, so anything the longer name adds
  // has to be noise the caller declared, not a word this function decided to ignore.
  if (Math.min(left.size, right.size) < 2) return left.size === right.size;

  return true;
}

export type ReviewIngestOutcome =
  | { kind: "proposed"; platform: string; subject: SubjectMatch; read: ReviewRead }
  /** Read fine, but the address bar named no review platform, or named two. */
  | { kind: "no_platform"; url: string | null; matches: string[] }
  /** Read fine, but the printed business name matched no subject, or matched two. */
  | { kind: "no_subject"; platform: string; readName: string | null; matches: string[] }
  /** Nothing legible. Not a failure of the file, a fact about the picture. */
  | { kind: "unreadable"; evidence: string }
  | { kind: "skipped"; reason: string };

export interface ReviewIngestResult {
  docId: string;
  filename: string;
  outcome: ReviewIngestOutcome;
}

/** Same headroom the presence reader uses, for the same reason. */
const MAX_VISION_BYTES = 6 * 1024 * 1024;

/**
 * Read every screenshot in the review audit step's thread that has not produced a proposal.
 *
 * ‼️ IT WRITES `proposed` AND NOTHING ELSE. Not review_count, not checked_at, not
 * owner_response_rate. A row that already carries a recorded count is skipped outright, so a
 * later batch of screenshots can never overwrite a number a person confirmed.
 */
export async function ingestReviewScreenshots(args: {
  clientId: string;
  threadTs: string;
  limit?: number;
}): Promise<ReviewIngestResult[]> {
  const { supabaseAdmin: db } = await import("@/lib/db");
  const { resolvePlatformFromUrl } = await import("@/config/presence-platforms");
  const { readReviewListing, isUsableReviewRead } = await import("./review-read");

  const { data: docs, error } = await db
    .from("client_docs")
    .select("id, filename, content_type, size_bytes, storage_ref")
    .eq("client_id", args.clientId)
    .eq("slack_thread_ts", args.threadTs)
    .order("uploaded_at", { ascending: true })
    .limit(args.limit ?? 40);

  if (error) {
    console.error("[clients/review-audit] screenshot list failed:", error.message);
    return [];
  }

  const rows = await loadReviewAudit(args.clientId);
  const subjects = subjectsFrom(rows);

  const { data: place } = await db
    .from("clients")
    .select("city, state")
    .eq("id", args.clientId)
    .maybeSingle();
  const placeWords = [place?.city as string | null, place?.state as string | null].filter(
    (v): v is string => Boolean(v)
  );
  const alreadyRead = new Set(
    rows.map((r) => r.proposed?.screenshotRef ?? "").filter(Boolean)
  );

  const out: ReviewIngestResult[] = [];

  for (const doc of docs ?? []) {
    const docId = doc.id as string;
    const filename = (doc.filename as string | null) ?? "that file";
    const ref = (doc.storage_ref as string | null) ?? null;
    const contentType = (doc.content_type as string | null) ?? "";

    if (ref && alreadyRead.has(ref)) continue;
    if (!contentType.startsWith("image/")) continue;
    if (((doc.size_bytes as number | null) ?? 0) > MAX_VISION_BYTES) {
      out.push({ docId, filename, outcome: { kind: "skipped", reason: "too large to read" } });
      continue;
    }
    if (!ref) {
      out.push({ docId, filename, outcome: { kind: "skipped", reason: "no stored bytes" } });
      continue;
    }

    const dl = await db.storage.from("onboarding").download(ref);
    if (dl.error || !dl.data) {
      out.push({
        docId,
        filename,
        outcome: { kind: "skipped", reason: dl.error?.message ?? "could not read the stored file" },
      });
      continue;
    }

    const buf = Buffer.from(await dl.data.arrayBuffer());
    const read = await readReviewListing({
      media_type: contentType,
      data: buf.toString("base64"),
    });

    if (!isUsableReviewRead(read)) {
      out.push({ docId, filename, outcome: { kind: "unreadable", evidence: read.evidence } });
      continue;
    }

    const platforms = read.listingUrl ? resolvePlatformFromUrl(read.listingUrl) : [];
    const onGrid = platforms.filter((k) => REVIEW_PLATFORM_KEYS.includes(k));
    if (onGrid.length !== 1) {
      out.push({
        docId,
        filename,
        outcome: { kind: "no_platform", url: read.listingUrl, matches: onGrid },
      });
      continue;
    }
    const platform = onGrid[0];

    // The city and the state are noise for THIS client: a directory that prints
    // "SRT Agency LLC Greensboro" against a record that says "SRT Agency LLC" is the same
    // business, and without this the one-word rule in namesLikelySame rejects it.
    const matched = subjects.filter((s) =>
      namesLikelySame(read.subjectName, s.subjectName, placeWords)
    );
    if (matched.length !== 1) {
      out.push({
        docId,
        filename,
        outcome: {
          kind: "no_subject",
          platform,
          readName: read.subjectName,
          matches: matched.map((m) => m.subjectName),
        },
      });
      continue;
    }
    const subject = matched[0];

    const target = rows.find(
      (r) =>
        r.platform === platform &&
        r.subjectType === subject.subjectType &&
        (r.competitorId ?? null) === (subject.competitorId ?? null)
    );

    if (!target) {
      out.push({
        docId,
        filename,
        outcome: { kind: "skipped", reason: `no seeded row for ${subject.subjectName} on ${platform}` },
      });
      continue;
    }

    // ‼️ A CONFIRMED ROW IS NEVER RE-PROPOSED OVER. isRecorded means a person typed or confirmed
    // that number, and a later screenshot is not evidence that they were wrong.
    if (isRecorded(target)) {
      out.push({
        docId,
        filename,
        outcome: { kind: "skipped", reason: `${subject.subjectName} on ${platform} is already recorded` },
      });
      continue;
    }

    const proposal: ProposedReading = {
      reviewCount: read.reviewCount,
      averageRating: read.averageRating,
      mostRecentReviewAt: read.mostRecentReviewAt,
      ownerRepliesInLastTen: read.ownerRepliesInLastTen,
      listingUrl: read.listingUrl,
      screenshotRef: ref,
      evidence: read.evidence,
      readAt: new Date().toISOString(),
    };

    const { error: writeError } = await db
      .from("review_audit_rows")
      .update({
        proposed: proposal,
        proposed_source: "screenshot",
        listing_url: read.listingUrl,
        screenshot_ref: ref,
      })
      .eq("id", target.id);

    if (writeError) {
      out.push({ docId, filename, outcome: { kind: "skipped", reason: writeError.message } });
      continue;
    }

    out.push({ docId, filename, outcome: { kind: "proposed", platform, subject, read } });
  }

  return out;
}

/** The distinct subjects the grid already holds, which is what a screenshot can match against. */
function subjectsFrom(rows: ReviewAuditRow[]): SubjectMatch[] {
  const seen = new Map<string, SubjectMatch>();
  for (const r of rows) {
    const key = `${r.subjectType}:${r.competitorId ?? ""}`;
    if (!seen.has(key)) {
      seen.set(key, {
        subjectType: r.subjectType,
        competitorId: r.competitorId,
        subjectName: r.subjectName,
      });
    }
  }
  return [...seen.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Proposals into records: the one human action
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ A DATE COLUMN CANNOT HOLD "3 weeks ago", AND CONVERTING ONE INTO A DATE WOULD BE INVENTING
 * IT. most_recent_review_at is a `date`. The reader is told to copy a relative phrase exactly as
 * printed rather than convert it, which means some proposals carry a phrase and not a date.
 *
 * Those write NULL and the confirmation says which ones did, rather than silently turning "a
 * month ago" into a specific day that appears in a document as if somebody had read it there.
 */
function asDateOrNull(v: string | null): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const parsed = new Date(t);
  if (Number.isNaN(parsed.getTime())) return null;
  // A bare year, or anything that parsed only because Date is generous, is not a review date.
  if (!/\d{4}/.test(t) || t.length < 6) return null;
  return parsed.toISOString().slice(0, 10);
}

export interface ConfirmResult {
  ok: boolean;
  error?: string;
  /** Rows whose proposal became a record. */
  confirmed: number;
  /** Rows whose date could not be stored as a date, named so nobody has to go looking. */
  datesDropped: string[];
  /**
   * Proposals with no legible total, which is NOT a zero.
   *
   * They are not confirmed at all. Stamping checked_at on a row whose count could not be read
   * would say "somebody looked at this" about a reading that failed, and isRecorded would still
   * be false, so the row would sit confirmed-but-not-recorded forever.
   */
  noCount: string[];
}

/**
 * Copy every outstanding proposal into the real columns and stamp who did it.
 *
 * ‼️ THIS IS THE HUMAN ACTION THE DOCTRINE REQUIRES, AND ITS WHOLE VALUE IS THAT IT IS A
 * SEPARATE ACT. Runner v3 section 6: the tool proposes, I confirm. Nothing else in this file
 * writes review_count, and a row with a proposal and no confirmation reads as "not recorded"
 * everywhere it is read, including findings section 3.
 *
 * It is ONE TAP FOR A WHOLE BATCH rather than one per row, because the alternative to a batch
 * confirm is not a more careful review, it is the grid nobody fills in.
 */
export async function applyProposedReadings(args: {
  clientId: string;
  by: string;
}): Promise<ConfirmResult> {
  const { supabaseAdmin: db } = await import("@/lib/db");

  const outstanding = (await loadReviewAudit(args.clientId)).filter(
    (r) => r.proposed !== null && !isRecorded(r)
  );
  const rows = outstanding.filter((r) => r.proposed?.reviewCount !== null);
  const noCount = outstanding
    .filter((r) => r.proposed?.reviewCount === null)
    .map((r) => `${r.subjectName} on ${reviewPlatformLabel(r.platform)}`);

  if (!rows.length) {
    return { ok: true, confirmed: 0, datesDropped: [], noCount };
  }

  const stamp = new Date().toISOString();
  const datesDropped: string[] = [];
  let confirmed = 0;

  for (const row of rows) {
    const p = row.proposed as ProposedReading;
    const date = asDateOrNull(p.mostRecentReviewAt);
    if (p.mostRecentReviewAt && !date) {
      datesDropped.push(`${row.subjectName} on ${reviewPlatformLabel(row.platform)} ("${p.mostRecentReviewAt}")`);
    }

    const { error } = await db
      .from("review_audit_rows")
      .update({
        review_count: p.reviewCount,
        average_rating: p.averageRating,
        most_recent_review_at: date,
        // The read is a COUNT out of ten; the column is a rate. Converted once, here, so the
        // proposal stays checkable against the picture it came from.
        owner_response_rate:
          p.ownerRepliesInLastTen === null ? null : Number((p.ownerRepliesInLastTen / 10).toFixed(2)),
        listing_url: p.listingUrl ?? row.listingUrl,
        screenshot_ref: p.screenshotRef ?? row.screenshotRef,
        checked_by: args.by,
        checked_at: stamp,
      })
      .eq("id", row.id);

    if (error) return { ok: false, error: error.message, confirmed, datesDropped, noCount };
    confirmed += 1;
  }

  return { ok: true, confirmed, datesDropped, noCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// The grid, which is the thing he actually asked for
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ONE card after a batch of uploads, not one reply per screenshot.
 *
 * Matthew: "it will be better if we can just send screenshots inside of slack and it groups
 * them all automatically." The grouping IS the feature. Four screenshots produce one grid, and
 * a subject-by-platform table is the only shape that answers "what is still missing" without
 * somebody counting replies.
 *
 * ‼️ THREE STATES PER CELL AND THEY ARE NOT INTERCHANGEABLE. A recorded number, a proposal
 * nobody has confirmed, and nothing at all. Collapsing the middle one into either of the
 * others is the whole bug this design exists to avoid: a proposal shown as a record is a green
 * tick over unchecked work, and a proposal shown as nothing throws away the read.
 */
export function formatReviewGrid(args: {
  rows: ReviewAuditRow[];
  results?: ReviewIngestResult[];
}): string {
  const rows = args.rows.filter((r) => REVIEW_PLATFORM_KEYS.includes(r.platform));
  const results = args.results ?? [];

  const subjects = subjectsFrom(rows);
  const recorded = rows.filter(isRecorded).length;
  const proposed = rows.filter((r) => r.proposed !== null && !isRecorded(r)).length;

  const lines: string[] = [
    `*Review audit — ${recorded} recorded, ${proposed} proposed, ${rows.length - recorded - proposed} not recorded*`,
    "",
  ];

  const cell = (r: ReviewAuditRow | undefined): string => {
    if (!r) return "not seeded";
    if (isRecorded(r)) {
      const rating = r.averageRating !== null ? ` · ${r.averageRating}` : "";
      return `:white_check_mark: ${r.reviewCount}${rating}`;
    }
    if (r.proposed) {
      const p = r.proposed;
      const count = p.reviewCount === null ? "no total read" : `${p.reviewCount}`;
      const rating = p.averageRating !== null ? ` · ${p.averageRating}` : "";
      return `:eyes: ${count}${rating} (proposed)`;
    }
    return "not recorded";
  };

  for (const s of subjects) {
    lines.push(`*${s.subjectType === "client" ? "THE CLIENT" : "COMPETITOR"}: ${s.subjectName}*`);
    for (const p of REVIEW_PLATFORMS) {
      const row = rows.find(
        (r) =>
          r.platform === p.key &&
          r.subjectType === s.subjectType &&
          (r.competitorId ?? null) === (s.competitorId ?? null)
      );
      lines.push(`  • ${p.label}: ${cell(row)}`);
    }
    lines.push("");
  }

  const unmatched = results.filter(
    (r) => r.outcome.kind === "no_platform" || r.outcome.kind === "no_subject" || r.outcome.kind === "unreadable"
  );

  if (unmatched.length) {
    lines.push(`*${unmatched.length} screenshot${unmatched.length === 1 ? "" : "s"} could not be placed.* Filed, kept, not counted:`);
    for (const r of unmatched) {
      const o = r.outcome;
      if (o.kind === "no_platform") {
        lines.push(
          o.matches.length > 1
            ? `  • ${o.url} matches ${o.matches.join(" and ")}, so there is no way to tell which listing that is.`
            : `  • ${o.url ?? "no address bar was legible"} is not one of the ${REVIEW_PLATFORMS.length} review platforms.`
        );
      } else if (o.kind === "no_subject") {
        lines.push(
          o.matches.length > 1
            ? `  • "${o.readName}" on ${reviewPlatformLabel(o.platform)} matches ${o.matches.join(" and ")}. Say which.`
            : `  • "${o.readName ?? "no business name was legible"}" on ${reviewPlatformLabel(o.platform)} is not the client or a picked competitor.`
        );
      } else if (o.kind === "unreadable") {
        lines.push(`  • ${r.filename}: ${o.evidence}.`);
      }
    }
    lines.push("");
  }

  if (proposed > 0) {
    lines.push(
      "*Nothing above is recorded until you tap [Confirm these readings].* That writes every",
      "proposal at once and stamps who confirmed it. The themes in the negatives are still yours",
      "to type: no model writes that sentence."
    );
  } else {
    lines.push(
      "*Competitor counts are optional. The client's own are not.* [Done] needs at least one",
      "recorded row for the client."
    );
  }

  return lines.join("\n");
}
