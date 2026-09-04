// Five candidate offers for one page, written when the page is, and the one act that mints one.
//
// Matthew, 2026-09-04: "I want lead magnet ideas ready as drafts in the onboarding page for speed,
// 5 variation examples at least", and "this should be inside the drafting workflow not side by
// side it, since the pages will be built with a lead magnet each one."
//
// So this is not a delivery step. It hangs off page creation: startPageDraft() is the only thing
// that makes a client_pages row, and the moment it does, the five exist. By the time anybody types
// `magnet` in the studio or opens the picker on the board, the choice is already in front of them.
//
// ‼️ THIS FILE HOLDS THE ONLY INSERT INTO lead_magnets IN THE WHOLE OF src/.
// Until today the catalogue was seeded exclusively by SQL, which is why every client's picker
// offered the same six library rows and none of them was about that client. That makes
// approveMagnetCandidate the place where a model's output becomes a row the resolver walks for
// every visitor, so it is gated on a human act and it re-checks everything the drafter checked.
//
// ‼️ THE TWO COPY RULES ARE NOT HOUSE STYLE, THEY ARE AN EXISTING PROBE.
// scripts/_probe-concierge-lane.ts section 9b asserts that EVERY active row's effective pill label
// is 28 characters or under and carries no banned dash, across the whole table. A minted magnet
// that fails either turns that probe red for the entire catalogue, not just for this client. Both
// are therefore checked before the model's output is stored AND again before it is minted.
//
// ‼️ A MINTED MAGNET IS ALWAYS DELIVERABLE, BY CONSTRUCTION. It carries asset_url null and a key
// that is not in magnets.ts's ENV_ASSET map, so isDeliverable() is unconditionally true for it. The
// offer is the conversation itself, which is what concierge_entry describes. A model may not
// promise a PDF, because a magnet is a promise and nothing in this lane could keep that one.

import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { conciergeTenant } from "./for-client";
import { listMagnetsFor, type Audience } from "./magnets";

/** The pill wraps into a paragraph past this. docs/2026-09-03-page-magnet.sql names the number. */
export const CTA_MAX = 28;

/** Matthew asked for "5 variation examples at least". Five is the floor, not the target. */
export const MIN_CANDIDATES = 5;

export interface MagnetCandidate {
  id: string;
  pageId: string;
  audience: Audience;
  title: string;
  promise: string;
  ctaLabel: string;
  conciergeEntry: string;
  rationale: string | null;
  evidenceRefs: string[];
  status: "draft" | "approved" | "rejected";
  mintedMagnetKey: string | null;
  createdAt: string;
}

/** What the model is asked for. One candidate, before it is anything. */
interface DraftedMagnet {
  title: string;
  promise: string;
  ctaLabel: string;
  conciergeEntry: string;
  rationale: string;
  evidenceRefs: string[];
}

interface DraftedBatch {
  candidates: DraftedMagnet[];
}

const MODEL = "claude-sonnet-4-6" as const;

const SCHEMA_HINT = `{
  "candidates": [
    {
      "title": string,            // the offer spelled out, as it is named inside the conversation
      "promise": string,          // one or two sentences on what the person actually gets
      "ctaLabel": string,         // the pill in the corner of the page, ${CTA_MAX} characters or fewer
      "conciergeEntry": string,   // what the widget SAYS to open the offer, in the first person
      "rationale": string,        // why this offer suits this page, for the person choosing
      "evidenceRefs": string[]    // the S-numbers you leaned on, e.g. ["S1","S4"], or []
    }
  ]
}`;

