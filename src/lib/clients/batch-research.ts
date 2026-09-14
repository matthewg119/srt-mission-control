// ONE research prompt for a whole batch of pages, and the router that files its answer per page.
//
// ‼️ ONE PROMPT, NOT ONE PER PAGE, AND THAT IS DECISION D3. Every choice for every page in the
// batch (the pillar, the headline, the skeleton and its gaps) is made BEFORE this fires, so the
// research is one shot. Matthew runs roughly 14 onboardings a day and reads every answer; at one
// prompt per page that is 98 paste-backs a day instead of 14, and nobody reads the 98th.
//
// ‼️ THE ANSWER IS PER PAGE, AND question_bank CANNOT HOLD IT. ingestResearch writes
// question_bank only, which is keyed (vertical, avatar) with no client_id and no page_id: it is
// deliberately SHARED across every client in a vertical, which is right for buyer phrases and
// wrong for "what does this clinic charge for that". A batch answer is evidence about one page of
// one client, so it goes to page_sources with page_id set.
//
// ‼️ NO MIGRATION. page_sources already has a nullable page_id, EXTERNAL_RESEARCH is already in
// its source_type check constraint, and slack_typed is already an allowed collected_via. All that
// was missing was something that wrote them.
//
// ‼️ AN UNTAGGED SECTION IS THE CLIENT LIBRARY, NOT AN ORPHAN. page-evidence.ts's header says a
// null page_id is "anything about the business rather than about one question", read by every
// later page, and that nothing may treat it as garbage to collect. An answer the researcher did
// not tag is usually exactly that: pricing, policy, or their customers' own terminology.

import { supabaseAdmin } from "@/lib/db";
import { recordSource } from "./page-evidence";
import type { OutlineGap, PageOutline } from "@/lib/hub/pages";

/** One planned page in a batch, with the skeleton whose gaps go into the prompt. */
export interface BatchPage {
  /** 1-based, and the number in its [Pn] tag. Stable for the life of the batch. */
  position: number;
  planRowId: string;
  pageId: string | null;
  question: string;
  headline: string | null;
  targetKeyword: string | null;
  outline: PageOutline | null;
}

/** `[P3]`, anywhere on a line, capturing the page number. */
const PAGE_TAG = /\[P(\d{1,2})\]/i;

/**
 * The rules that survive into a batch prompt.
 *
 * ‼️ COPIED IN SPIRIT FROM deep-research-run.ts's RULES AND NOT IMPORTED, because one clause
 * differs and it is the load-bearing one: this prompt's answer is parsed by tag, so the tag rule
 * has to sit beside the others rather than being bolted on after. Everything else is the same
 * doctrine: cite a URL per claim, never invent a quote or a number, quote word for word.
 */
const BATCH_RULES = [
  "Search the web. Cite a URL for every claim.",
  'Never invent a quote, a review or a number. Write "could not verify" instead, and that is a',
  "useful answer: it tells us not to put the claim on the page.",
  "Quote word for word, typos kept. The way she says it is the finding.",
  "Prefer forums, reviews and what real customers wrote over marketing pages.",
  "No em dashes.",
].join("\n");

/**
 * Build the single prompt for a whole batch.
 *
 * Every question is tagged with the page it belongs to, and the tag is what the router reads back.
 * Pages with no skeleton yet are skipped rather than asked about vaguely: a question with no
 * section behind it has nowhere to be filed.
 */
export function buildBatchResearchPrompt(args: {
  clientName: string;
  city: string | null;
  state: string | null;
  avatarLabel: string;
  offer: string | null;
  pages: readonly BatchPage[];
}): { ok: true; prompt: string; questions: number } | { ok: false; error: string } {
  const where = [args.city, args.state].filter(Boolean).join(", ");

  const blocks: string[] = [];
  let questions = 0;

  for (const page of args.pages) {
    const gaps = page.outline?.gaps ?? [];
    if (!gaps.length) continue;

    blocks.push(`[P${page.position}] ${page.headline?.trim() || page.question}`);
    if (page.targetKeyword) blocks.push(`What she typed to get here: ${page.targetKeyword}`);
    for (const gap of gaps) {
      blocks.push(`  [P${page.position}] ${gap.prompt.trim()}`);
      questions += 1;
    }
    blocks.push("");
  }

  if (!questions) {
    return {
      ok: false,
      error: "None of these pages has a skeleton yet, so there is nothing to research. Run `skeleton` first.",
    };
  }

  const prompt = [
    `Market research for ${args.clientName}${where ? `, ${where}` : ""}.`,
    `Everything below is for one buyer: ${args.avatarLabel}.`,
    ...(args.offer ? [`What they sell: ${args.offer}`] : []),
    "",
    BATCH_RULES,
    "",
    `‼️ ANSWER EVERY QUESTION UNDER THE TAG IT WAS ASKED WITH. There are ${args.pages.length} pages below and`,
    `${questions} questions across them. Start each answer with its own [Pn] tag on the same line, exactly`,
    "as it appears in the question. That tag is how each answer reaches the page it belongs to, and an",
    "answer with no tag is filed against the business as a whole rather than against any one page.",
    "",
    "Answer in the order asked. One answer per question. Where the honest answer is that you could",
    "not verify it, say so under its tag rather than leaving the tag out.",
    "",
    "THE PAGES AND THEIR QUESTIONS:",
    "",
    ...blocks,
  ].join("\n");

  return { ok: true, prompt, questions };
}

