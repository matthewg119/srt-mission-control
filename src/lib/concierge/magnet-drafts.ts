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
import { listMagnetsFor, magnetByKey, type Audience, type LeadMagnet } from "./magnets";

/** The pill wraps into a paragraph past this. docs/2026-09-03-page-magnet.sql names the number. */
export const CTA_MAX = 28;

/** Matthew asked for "5 variation examples at least". Five is the floor, not the target. */
export const MIN_CANDIDATES = 5;

export interface MagnetCandidate {
  id: string;
  /** Null on a client-scoped draft, written before this client had any page. */
  pageId: string | null;
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

const INTRO = `You write lead magnet offers for one page on one small business's website.

A lead magnet here is NOT a downloadable file. It is a thing the business's own chat widget can
hand over inside the conversation: a list it can pull, a check it can run, a set of questions it
can send, an assessment it can walk somebody through. You have no way to create a PDF, so you must
never promise one, and you must never promise anything that would need a file, a login, a coupon
code, a physical item, or a member of staff to do something.`;

/**
 * The anchored task: five framings of ONE offer, instead of five different offers.
 *
 * ‼️ RULES 3 AND 4 OF THE OPEN TASK ARE THE OPPOSITE OF WHAT AN ANCHORED CLIENT WANTS, which is
 * why this is a second task block rather than an extra paragraph. "Vary what is being offered"
 * and "write past what already exists" are exactly how SRT's citations page got a checklist, a
 * vetting guide and a category walkthrough when Matthew wanted every door to open onto the audit.
 * An extra line saying "but frame the anchor" would sit under a rule saying "offer something
 * different", and the model follows whichever it read with more emphasis.
 *
 * The HARD RULES are shared, not copied, so the pill limit, the dash ban and the orphan-number
 * rule cannot drift between the two.
 */
const TASK_ANCHORED = `You are given the question this page answers, the sources on file for this business, the customer
it is aimed at, and THE ANCHOR OFFER: the one free thing this business gives away on every page of
its site. Write ${MIN_CANDIDATES} FRAMINGS OF THAT ONE OFFER for this page.

A framing is a door into the anchor, shaped by what the reader of THIS page is already thinking
about. The reader receives exactly what the anchor delivers, nothing more and nothing different.
What changes between framings is the name, the pill, the promise and the opening line: which part
of this page's question the anchor is presented as answering.

WHAT MAKES THESE GOOD, in order:

1. THEY FOLLOW FROM THE QUESTION. Somebody reading this page has a specific thing on their mind.
   Each framing presents the anchor as the obvious next step from THAT, in the reader's terms.

2. THEY ARE ABOUT THIS BUSINESS. Use the sources. Name what these people actually do and who for.

3. THEY NEVER PROMISE WHAT THE ANCHOR DOES NOT DELIVER. Read the anchor's promise. A framing may
   narrow its focus to the part of the anchor this page is about, but it may not add a deliverable:
   no separate report, no checklist or list the anchor does not produce, no human follow-up. If the
   anchor would not hand it over, the framing does not offer it.

4. THEY ENTER THROUGH DIFFERENT DOORS. Five different parts of this page's topic, not one framing
   worded five ways.

5. IF A PLANNED FRAMING IS GIVEN, candidate 1 IS that framing, changed only as far as the hard
   rules below require.`;

const SYSTEM_TASK_OPEN = `You are given the question this page answers, the sources on file for this business, the customer
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
   past them.`;

const HARD_RULES = `HARD RULES, and a batch breaking any of them is rejected whole:

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

const SYSTEM = [INTRO, SYSTEM_TASK_OPEN, HARD_RULES].join("\n\n");
const SYSTEM_ANCHORED = [INTRO, TASK_ANCHORED, HARD_RULES].join("\n\n");

/** How a page's planned framing of the anchor is stored on page_plan.magnet_frame. */
export interface PlannedFrame {
  title: string;
  ctaLabel: string;
  conciergeEntry: string;
}

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
  /** The client's anchor offer, when one is set. Switches the whole task to framings. */
  anchor: LeadMagnet | null;
  /** This page's planned framing of the anchor, from page_plan, when there is one. */
  plannedFrame: PlannedFrame | null;
  /**
   * The approved angle these offers are being written FROM, on the plan path.
   *
   * ‼️ THE PROVENANCE OF A MAGNET IS THE ANGLE, AND THE COLUMN FOR IT HAD NO WRITER.
   * `page_magnet_candidates.angle_id` was added by docs/2026-09-17-page-datasets-and-angles.sql and
   * nothing ever filled it, so "which idea produced this offer" was recoverable only by going back
   * through page_plan and hoping the approved angle had not since been re-picked. It is carried here
   * rather than re-queried because gather already reads the row.
   */
  angleId: string | null;
  /**
   * The written-post SHAPE the picked angle carries, on the plan path.
   *
   * Recorded on the candidate so the corpus can answer "which shapes produce offers people
   * approve". It is deliberately NOT written onto the minted lead_magnets row: see the note at the
   * insert in approveMagnetCandidate.
   */
  postFormat: string | null;
  /**
   * What step 12 saw on this keyword's Google results page, and what it decided to build.
   *
   * ‼️ THE DECISION IS TAKEN NINE STEPS BEFORE THE PAGE EXISTS, AND THIS IS WHAT CARRIES IT ACROSS.
   * Somebody screenshots a SERP at step 12, the reader records that the page already hands over a
   * script, and assetFitFrom scores it a 5; then asset-ideas.ts names the thing worth building. All
   * of that was stored on keyword_serp_reads and read by NOTHING: step 21 drafted this page's
   * offers from the keyword and the angle alone, so the judgement somebody made while looking at
   * the actual results page was thrown away and a model guessed again from less.
   *
   * ‼️ IT IS A BRIEF, NOT AN INSTRUCTION, and the prompt says so. The idea was written against a
   * SERP, before the angle was picked; if the angle has moved the page somewhere else, the drafter
   * has to be free to say so rather than shipping an offer that fits a page nobody is writing.
   */
  serpAssets: SerpAssetBrief | null;
}

/** The step 12 brief for one planned page, resolved from its target keyword. */
interface SerpAssetBrief {
  phrase: string;
  /** task | fact | mixed. A task has a deliverable on the screen; a fact is an explanation. */
  shape: string | null;
  /** 0..5, how much of a thing worth building was already visible on the results page. */
  fit: number | null;
  ideas: Array<{ kind: string; title: string; why: string }>;
}

/** A stored frame, validated. Drop, never repair, same as readOffer. */
export function readFrame(raw: unknown): PlannedFrame | null {
  if (!raw || typeof raw !== "object") return null;
  const bag = raw as Record<string, unknown>;
  const title = trimmed(bag.title);
  const ctaLabel = trimmed(bag.ctaLabel);
  const conciergeEntry = trimmed(bag.conciergeEntry);
  if (!title || !ctaLabel || !conciergeEntry) return null;
  return { title, ctaLabel, conciergeEntry };
}

/**
 * The anchor for this client and this audience, or null.
 *
 * Exported because the page studio prints it on the card. Reads offer.magnetKey, which
 * setAnchorMagnet in offers.ts writes, and resolves it audience-scoped exactly like every other
 * keyed lookup, so an owner anchor can never be framed into the patient catalogue.
 */
export async function anchorFor(clientId: string, audience: Audience): Promise<LeadMagnet | null> {
  const { loadOffer } = await import("@/lib/clients/offers");
  const offer = await loadOffer(clientId);
  if (!offer.magnetKey) return null;
  return magnetByKey(offer.magnetKey, audience);
}

async function gather(
  clientId: string,
  pageId: string | null,
  sections: readonly string[] = [],
  planId: string | null = null
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

  // ‼️ A NULL pageId IS THE CLIENT SCOPE, NOT A MISSING ARGUMENT. Offers drafted before any
  // page exists are written from the whole business rather than from one question, because on the
  // call there IS no page yet: `first_page` is step 29 and the walk is at 19. Everything else
  // below is identical, which is the reason this is a branch here and not a second function.
  let question: string;
  let slug = "";
  // Set only on the plan branch. A page-scoped or client-scoped draft has no single angle behind it.
  let angleId: string | null = null;
  // Same branch, same reason: only a planned page has a picked shape behind it.
  let postFormat: string | null = null;
  // Same branch again: only a planned page has ONE keyword, and so one results page, behind it.
  let serpAssets: SerpAssetBrief | null = null;

  if (pageId) {
    const { data: page } = await supabaseAdmin
      .from("client_pages")
      .select("question, slug")
      .eq("id", pageId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (!page) return { ok: false, error: "That page does not exist." };

    question = ((page.question as string | null) ?? "").trim();
    if (!question) {
      return { ok: false, error: "That page has no question, so there is nothing to write an offer for." };
    }
    slug = (page.slug as string | null) ?? "";
  } else if (planId) {
    // ‼️ THE PLAN SCOPE: A PAGE THAT IS DECIDED BUT NOT YET WRITTEN. Matthew, 2026-09-17: "after
    // this we should pre generate 3 ideas for lead magnets for each page we are drafting so the AI
    // concierge can actually recommend that offer as part of the things that the little pet says."
    //
    // The offers have to exist BEFORE the body, or the widget on a freshly drafted page has nothing
    // page-specific to hand over and falls back to whatever the ladder ranks, which is the same
    // thing on every page. The page row does not exist yet at step 21, so the grounding is the
    // planned page's keyword and the ANGLE somebody picked for it, which is a better brief than the
    // body would have been: it says what the page will argue rather than what it happened to say.
    const { data: planRow } = await supabaseAdmin
      .from("page_plan")
      .select("target_keyword, working_title, question, angle, target_keyword_id")
      .eq("id", planId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (!planRow) return { ok: false, error: "That planned page is not on file." };

    serpAssets = await serpAssetsFor(
      clientId,
      (planRow.target_keyword_id as string | null) ?? null,
      ((planRow.target_keyword as string | null) ?? "").trim()
    );

    // Its own select: page_angles is newer than everything around it, and one unknown column fails
    // the WHOLE select rather than costing a field.
    const { data: angleRow } = await supabaseAdmin
      .from("page_angles")
      .select("id, idea, promise, indoctrination, post_format")
      .eq("client_id", clientId)
      .eq("plan_id", planId)
      .eq("status", "approved")
      .maybeSingle();

    angleId = typeof angleRow?.id === "string" ? angleRow.id : null;
    postFormat = typeof angleRow?.post_format === "string" ? angleRow.post_format : null;

    const keyword = ((planRow.target_keyword as string | null) ?? "").trim();
    const idea = ((angleRow?.idea as string | null) ?? (planRow.angle as string | null) ?? "").trim();

    question = [
      ((planRow.question as string | null) ?? (planRow.working_title as string | null) ?? keyword).trim(),
      idea ? `What this page argues: ${idea}` : "",
      angleRow?.promise ? `What the reader walks away with: ${String(angleRow.promise)}` : "",
      angleRow?.indoctrination ? `The belief it installs: ${String(angleRow.indoctrination)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    if (!question.trim()) {
      return { ok: false, error: "That planned page has no keyword or angle, so there is nothing to write an offer for." };
    }
  } else {
    // The sections are their OWN navigation, read off their site by buildSiteReplica. Naming them
    // is what stops these five reading like five offers for a category rather than for a business.
    question =
      sections.length > 0
        ? `What this business actually does. Their own website is organised as: ${sections.join(", ")}.`
        : "What this business actually does, for somebody who has just found them.";
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

  const anchor = await anchorFor(clientId, tenant.audience);

  // The planned framing, when this page came off an approved plan. Read tolerantly: a missing
  // page_plan table (docs/2026-09-11-page-plan.sql not yet run) degrades to "no plan", which is
  // how every page behaved before plans existed, rather than failing the five.
  let plannedFrame: PlannedFrame | null = null;
  if (pageId && anchor) {
    const { data: planRow, error: planError } = await supabaseAdmin
      .from("page_plan")
      .select("magnet_frame")
      .eq("client_id", clientId)
      .eq("page_id", pageId)
      .maybeSingle();
    if (!planError) plannedFrame = readFrame(planRow?.magnet_frame);
  }

  // Same normalisation page-gate.ts uses, so 1,200 and 1200 are the same number. The anchor's own
  // words are in the haystack when there is one: a framing may repeat what the anchor promises,
  // and "Twenty questions" on the audit is not a number the framing invented.
  const numberHaystack = [
    ...evidence.map((e) => e.content),
    anchor ? `${anchor.title} ${anchor.promise}` : "",
  ]
    .join(" ")
    .replace(/[,$]/g, "");

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
      slug,
      evidenceBlock,
      validRefs,
      numberHaystack,
      avatarBlock,
      existingBlock,
      clientName,
      anchor,
      plannedFrame,
      angleId,
      postFormat,
      serpAssets,
    },
  };
}