const SYSTEM = `You write lead magnet offers for one page on one small business's website.

A lead magnet here is NOT a downloadable file. It is a thing the business's own chat widget can
hand over inside the conversation: a list it can pull, a check it can run, a set of questions it
can send, an assessment it can walk somebody through. You have no way to create a PDF, so you must
never promise one, and you must never promise anything that would need a file, a login, a coupon
code, a physical item, or a member of staff to do something.

You are given the question this page answers, the sources on file for this business, the customer
it is aimed at, and the offers that already exist. Write ${MIN_CANDIDATES} DIFFERENT offers.

WHAT MAKES THESE GOOD, in order:

1. THEY ARE ABOUT THIS BUSINESS. Use the sources. An offer that would read identically on a
   competitor's website is a wasted one, and five of those is the failure this task exists to
   avoid. Name what these people actually do, where they are, what they told us.

2. THEY FOLLOW FROM THE QUESTION. Somebody reading this page has a specific thing on their mind.
   The offer is the obvious next step from THAT, not a generic invitation to get in touch.

3. THEY ARE DIFFERENT FROM EACH OTHER. Five angles, not one angle worded five ways. Vary what is
   being offered, not just the wording: a comparison, a check on their own situation, a shortlist,
   a walkthrough, a set of questions to ask elsewhere.

4. THEY DO NOT REPEAT WHAT ALREADY EXISTS. The offers already in the catalogue are listed. Write
   past them.

HARD RULES, and a batch breaking any of them is rejected whole:

- ctaLabel is ${CTA_MAX} characters or fewer. It is a button in the corner of a page, read by a
  stranger who has agreed to nothing. "Free AI visibility scan" works. A truncated title does not.
- NO em dashes, en dashes, or double hyphens, anywhere, in any field. Use commas and periods.
- conciergeEntry is written in the first person, as the widget speaks, and ends by asking for the
  one thing it needs to begin. It is a sentence somebody says, not a description of a feature.
- Claim nothing about the business that the sources do not carry. No invented prices, credentials,
  equipment, years, guarantees or counts. If you want to say something specific and no source says
  it, choose a different offer.
- STATE NO FIGURE THAT IS NOT IN THE SOURCES. Percentages, counts, prices and years are checked
  against the sources one by one, and a single one that is not there rejects the whole batch. If
  the sources give you no numbers, write five offers that contain no numbers.
- evidenceRefs lists only S-numbers that appear in the sources given. An empty array is honest and
  is better than a wrong one.`;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function trimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Numbers a candidate states that no source contains.
 *
 * ‼️ ADDED AFTER THE FIRST LIVE RUN INVENTED ONE. Asked for five offers for SRT, the model wrote
 * "Because 97 percent of med spas run one location" into a promise and returned an empty
 * evidenceRefs array. The prompt already forbade it in words. A rule a model is asked to follow
 * is not a rule, and this is the same doctrine checkOrphanNumbers() in hub/page-gate.ts applies
 * to a page body, applied here because a promise is read by a stranger in the widget and is
 * exactly as publishable-and-false.
 *
 * SINGLE DIGITS ARE IGNORED, for the reason page-gate.ts gives: "3 questions" and "2 to 4 days"
 * are almost never the kind of number that can be wrong in a costly way, and including them made
 * the equivalent check fire on nearly everything.
 */
function orphanNumbers(text: string, haystack: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    const bare = m[0].replace(/[,$%]/g, "");
    if (bare.length < 2) continue;
    if (!haystack.includes(bare)) out.push(m[0]);
  }
  return [...new Set(out)];
}