export interface RoutedSection {
  position: number | null;
  text: string;
}

/**
 * Split a pasted answer into sections, each carrying the page it was tagged for.
 *
 * ‼️ THE TAG STARTS A SECTION AND EVERYTHING UNTIL THE NEXT TAG BELONGS TO IT. A researcher's
 * answer is prose with paragraph breaks in it, so splitting on blank lines would shred one answer
 * into four rows with one tag between them. Anything BEFORE the first tag is untagged, which is
 * the preamble every model writes and the reason untagged goes to the client library rather than
 * being dropped.
 *
 * Pure, so the probe can prove the routing without a database.
 */
export function splitTaggedResearch(text: string): RoutedSection[] {
  const out: RoutedSection[] = [];
  let current: RoutedSection | null = null;

  for (const line of text.split(/\r?\n/)) {
    const m = PAGE_TAG.exec(line);
    if (m) {
      const position = Number.parseInt(m[1], 10);
      // A tag mid-paragraph is a reference, not a new answer: "see [P2] above". Only a tag in the
      // first few characters of a line opens a section.
      const at = line.indexOf(m[0]);
      if (at <= 3) {
        if (current) out.push(current);
        current = { position, text: line.slice(at + m[0].length).trim() };
        continue;
      }
    }
    if (!current) current = { position: null, text: "" };
    current.text = current.text ? `${current.text}\n${line}` : line;
  }

  if (current) out.push(current);

  return out
    .map((s) => ({ position: s.position, text: s.text.trim() }))
    .filter((s) => s.text !== "");
}

export interface BatchIngestReport {
  /** Answers filed against a specific page. */
  routed: number;
  /** Answers with no tag, filed against the business as a whole. */
  library: number;
  /** Tags naming a page that is not in this batch. */
  unknownTags: number[];
  /** How many carry a source URL. The thin-ingest alarm. */
  withUrl: number;
  /** Pages in the batch that came back with nothing at all. */
  silentPages: number[];
}

/** A URL anywhere in the answer. Same signal ingestResearch reports on the keyword rows. */
function firstUrl(text: string): string | null {
  const m = /https?:\/\/[^\s<>()\][]+/i.exec(text);
  return m ? m[0] : null;
}

/**
 * File a pasted batch answer, one page_sources row per answer.
 *
 * ‼️ THE COUNTS ARE THE WHOLE SAFETY NET AND THEY GO ON THE CARD, NOT JUST IN A REPLY. Same
 * reasoning 3c4cf57 wrote into ingestResearch: at roughly 28 paste-backs a day nobody re-reads a
 * silent success, so "7 pages, 41 answers, 38 with a source" is the only thing standing between a
 * thin answer and seven pages drafted off nothing.
 *
 * ‼️ SILENT PAGES ARE REPORTED, and that is the count that matters most. An answer that never
 * arrived for page 5 is invisible in a total: 41 answers looks healthy whether they cover seven
 * pages or six.
 */