/**
 * The step 12 reading for a planned page's target keyword.
 *
 * ‼️ RESOLVED ON `normalized`, NOT ON keyword_id, and keyword-strategy.ts's own header says why:
 * resetForNewOffer hard-deletes keyword rows when the offer changes, so keyword_id goes null while
 * the reading stays true. The id is tried first because it is exact; the phrase is the fallback that
 * survives a re-scope, and `keywords delete all` is now a third way for that id to vanish.
 *
 * ‼️ ITS OWN SELECT, TOLERANT, AND A FAILURE COSTS NOTHING. Every column it names arrives with
 * docs/2026-09-27-keyword-decision-cards.sql. On a database without that file this returns null and
 * the offers are drafted exactly as they were before, which is what they were drafted from for the
 * whole of this lane's history.
 */
async function serpAssetsFor(
  clientId: string,
  keywordId: string | null,
  phrase: string
): Promise<SerpAssetBrief | null> {
  if (!keywordId && !phrase) return null;

  const { normalizePhrase } = await import("@/lib/clients/phrase-quality");

  let q = supabaseAdmin
    .from("keyword_serp_reads")
    .select("phrase, normalized, answer_shape, asset_fit, asset_ideas, keyword_id")
    .eq("client_id", clientId)
    // Newest first: a re-screenshot months later is a second fact about the same page, and the
    // latest reading is the one the card shows and the one somebody decided against.
    .order("created_at", { ascending: false })
    .limit(1);

  q = keywordId ? q.eq("keyword_id", keywordId) : q.eq("normalized", normalizePhrase(phrase));

  const { data, error } = await q.maybeSingle();
  if (error || !data) {
    // A missing column means the migration has not run; a missing row means nobody screenshotted
    // this keyword. Neither is worth a line in the log, and neither changes what happens next.
    return null;
  }

  const ideas = Array.isArray(data.asset_ideas)
    ? (data.asset_ideas as unknown[])
        .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
        .filter((r) => typeof r.kind === "string" && typeof r.title === "string")
        .map((r) => ({
          kind: String(r.kind),
          title: String(r.title),
          why: typeof r.why === "string" ? r.why : "",
        }))
    : [];

  const shape = typeof data.answer_shape === "string" ? data.answer_shape : null;
  const fit = typeof data.asset_fit === "number" ? data.asset_fit : null;

  // Nothing was read and nothing was proposed: there is no brief here, and saying so with a null is
  // better than handing the prompt three empty fields to reason about.
  if (!shape && fit === null && !ideas.length) return null;

  return { phrase: (data.phrase as string | null) ?? phrase, shape, fit, ideas };
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
 * What somebody saw on this keyword's results page at step 12, as a brief.
 *
 * ‼️ IT IS EVIDENCE ABOUT GOOGLE, NOT AN ORDER. The ideas were written against a SERP before this
 * page's angle was picked, so the prompt is told to prefer them and told, in the same breath, that
 * it may say the angle has moved past them. An instruction here would let a judgement made about a
 * results page in September override the idea somebody approved for the page last week, and the
 * later decision is the better one.
 *
 * ‼️ A `fact` SHAPE IS WORTH SAYING OUT LOUD TOO. It means the results page was an explanation with
 * nothing on it to open, which is exactly when a drafter is most likely to invent a "guide" nobody
 * would trade an email for. Naming it is what lets the offer come from the business instead.
 */
function serpAssetLines(brief: SerpAssetBrief | null): string[] {
  if (!brief) return [];

  const out = [`WHAT GOOGLE ALREADY SHOWS FOR "${brief.phrase}", looked at and scored at step 12:`];

  if (brief.shape === "fact") {
    out.push(
      "The results page is an explanation. There is no deliverable on it to build a better version of,",
      "so the offer has to come from what this business knows or does, not from beating the page."
    );
  } else if (brief.shape) {
    out.push(
      `The results page carries a deliverable somebody could use (${brief.shape}), scored ${brief.fit ?? "?"} out of 5`,
      "for how much of it is already visible. That is the thing to beat: ours has to be the better version."
    );
  }

  if (brief.ideas.length) {
    out.push("", "WHAT WAS PROPOSED WHILE LOOKING AT IT. Prefer these where they still fit:");
    for (const i of brief.ideas) out.push(`  - ${i.kind}: ${i.title}${i.why ? ` (${i.why})` : ""}`);
    out.push(
      "If the angle picked for this page has moved past them, say so in the rationale and write a better one.",
      "Do not force one of these onto a page that is now arguing something else."
    );
  }

  out.push("");
  return out;
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
  return draftInto(clientId, pageId, [], opts);
}

/**
 * Write five candidate offers for the CLIENT, before any page of theirs exists.
 *
 * ‼️ THIS IS THE ONE THAT MAKES THE CALL WORTH WALKING, AND IT EXISTS BECAUSE OF WHEN THINGS RUN.
 * `draftMagnetsForPage` has always been able to write five real offers about a business. It is
 * reached only from `startPageDraft`, and no step before the call writes a page: `page_candidates`
 * scores questions and `first_page` is step 29. So `magnetsForClient()` on the replica could only
 * ever return the seven generic library rows, and a prospect was shown "Free AI visibility scan"
 * on a rebuild of their own website. Measured 2026-09-04: every one of the six live clients had
 * zero offers of their own.
 *
 * ‼️ ONE APPROVED CLIENT OFFER COVERS EVERY PAGE, WHICH IS WHY THERE IS NO PER-PAGE DECISION HERE.
 * rungOf() scores a client_id row at 8, above every library rung, so the minted magnet is what the
 * ladder resolves on every replica section and every hub page this client ever gets, until a page
 * names something more specific. The per-page drafter stays exactly as it was for that case.
 *
 * `sections` is their own navigation, as read off their site by buildSiteReplica. It is grounding,
 * not a target: it stops five offers reading like five offers for an industry.
 */
export async function draftMagnetsForClient(
  clientId: string,
  sections: readonly string[] = [],
  opts: { replace?: boolean } = {}
): Promise<DraftResult> {
  return draftInto(clientId, null, sections, opts);
}

/**
 * Write candidate offers for a PLANNED page, before that page has been drafted.
 *
 * ‼️ BEFORE THE BODY, WHICH IS A REVERSAL. stageFrameCandidate has always minted a magnet AFTER
 * savePage, framed from the finished text. That order was deliberate and commented ("so the draft
 * knows where to stop"), and it is wrong for what the widget needs: the offer has to exist when the
 * page first renders, or the pill falls back to whatever the ladder ranks, which is the same thing
 * on every page. Matthew named that exact failure on /invisible.
 *
 * The brief is the picked ANGLE rather than the body, which is a better one: it says what the page
 * will argue instead of what it happened to say, and it is decided before the words are.
 *
 * Everything else is draftInto, unchanged, so the orphan-number check, the pill length, the dash
 * ban and the evidence-ref check are the same ones the other two entry points get.
 */
export async function draftMagnetsForPlan(
  clientId: string,
  planId: string,
  opts: { replace?: boolean } = {}
): Promise<DraftResult> {
  return draftInto(clientId, null, [], { ...opts, planId });
}

/**
 * The drafting both entry points share.
 *
 * ‼️ ONE BODY, NOT TWO, SO THE VALIDATORS CANNOT DRIFT APART. The orphan-number check, the pill
 * length, the dash ban and the evidence-ref check are the whole reason a promise read by a
 * stranger is safe to show. A second copy of this function is a second place for one of them to be
 * quietly dropped, and the one that would go first is the one that was added last.
 */
async function draftInto(
  clientId: string,
  pageId: string | null,
  sections: readonly string[],
  opts: { replace?: boolean; planId?: string | null } = {}
): Promise<DraftResult> {
  const planId = opts.planId ?? null;
  const ground = await gather(clientId, pageId, sections, planId);
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
    pageId
      ? `THE QUESTION THIS PAGE ANSWERS: ${g.question}`
      : `WHAT THESE OFFERS ARE FOR: ${g.question}
There is no page yet. These sit on a rebuild of ` +
        `their own website, so write offers that make sense anywhere on it, not offers that only ` +
        `follow from one question.`,
    "",
    "THE CUSTOMER:",
    g.avatarBlock,
    "",
    ...serpAssetLines(g.serpAssets),
    "THE SOURCES, and there are no others:",
    g.evidenceBlock,
    "",
    ...(g.anchor
      ? [
          "THE ANCHOR OFFER, which every framing hands over and nothing else:",
          `Name: ${g.anchor.title}`,
          `What it delivers: ${g.anchor.promise}`,
          `Its own pill: ${g.anchor.ctaLabel ?? g.anchor.title}`,
          ...(g.plannedFrame
            ? [
                "",
                "THE PLANNED FRAMING FOR THIS PAGE, which is candidate 1:",
                `Name: ${g.plannedFrame.title}`,
                `Pill: ${g.plannedFrame.ctaLabel}`,
                `Opening line: ${g.plannedFrame.conciergeEntry}`,
              ]
            : []),
        ]
      : ["OFFERS THAT ALREADY EXIST, do not restate these:", g.existingBlock]),
  ].join("\n");

  let batch: DraftedBatch;
  try {
    const res = await callClaudeJSON<DraftedBatch>({
      model: MODEL,
      system: g.anchor ? SYSTEM_ANCHORED : SYSTEM,
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
    // Scoped the same way the rows are: `.is("page_id", null)` and not `.eq(..., null)`, because
    // PostgREST renders the second as `page_id=eq.null` and matches nothing, which would silently
    // leave the old five in place and print ten.
    const del = supabaseAdmin.from("page_magnet_candidates").delete().eq("status", "draft");
    await (pageId
      ? del.eq("page_id", pageId)
      : planId
        // Scoped to the PLAN row, not to the client, or a re-roll on one planned page would clear
        // the drafts of the other six. `.is("page_id", null)` stays for the same PostgREST reason
        // the client branch documents: `.eq(..., null)` renders as `page_id=eq.null` and matches
        // nothing, which would leave the old ones in place and print double.
        ? del.eq("client_id", clientId).eq("plan_id", planId).is("page_id", null)
        : del.eq("client_id", clientId).is("page_id", null).is("plan_id", null));
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
    // Only when anchored, so an unanchored client's insert names no column that
    // docs/2026-09-11-page-plan.sql adds. That keeps every other client's drafting working in the
    // window between a deploy and the migration.
    ...(g.anchor?.magnetKey ? { frames_key: g.anchor.magnetKey } : {}),
    // Same reasoning one line up, for docs/2026-09-17-page-datasets-and-angles.sql: named only on
    // the plan path, so the page and client paths keep inserting exactly what they always did.
    ...(planId ? { plan_id: planId } : {}),
    // The angle these five were written FROM. Same conditional-spread rule: named only when there
    // is one, so no other path's insert gains a column it never had.
    ...(g.angleId ? { angle_id: g.angleId } : {}),
    // And the SHAPE that angle carries, for docs/2026-09-18-post-formats.sql. Same rule again.
    ...(g.postFormat ? { post_format: g.postFormat } : {}),
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

/**
 * One candidate from a plan row's APPROVED framing of the anchor, with no model call.
 *
 * ‼️ THE FRAME WAS ALREADY DECIDED, SO NOTHING IS DRAFTED. The pre-call plan words each page's
 * framing (title, pill, opening line) and a person approves the plan with it on the card. Drafting
 * five more framings per page would ask the same question again, nine times, and spend nine calls
 * doing it. This stages exactly that one frame as a candidate row, and approveMagnetCandidate then
 * mints it with every copy check it already runs. That function keeps the ONLY insert into
 * lead_magnets anywhere in src/.
 *
 * The anchor's own promise is what the framing delivers, so it is the candidate's promise: a
 * framing may narrow the focus, never add a deliverable.
 */
export async function stageFrameCandidate(args: {
  clientId: string;
  pageId: string;
  frame: PlannedFrame;
  /**
   * The finished page body, when there is one.
   *
   * ‼️ OPTIONAL, AND IT ONLY BECAME AVAILABLE ON 2026-09-14. The pre-call wave used to mint the
   * magnet BEFORE drafting, so at this point the page had no body and there was nothing to check
   * a framing against. Now the magnet is minted after savePage and this is the page that exists.
   *
   * It is used as the number haystack and nothing else. The framing itself is still the one a
   * person approved with the plan: this validates it, it does not rewrite it.
   */
  body?: string | null;
}): Promise<{ ok: true; candidateId: string } | { ok: false; error: string }> {
  const tenant = await conciergeTenant(args.clientId);
  if (!tenant) return { ok: false, error: "this client has no concierge row, so there is no catalogue to mint into" };

  const anchor = await anchorFor(args.clientId, tenant.audience);
  if (!anchor?.magnetKey) return { ok: false, error: "no anchor offer is set. `anchor: <key>` names it" };

  const title = args.frame.title.trim();
  const ctaLabel = args.frame.ctaLabel.trim();
  const entry = args.frame.conciergeEntry.trim();
  if (!title || !ctaLabel || !entry) return { ok: false, error: "the planned framing is incomplete" };
  if (ctaLabel.length > CTA_MAX) return { ok: false, error: `the planned pill is ${ctaLabel.length} characters, the limit is ${CTA_MAX}` };
  if ([title, ctaLabel, entry].some(hasBannedDash)) return { ok: false, error: "the planned framing contains a dash" };

  // ‼️ THE FRAMING IS CHECKED AGAINST THE PAGE IT SITS ON, which only became possible when the
  // mint moved after the draft. orphanNumbers is the same rule draftInto applies to a model's
  // five candidates and page-gate.ts applies to a body: a figure in a promise is read by a
  // stranger in the widget and is exactly as publishable-and-false as one in the copy.
  //
  // The anchor's own promise is part of the haystack because the framing is allowed to restate
  // what the anchor offers; that number was approved once already, on the anchor.
  if (args.body?.trim()) {
    const haystack = `${args.body} ${anchor.promise} ${anchor.title}`.replace(/[,$]/g, "");
    const invented = orphanNumbers(`${title} ${ctaLabel} ${entry}`, haystack);
    if (invented.length) {
      return {
        ok: false,
        error:
          `the planned framing states ${invented.join(", ")}, which the finished page does not carry. ` +
          `Fix the framing on the plan row, or say it on the page.`,
      };
    }
  }

  const { data, error } = await supabaseAdmin
    .from("page_magnet_candidates")
    .insert({
      client_id: args.clientId,
      page_id: args.pageId,
      audience: tenant.audience,
      title,
      promise: anchor.promise,
      cta_label: ctaLabel,
      concierge_entry: entry,
      rationale: "The framing approved with the page plan.",
      evidence_refs: [],
      status: "draft",
      // Null, because no model wrote this row: it is the plan's framing, copied.
      model: null,
      frames_key: anchor.magnetKey,
    })
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: `the framing could not be staged: ${error.message}` };
  if (!data?.id) return { ok: false, error: "the framing was not staged" };
  return { ok: true, candidateId: String(data.id) };
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
    pageId: row.page_id == null ? null : String(row.page_id),
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
export async function draftsForClient(clientId: string): Promise<MagnetCandidate[]> {
  // ‼️ `plan_id IS NULL` IS NOT OPTIONAL, AND ITS ABSENCE WAS A REAL BUG. This table holds THREE
  // scopes and draftInto's own delete already tells them apart: page-scoped (`page_id` set),
  // plan-scoped (`page_id` null, `plan_id` set, one set per planned page) and client-scoped (both
  // null). Reading on `page_id IS NULL` alone returns step 21's plan drafts as though they were
  // this client's own, so once `magnets auto` had run, step 19's card announced seven pages' worth
  // of page framings as "offers written for this business" with an approve button on them.
  //
  // `.is()` and never `.eq(..., null)`, for the reason the delete documents: PostgREST renders
  // `.eq("plan_id", null)` as `plan_id=eq.null`, which matches nothing at all.
  const { data, error } = await supabaseAdmin
    .from("page_magnet_candidates")
    .select(CANDIDATE_COLUMNS)
    .eq("client_id", clientId)
    .is("page_id", null)
    .is("plan_id", null)
    .eq("status", "draft")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error(`[magnet-drafts] draftsForClient: ${error.message}`);
    return [];
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toCandidate);
}

/**
 * Whether this client already has an offer of their own in the catalogue.
 *
 * Used to decide whether the replica should draft any. It asks the CATALOGUE rather than the
 * candidates table, because an approved draft and a hand-seeded row are the same fact to a visitor
 * and only one of them leaves a candidate row behind.
 */
export async function hasOwnMagnet(clientId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("lead_magnets")
    .select("id")
    .eq("client_id", clientId)
    .eq("active", true)
    .limit(1);
  return (data ?? []).length > 0;
}

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
    // A client-scoped draft belongs to no page and must not be grouped under one. The board's
    // per-page optgroup would otherwise offer the same five under every page on the hub.
    if (!c.pageId) continue;
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
  | {
      ok: true;
      magnetKey: string;
      title: string;
      ctaLabel: string;
      /** The anchor this offer frames, when it was drafted as a framing. */
      framesKey?: string | null;
    }
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
  /** Null approves a CLIENT-scoped draft: it mints the offer and points no page at it. */
  pageId: string | null;
  candidateId: string;
  by: string | null;
}): Promise<ApproveResult> {
  // ‼️ SCOPED WITH `.is()` FOR THE NULL CASE. PostgREST turns `.eq("page_id", null)` into
  // `page_id=eq.null`, which matches no row at all, so a client-scoped approval would report
  // "that draft does not belong" for a draft that is sitting right there.
  let read = supabaseAdmin
    .from("page_magnet_candidates")
    .select(CANDIDATE_COLUMNS)
    .eq("id", args.candidateId)
    .eq("client_id", args.clientId);
  // ‼️ AND `plan_id IS NULL` ON THE CLIENT BRANCH. `pageId: null` reaches here from exactly one
  // caller, the `client_magnet_approve` button on step 19's card, which is a CLIENT-scoped
  // decision. Without this a stale button whose id now names one of step 21's plan drafts would
  // mint that page's framing as the client-rung magnet and consume the one approved slot
  // `page_magnet_candidates_one_client_approved` allows.
  read = args.pageId ? read.eq("page_id", args.pageId) : read.is("page_id", null).is("plan_id", null);

  const { data: row, error: readError } = await read.maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!row) {
    return {
      ok: false,
      error: args.pageId
        ? "That draft does not belong to this page."
        : "That draft does not belong to this client, or it was written for a page rather than for the business.",
    };
  }

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

  // Which anchor this draft was written as a framing of, if any. Read on its own and tolerantly,
  // for the reason magnets.ts gives for frames_key: CANDIDATE_COLUMNS feeds every read of this
  // table, and one unknown column there fails all of them before the migration has run.
  const { data: frameRow, error: frameError } = await supabaseAdmin
    .from("page_magnet_candidates")
    .select("frames_key")
    .eq("id", cand.id)
    .maybeSingle();
  const framesKey =
    !frameError && typeof frameRow?.frames_key === "string" && frameRow.frames_key.trim()
      ? frameRow.frames_key.trim()
      : null;

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
      //
      // ‼️ AND category STAYS NULL NOW THAT PAGES SEND ONE, WHICH IS THE OPPOSITE OF WHAT IT LOOKS
      // LIKE IT SHOULD DO. The 2026-09-18 build prompt asked for the minted magnet to take the
      // format's category so it would be "reachable by a categorised query". That is backwards, and
      // rungOf is where you can read why: a row with category null is a WILDCARD that matches every
      // query, while a row carrying "Comparison" matches ONLY a query carrying exactly that. Writing
      // the category here would therefore not widen this magnet, it would HIDE it from every page of
      // the client's own site that is not that one shape, including the hub index, the replica and
      // the preview lane. It also buys nothing: a client magnet already scores 8, above every
      // library rung, so a category match would take it from 8 to 9 in a contest it already wins.
      vertical: null,
      treatment: null,
      category: null,
      title: cand.title,
      promise: cand.promise,
      cta_label: cand.ctaLabel,
      // Never env-backed and never a URL, so isDeliverable() is unconditionally true. See header.
      // A framing hands over its anchor's asset through frames_key at delivery time, which is why
      // the anchor's URL is still not copied here.
      asset_url: null,
      concierge_entry: cand.conciergeEntry,
      active: true,
      sort_order: 50,
      ...(framesKey ? { frames_key: framesKey } : {}),
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

  // ‼️ NOTHING IS POINTED AT A CLIENT-SCOPED OFFER, AND THAT IS THE WHOLE MECHANISM. There is no
  // page yet to carry a lead_magnet_key. The row is reached by the ladder instead, at the client
  // rung, which is above every library rung, so it is what resolves on every replica section and
  // on every page written later that does not name something more specific.
  if (args.pageId) {
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
  //
  // ‼️ THE CLIENT BRANCH MUST NOT REACH THE PLAN DRAFTS, AND IT USED TO. Scoped on
  // `page_id IS NULL` alone, approving one client-scoped offer rejected every plan-scoped draft
  // this client had, which is three options on each of seven planned pages. `magnets` then listed
  // nothing and `magnet 3 pick 2` had nothing to pick, on a plan nobody had touched.
  const siblings = supabaseAdmin
    .from("page_magnet_candidates")
    .update({ status: "rejected", decided_at: now, decided_by: args.by })
    .eq("status", "draft");
  await (args.pageId
    ? siblings.eq("page_id", args.pageId)
    : siblings.eq("client_id", args.clientId).is("page_id", null).is("plan_id", null));

  return { ok: true, magnetKey, title: cand.title, ctaLabel: cand.ctaLabel, framesKey };
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