/** Every reason a single candidate is not usable, in words, for describeInvalid. */
function faultsIn(
  c: unknown,
  index: number,
  validRefs: Set<string>,
  numberHaystack: string
): string[] {
  const out: string[] = [];
  const d = c as Partial<DraftedMagnet>;
  const label = `candidate ${index + 1}`;

  const title = trimmed(d?.title);
  const promise = trimmed(d?.promise);
  const cta = trimmed(d?.ctaLabel);
  const entry = trimmed(d?.conciergeEntry);

  if (!title) out.push(`${label} has no title`);
  if (!promise) out.push(`${label} has no promise`);
  if (!entry) out.push(`${label} has no conciergeEntry`);

  if (!cta) {
    out.push(`${label} has no ctaLabel`);
  } else if (cta.length > CTA_MAX) {
    out.push(`${label}'s ctaLabel is ${cta.length} characters, and the limit is ${CTA_MAX}: "${cta}"`);
  }

  for (const [field, value] of [
    ["title", title],
    ["promise", promise],
    ["ctaLabel", cta],
    ["conciergeEntry", entry],
    ["rationale", trimmed(d?.rationale)],
  ] as const) {
    if (value && hasBannedDash(value)) {
      out.push(`${label}'s ${field} contains an em dash, en dash or double hyphen`);
    }
  }

  for (const [field, value] of [
    ["title", title],
    ["promise", promise],
    ["ctaLabel", cta],
    ["conciergeEntry", entry],
  ] as const) {
    const orphans = orphanNumbers(value, numberHaystack);
    if (orphans.length) {
      out.push(
        `${label}'s ${field} states ${orphans.join(", ")}, and no source on file contains ` +
          `${orphans.length === 1 ? "that number" : "those numbers"}. Take the figure out or ` +
          `make the offer about something a source actually supports`
      );
    }
  }

  const refs = Array.isArray(d?.evidenceRefs) ? d.evidenceRefs : [];
  if (!Array.isArray(d?.evidenceRefs)) {
    out.push(`${label} has no evidenceRefs array, and an empty array is the right answer for none`);
  } else {
    const dangling = refs.filter((r) => typeof r !== "string" || !validRefs.has(r));
    if (dangling.length) {
      out.push(
        `${label} cites ${dangling.map((r) => JSON.stringify(r)).join(", ")}, which ` +
          `${dangling.length === 1 ? "is not a source" : "are not sources"} on this page`
      );
    }
  }

  return out;
}

function isBatch(v: unknown, validRefs: Set<string>, numbers: string): v is DraftedBatch {
  const d = v as Partial<DraftedBatch>;
  if (!Array.isArray(d?.candidates)) return false;
  if (d.candidates.length < MIN_CANDIDATES) return false;
  return d.candidates.every((c, i) => faultsIn(c, i, validRefs, numbers).length === 0);
}

function whyInvalid(v: unknown, validRefs: Set<string>, numbers: string): string {
  const d = v as Partial<DraftedBatch>;
  if (!Array.isArray(d?.candidates)) {
    return `Return { "candidates": [...] } with at least ${MIN_CANDIDATES} entries.`;
  }
  if (d.candidates.length < MIN_CANDIDATES) {
    return (
      `You returned ${d.candidates.length} candidates and at least ${MIN_CANDIDATES} are needed. ` +
      `Keep the ones you have and add ${MIN_CANDIDATES - d.candidates.length} more, each a ` +
      `different KIND of offer rather than a rewording.`
    );
  }
  const faults = d.candidates.flatMap((c, i) => faultsIn(c, i, validRefs, numbers));
  return faults.length
    ? `Fix these and return the whole set again:\n${faults.map((f) => `  - ${f}`).join("\n")}`
    : "Return the same shape again.";
}

// ---------------------------------------------------------------------------
// Gathering what the five are written from
// ---------------------------------------------------------------------------

interface Ground {
  audience: Audience;
  question: string;
  slug: string;
  evidenceBlock: string;
  validRefs: Set<string>;
  /** Every source, commas and currency stripped, for the orphan-number check. */
  numberHaystack: string;
  avatarBlock: string;
  existingBlock: string;
  clientName: string;
}