export async function ingestBatchResearch(args: {
  clientId: string;
  pages: readonly BatchPage[];
  text: string;
  collectedBy: string;
  slackTs?: string | null;
}): Promise<{ ok: true; report: BatchIngestReport } | { ok: false; error: string }> {
  const sections = splitTaggedResearch(args.text);
  if (!sections.length) return { ok: false, error: "There was nothing in that paste to file." };

  const byPosition = new Map(args.pages.map((p) => [p.position, p]));
  const report: BatchIngestReport = {
    routed: 0,
    library: 0,
    unknownTags: [],
    withUrl: 0,
    silentPages: [],
  };
  const heard = new Set<number>();

  for (const section of sections) {
    const page = section.position === null ? null : byPosition.get(section.position) ?? null;

    if (section.position !== null && !page) {
      if (!report.unknownTags.includes(section.position)) report.unknownTags.push(section.position);
      // ‼️ STILL FILED, AGAINST THE CLIENT RATHER THAN DROPPED. A tag naming a page that is not in
      // this batch is usually a miscount in the answer, not nonsense in it. Throwing away a real
      // finding because its label was wrong is the more expensive mistake.
    }

    const url = firstUrl(section.text);
    if (url) report.withUrl += 1;

    const res = await recordSource({
      clientId: args.clientId,
      // An untagged or unknown-tagged answer is the client library, which is what a null page_id
      // already means here.
      pageId: page?.pageId ?? null,
      sourceType: "EXTERNAL_RESEARCH",
      sourceContent: section.text,
      topic: page ? `Batch research, page ${page.position}` : "Batch research, about the business",
      sourceUrl: url,
      collectedBy: args.collectedBy,
      collectedVia: "slack_typed",
      slackTs: args.slackTs ?? null,
    });

    if (!res.ok) {
      return { ok: false, error: `an answer could not be filed: ${res.error}` };
    }

    if (page?.pageId) {
      report.routed += 1;
      heard.add(page.position);
    } else {
      report.library += 1;
    }
  }

  report.silentPages = args.pages.map((p) => p.position).filter((n) => !heard.has(n));

  return { ok: true, report };
}

/** The count line. Printed on the card AND in the reply, for the reason above. */
export function batchIngestLine(report: BatchIngestReport, pageCount: number): string {
  const parts = [
    `*${report.routed}* answers filed across ${pageCount} pages`,
    `*${report.withUrl}* carry a source URL`,
  ];
  if (report.library) parts.push(`*${report.library}* about the business as a whole`);

  const lines = [parts.join(", ") + "."];

  if (!report.withUrl && report.routed) {
    lines.push(
      ":warning: *Not one answer carries a URL.* The prompt asks for one per claim, so that is the " +
        "answer being wrong rather than the parser. Re-run it before drafting."
    );
  }
  if (report.silentPages.length) {
    lines.push(
      `:warning: *Nothing came back for page${report.silentPages.length === 1 ? "" : "s"} ` +
        `${report.silentPages.join(", ")}.* Those will draft on what was already on file.`
    );
  }
  if (report.unknownTags.length) {
    lines.push(
      `Tagged for page${report.unknownTags.length === 1 ? "" : "s"} ${report.unknownTags.join(", ")}, ` +
        `which ${report.unknownTags.length === 1 ? "is" : "are"} not in this batch. Filed against the business.`
    );
  }

  return lines.join("\n");
}

/**
 * Every gap across a batch, so a caller can say how many questions it is about to ask.
 *
 * Exported because the card prints it before Matthew runs anything: "41 questions across 7 pages"
 * is the difference between pasting a prompt and knowing whether the answer that comes back is
 * the right size.
 */
export function batchGapCount(pages: readonly BatchPage[]): number {
  return pages.reduce((n, p) => n + (p.outline?.gaps?.length ?? 0), 0);
}

/** The gaps of one page, for the card. */
export function gapsFor(page: BatchPage): OutlineGap[] {
  return page.outline?.gaps ?? [];
}

/**
 * Load the batch's pages from the plan, in rank order.
 *
 * ‼️ POSITION IS ASSIGNED BY RANK AND NOT STORED, which means it is stable only while the batch
 * is. That is the right trade: a [Pn] tag lives for one research round trip, and storing it would
 * create a second ordering that could disagree with the plan's own. What must not happen is a
 * page being dropped from the plan between the prompt and the paste, which would silently shift
 * every tag after it. The card prints the numbered list so a person is looking at the same
 * numbering the prompt used.
 */
export async function loadBatchPages(
  clientId: string,
  planRowIds: readonly string[]
): Promise<BatchPage[]> {
  if (!planRowIds.length) return [];

  const { data, error } = await supabaseAdmin
    .from("page_plan")
    .select("id, rank, question, headline, target_keyword, page_id")
    .eq("client_id", clientId)
    .in("id", planRowIds as string[])
    .order("rank", { ascending: true });

  if (error) {
    console.error(`[batch-research] plan read failed: ${error.message}`);
    return [];
  }

  const rows = data ?? [];
  const outlines = new Map<string, PageOutline | null>();

  const { readPageOutline } = await import("@/lib/hub/pages");
  for (const row of rows) {
    const pageId = row.page_id as string | null;
    outlines.set(String(row.id), pageId ? await readPageOutline(clientId, pageId) : null);
  }

  return rows.map((row, i) => ({
    position: i + 1,
    planRowId: String(row.id),
    pageId: (row.page_id as string | null) ?? null,
    question: (row.question as string) ?? "",
    headline: (row.headline as string | null) ?? null,
    targetKeyword: (row.target_keyword as string | null) ?? null,
    outline: outlines.get(String(row.id)) ?? null,
  }));
}