async function gather(
  clientId: string,
  pageId: string
): Promise<{ ok: true; ground: Ground } | { ok: false; error: string }> {
  // ‼️ NO CONFIG ROW MEANS NO WIDGET, AND THE HONEST ANSWER IS A REFUSAL THAT NAMES THE STEP.
  // Defaulting an audience here would open exactly the hole for-client.ts's header refuses to open
  // from the other side, and it would draft five offers for a reader nobody has identified.
  const tenant = await conciergeTenant(clientId);
  if (!tenant) {
    return {
      ok: false,
      error:
        "This client has no concierge widget, so there is no catalogue to write an offer into. " +
        "The `concierge_preview` delivery step creates it.",
    };
  }

  const { data: page } = await supabaseAdmin
    .from("client_pages")
    .select("question, slug")
    .eq("id", pageId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (!page) return { ok: false, error: "That page does not exist." };

  const question = ((page.question as string | null) ?? "").trim();
  if (!question) {
    return { ok: false, error: "That page has no question, so there is nothing to write an offer for." };
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name")
    .eq("id", clientId)
    .maybeSingle();

  const clientName =
    ((client?.dba_name as string | null) || (client?.legal_name as string | null)) ?? "this business";

  const { loadNumberedEvidence } = await import("@/lib/clients/page-evidence");
  const evidence = await loadNumberedEvidence(clientId, pageId);
  const validRefs = new Set(evidence.map((e) => e.ref));

  // Same normalisation page-gate.ts uses, so 1,200 and 1200 are the same number.
  const numberHaystack = evidence.map((e) => e.content).join(" ").replace(/[,$]/g, "");

  const evidenceBlock = evidence.length
    ? evidence
        .map((s) => `[${s.ref}] ${s.label}${s.topic ? `, on ${s.topic}` : ""}\n${s.content}`)
        .join("\n\n")
    : "(nothing on file for this business yet)";

  // ‼️ THE AVATAR IN TWO HOPS, BECAUSE THE CONFIRMATION ALONE IS A LABEL.
  // confirmedAvatarFor answers WHICH customer was picked; avatar_briefs holds what the deep
  // research at avatar_harvest actually learned about them, and that is the material worth writing
  // an offer against. A client with neither still gets drafts off the evidence, and the card says
  // the avatar was missing rather than pretending the offers were aimed at somebody.
  const { confirmedAvatarFor, avatarBriefFor } = await import("@/lib/clients/avatars");
  const { verticalFor } = await import("@/lib/clients/harvest");
  const avatar = await confirmedAvatarFor(clientId);
  const resolved = await verticalFor(clientId);
  const brief =
    avatar && resolved.ok ? await avatarBriefFor(resolved.vertical, avatar.slug) : null;

  const avatarBlock = avatar
    ? [
        `The customer this whole build is aimed at: ${avatar.label}`,
        brief?.researchText ? `\nWhat the research found about them:\n${brief.researchText.slice(0, 4000)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "No customer avatar has been confirmed for this client, so write for the person who would " +
      "type this page's question.";

  const existing = await listMagnetsFor(tenant.audience, clientId);
  const existingBlock = existing.length
    ? existing.map((m) => `- ${m.title}: ${m.promise}`).join("\n")
    : "(none yet)";

  return {
    ok: true,
    ground: {
      audience: tenant.audience,
      question,
      slug: (page.slug as string | null) ?? "",
      evidenceBlock,
      validRefs,
      numberHaystack,
      avatarBlock,
      existingBlock,
      clientName,
    },
  };
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

export interface DraftResult {
  ok: boolean;
  error?: string;
  candidates: MagnetCandidate[];
}

/**
 * Write five candidate offers for one page and hold them as drafts.
 *
 * Nothing here touches lead_magnets and nothing here touches client_pages. The page's offer is
 * still unchosen when this returns, which is the point: the choice is a human act and this only
 * puts five real options in front of it.
 *
 * `replace` clears this page's outstanding drafts first, for the `magnet more` re-roll. An APPROVED
 * candidate is never cleared: it is the record of a decision somebody made, and the page's
 * lead_magnet_key still points at what it minted.
 */
export async function draftMagnetsForPage(
  clientId: string,
  pageId: string,
  opts: { replace?: boolean } = {}
): Promise<DraftResult> {
  const ground = await gather(clientId, pageId);
  if (!ground.ok) return { ok: false, error: ground.error, candidates: [] };
  const g = ground.ground;

  const user = [
    `THE BUSINESS: ${g.clientName}`,
    `WHO THE WIDGET IS TALKING TO: ${
      g.audience === "owner"
        ? "a business owner reading this page, who might hire us"
        : "a member of the public reading this page, who might become a customer"
    }`,
    "",
    `THE QUESTION THIS PAGE ANSWERS: ${g.question}`,
    "",
    "THE CUSTOMER:",
    g.avatarBlock,
    "",
    "THE SOURCES, and there are no others:",
    g.evidenceBlock,
    "",
    "OFFERS THAT ALREADY EXIST, do not restate these:",
    g.existingBlock,
  ].join("\n");

  let batch: DraftedBatch;
  try {
    const res = await callClaudeJSON<DraftedBatch>({
      model: MODEL,
      system: SYSTEM,
      user,
      maxTokens: 3000,
      temperature: 0.4,
      schemaHint: SCHEMA_HINT,
      validate: (v): v is DraftedBatch => isBatch(v, g.validRefs, g.numberHaystack),
      describeInvalid: (v) => whyInvalid(v, g.validRefs, g.numberHaystack),
    });
    batch = res.data;
  } catch (e) {
    return {
      ok: false,
      error: `The offers were not drafted: ${(e as Error).message}`,
      candidates: [],
    };
  }

  if (opts.replace) {
    await supabaseAdmin
      .from("page_magnet_candidates")
      .delete()
      .eq("page_id", pageId)
      .eq("status", "draft");
  }

  const rows = batch.candidates.map((c) => ({
    client_id: clientId,
    page_id: pageId,
    audience: g.audience,
    title: c.title.trim(),
    promise: c.promise.trim(),
    cta_label: c.ctaLabel.trim(),
    concierge_entry: c.conciergeEntry.trim(),
    rationale: c.rationale?.trim() || null,
    evidence_refs: c.evidenceRefs ?? [],
    status: "draft",
    model: MODEL,
  }));

  const { data, error } = await supabaseAdmin
    .from("page_magnet_candidates")
    .insert(rows)
    .select(CANDIDATE_COLUMNS);

  if (error) {
    return {
      ok: false,
      error:
        `The offers were written but not saved: ${error.message}. ` +
        `If this says the relation does not exist, docs/2026-09-04-magnet-lane.sql has not been run.`,
      candidates: [],
    };
  }

  return { ok: true, candidates: ((data ?? []) as unknown as Record<string, unknown>[]).map(toCandidate) };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const CANDIDATE_COLUMNS =
  "id, page_id, audience, title, promise, cta_label, concierge_entry, rationale, " +
  "evidence_refs, status, minted_magnet_key, created_at";

function toCandidate(row: Record<string, unknown>): MagnetCandidate {
  const refs = row.evidence_refs;
  return {
    id: String(row.id),
    pageId: String(row.page_id),
    audience: row.audience === "owner" ? "owner" : "patient",
    title: (row.title as string) ?? "",
    promise: (row.promise as string) ?? "",
    ctaLabel: (row.cta_label as string) ?? "",
    conciergeEntry: (row.concierge_entry as string) ?? "",
    rationale: (row.rationale as string | null) ?? null,
    evidenceRefs: Array.isArray(refs) ? refs.filter((r): r is string => typeof r === "string") : [],
    status: row.status === "approved" ? "approved" : row.status === "rejected" ? "rejected" : "draft",
    mintedMagnetKey: (row.minted_magnet_key as string | null) ?? null,
    createdAt: (row.created_at as string) ?? "",
  };
}

/**
 * This page's outstanding drafts, oldest first so the numbering a person is shown is stable.
 *
 * ‼️ ORDERED BY created_at ASC AND NOT BY ANYTHING ELSE. The studio prints these as `1` to `5` and
 * somebody then types `magnet 3`. If two calls could order them differently, the number they typed
 * would name a different offer than the one they read, which is the same class of bug sort_order
 * exists to prevent in the catalogue.
 */
export async function draftsForPage(pageId: string): Promise<MagnetCandidate[]> {
  const { data, error } = await supabaseAdmin
    .from("page_magnet_candidates")
    .select(CANDIDATE_COLUMNS)
    .eq("page_id", pageId)
    .eq("status", "draft")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error(`[magnet-drafts] draftsForPage: ${error.message}`);
    return [];
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toCandidate);
}

/**
 * Every page's outstanding drafts for one client, in one query, keyed by page id.
 *
 * ‼️ ONE ROUND TRIP RATHER THAN ONE PER PAGE, BECAUSE THE CALLER IS A PAGE LOAD. The client
 * board renders every page at once, and a per-page call would put N queries behind a GET that a
 * person is waiting on. Same reasoning candidatesFor() in magnets.ts gives for reading the whole
 * ladder once and ranking in memory.
 */
export async function draftsByPageFor(
  clientId: string
): Promise<Record<string, MagnetCandidate[]>> {
  const { data, error } = await supabaseAdmin
    .from("page_magnet_candidates")
    .select(CANDIDATE_COLUMNS)
    .eq("client_id", clientId)
    .eq("status", "draft")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    // Not thrown: a board that cannot read drafts should still render every page, the catalogue
    // picker and the gate verdicts. The missing optgroup is visible; a 500 is not diagnosable.
    console.error(`[magnet-drafts] draftsByPageFor: ${error.message}`);
    return {};
  }

  const out: Record<string, MagnetCandidate[]> = {};
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const c = toCandidate(row);
    (out[c.pageId] ??= []).push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Approving one, which is the only mint in src/
// ---------------------------------------------------------------------------

/**
 * A stable slug for a minted magnet, unique against lead_magnets_placement_key.
 *
 * ‼️ PREFIXED WITH THE CLIENT SLUG BECAUSE THE KEY IS A GLOBAL NAMESPACE. magnet_key is not unique
 * on its own (one magnet holds several placements), but magnetByKey() resolves a key audience-wide
 * across the library AND every client, so two clients minting "the-5-questions" would be two rows
 * one lookup cannot tell apart. The prefix makes a collision impossible in practice and the loop
 * below makes it impossible in fact.
 */
function mintKey(clientSlug: string, title: string, attempt: number): string {
  const base = `${clientSlug}-${title}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56)
    .replace(/-+$/g, "");
  const stem = base || `${clientSlug}-offer`;
  return attempt === 0 ? stem : `${stem}-${attempt + 1}`;
}

export type ApproveResult =
  | { ok: true; magnetKey: string; title: string; ctaLabel: string }
  | { ok: false; error: string };

/**
 * Turn one draft into a real offer this page is written toward.
 *
 * THE ONLY INSERT INTO lead_magnets IN src/, and it is reached only from a button or a typed
 * command. Four things happen and the order matters: the row is minted first, so that if
 * setPageMagnet fails the page still points at nothing rather than at a key that does not exist.
 *
 * ‼️ EVERY COPY RULE IS RE-CHECKED HERE EVEN THOUGH THE DRAFTER CHECKED IT. The drafter's checks
 * ran against what a model returned in one moment; this runs against what is in the table now, and
 * the table is what the catalogue-wide probe reads. A row that got in some other way, or a schema
 * that changed underneath, is caught before it reaches a surface every client shares.
 */
export async function approveMagnetCandidate(args: {
  clientId: string;
  pageId: string;
  candidateId: string;
  by: string | null;
}): Promise<ApproveResult> {
  const { data: row, error: readError } = await supabaseAdmin
    .from("page_magnet_candidates")
    .select(CANDIDATE_COLUMNS)
    .eq("id", args.candidateId)
    .eq("client_id", args.clientId)
    .eq("page_id", args.pageId)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!row) return { ok: false, error: "That draft does not belong to this page." };

  const cand = toCandidate(row as unknown as Record<string, unknown>);

  if (cand.status === "approved" && cand.mintedMagnetKey) {
    // Idempotent rather than an error: two people pressing the same button, or a Slack retry,
    // should land on the same offer instead of minting a second row for it.
    return {
      ok: true,
      magnetKey: cand.mintedMagnetKey,
      title: cand.title,
      ctaLabel: cand.ctaLabel,
    };
  }
  if (cand.status === "rejected") {
    return { ok: false, error: "That draft was already set aside. Pick one of the others." };
  }

  const tenant = await conciergeTenant(args.clientId);
  if (!tenant) {
    return {
      ok: false,
      error: "This client's concierge config has gone, so there is no catalogue to mint into.",
    };
  }

  // ‼️ THE FROZEN AUDIENCE IS COMPARED, NOT OVERWRITTEN. These five were written for whoever the
  // widget was speaking to at draft time. If somebody has flipped the client's audience since,
  // minting one would put an owner offer in the patient catalogue, which is precisely the firewall
  // 2026-09-03-concierge-audience.sql calls the reason the column exists.
  if (cand.audience !== tenant.audience) {
    return {
      ok: false,
      error:
        `These offers were written for the ${cand.audience} lane and this client is now on the ` +
        `${tenant.audience} lane. Draft them again so they are about the right reader.`,
    };
  }

  if (cand.ctaLabel.length > CTA_MAX) {
    return {
      ok: false,
      error: `Its pill label is ${cand.ctaLabel.length} characters and the limit is ${CTA_MAX}.`,
    };
  }
  for (const [field, value] of [
    ["title", cand.title],
    ["promise", cand.promise],
    ["pill label", cand.ctaLabel],
    ["opening line", cand.conciergeEntry],
  ] as const) {
    if (hasBannedDash(value)) {
      return { ok: false, error: `Its ${field} contains an em dash, so it cannot go in the catalogue.` };
    }
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("slug")
    .eq("id", args.clientId)
    .maybeSingle();

  const clientSlug = ((client?.slug as string | null) ?? "client").trim() || "client";

  // ── Mint. The loop exists because mintKey is deterministic and two drafts on two pages can
  // legitimately share a title, which would otherwise trip lead_magnets_placement_key.
  let magnetKey = "";
  let mintError = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const key = mintKey(clientSlug, cand.title, attempt);
    const { error } = await supabaseAdmin.from("lead_magnets").insert({
      magnet_key: key,
      chains_to_key: null,
      audience: cand.audience,
      client_id: args.clientId,
      // All three null on purpose: this is a CLIENT rung magnet (weight 8 in rungOf), named
      // directly by the page rather than reached by the ladder, and inventing a placement for it
      // would put it in front of pages nobody wrote it for.
      vertical: null,
      treatment: null,
      category: null,
      title: cand.title,
      promise: cand.promise,
      cta_label: cand.ctaLabel,
      // Never env-backed and never a URL, so isDeliverable() is unconditionally true. See header.
      asset_url: null,
      concierge_entry: cand.conciergeEntry,
      active: true,
      sort_order: 50,
    });

    if (!error) {
      magnetKey = key;
      break;
    }
    mintError = error.message;
    // 23505 is the placement index. Anything else is a real failure and retrying hides it.
    if (!/duplicate key|23505/i.test(error.message)) break;
  }

  if (!magnetKey) {
    return {
      ok: false,
      error:
        `The offer was not added to the catalogue: ${mintError}. ` +
        `If this says the relation does not exist, docs/2026-09-04-magnet-lane.sql has not been run.`,
    };
  }

  const { setPageMagnet } = await import("@/lib/hub/pages");
  const set = await setPageMagnet(args.clientId, args.pageId, magnetKey);
  if (!set.ok) {
    return {
      ok: false,
      error:
        `"${cand.title}" was added to the catalogue but the page was not pointed at it: ` +
        `${set.error}. Say \`magnet ${magnetKey}\` to finish it.`,
    };
  }

  const now = new Date().toISOString();
  await supabaseAdmin
    .from("page_magnet_candidates")
    .update({
      status: "approved",
      minted_magnet_key: magnetKey,
      decided_at: now,
      decided_by: args.by,
    })
    .eq("id", cand.id);

  // The siblings are set aside rather than deleted: a page offers one thing, and what was on the
  // table when somebody chose is worth being able to read back.
  await supabaseAdmin
    .from("page_magnet_candidates")
    .update({ status: "rejected", decided_at: now, decided_by: args.by })
    .eq("page_id", args.pageId)
    .eq("status", "draft");

  return { ok: true, magnetKey, title: cand.title, ctaLabel: cand.ctaLabel };
}

/**
 * Set every outstanding draft aside without choosing one.
 *
 * Not the same as `magnet none`: this says these five were not right, while that says this page
 * should fall back to the ladder. Somebody can do both, in either order.
 */
export async function rejectAllDrafts(
  pageId: string,
  by: string | null
): Promise<{ ok: boolean; count: number; error?: string }> {
  const { data, error } = await supabaseAdmin
    .from("page_magnet_candidates")
    .update({ status: "rejected", decided_at: new Date().toISOString(), decided_by: by })
    .eq("page_id", pageId)
    .eq("status", "draft")
    .select("id");

  if (error) return { ok: false, count: 0, error: error.message };
  return { ok: true, count: (data ?? []).length };
}
