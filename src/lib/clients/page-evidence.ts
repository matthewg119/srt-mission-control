// The evidence behind a page: what was collected, from whom, and whether anybody verified it.
//
// WHY THIS FILE EXISTS. The page studio already captures the thing that matters most, which is
// the business's own words going in verbatim. What it could not do was keep them as anything
// other than page body. A provider's pricing philosophy dictated into one page was invisible to
// the next page that needed it, and a page written from the website crawl had no record of what
// it was written from.
//
// !! page_id NULL IS THE CLIENT LIBRARY. It is meaningful state, not an unattached row.
// Anything about the business rather than about one question is filed with a null page_id and a
// topic, and every later page for that client reads it. Nothing may treat a null page_id as
// garbage to collect.
//
// !! AI_DERIVED IS NOT EVIDENCE. isFirstParty() below is the ONE place that decides which types
// count, and every consumer imports it rather than writing the list again. A second copy of that
// list is how "the client said this" and "a model wrote this" quietly become the same thing.

import { supabaseAdmin } from "@/lib/db";

export type SourceType =
  | "CLIENT_VOICE"
  | "CLIENT_DOCUMENT"
  | "CLIENT_WEBSITE"
  | "FIRST_PARTY_DATA"
  | "EXTERNAL_RESEARCH"
  | "AI_DERIVED";

export type CollectedVia = "slack_voice" | "slack_typed" | "board" | "crawl" | "audit";

export interface PageSource {
  id: string;
  clientId: string;
  pageId: string | null;
  sourceType: SourceType;
  sourceContent: string;
  topic: string | null;
  sourceUrl: string | null;
  sourceDate: string | null;
  collectedBy: string | null;
  collectedVia: CollectedVia | null;
  slackTs: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

const COLUMNS =
  "id, client_id, page_id, source_type, source_content, topic, source_url, source_date, " +
  "collected_by, collected_via, slack_ts, verified_by, verified_at, created_at";

function toSource(row: Record<string, unknown>): PageSource {
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    pageId: (row.page_id as string | null) ?? null,
    sourceType: row.source_type as SourceType,
    sourceContent: (row.source_content as string) ?? "",
    topic: (row.topic as string | null) ?? null,
    sourceUrl: (row.source_url as string | null) ?? null,
    sourceDate: (row.source_date as string | null) ?? null,
    collectedBy: (row.collected_by as string | null) ?? null,
    collectedVia: (row.collected_via as CollectedVia | null) ?? null,
    slackTs: (row.slack_ts as string | null) ?? null,
    verifiedBy: (row.verified_by as string | null) ?? null,
    verifiedAt: (row.verified_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/**
 * Does this source type carry knowledge that came from the business?
 *
 * !! THE ONE DEFINITION. Everything that counts first-party evidence imports this. The gate's
 * `no_evidence` and `first_party_ratio` checks and the drafter's grounding all read the same
 * answer, so a page can never pass one and fail the other on a disagreement about what a type
 * means.
 *
 * EXTERNAL_RESEARCH is real evidence and may support a claim, but it is not the business's own
 * knowledge and never satisfies the first-party floor. AI_DERIVED is not evidence at all: it is
 * a record that a passage has nothing behind it.
 */
export function isFirstParty(type: SourceType): boolean {
  return (
    type === "CLIENT_VOICE" ||
    type === "CLIENT_DOCUMENT" ||
    type === "CLIENT_WEBSITE" ||
    type === "FIRST_PARTY_DATA"
  );
}

/** Evidence, as opposed to a record that there is none. */
export function isEvidence(type: SourceType): boolean {
  return type !== "AI_DERIVED";
}

/** How a type reads on a card or a panel. */
export function sourceLabel(type: SourceType): string {
  switch (type) {
    case "CLIENT_VOICE":
      return "Their own words";
    case "CLIENT_DOCUMENT":
      return "A document they gave us";
    case "CLIENT_WEBSITE":
      return "Their website";
    case "FIRST_PARTY_DATA":
      return "Their own data";
    case "EXTERNAL_RESEARCH":
      return "Outside research";
    case "AI_DERIVED":
      return "No source behind it";
  }
}

// ---------------------------------------------------------------------------
// The interview
// ---------------------------------------------------------------------------

export interface EvidenceTopic {
  key: string;
  /** Asked out loud, in the second person, because he reads it and then answers it. */
  prompt: string;
  /**
   * Client-level topics file with page_id null and feed every later page. Page-level ones are
   * about this one question and would be wrong to reuse.
   */
  scope: "client" | "page";
}

/**
 * The interview, in the order it is walked.
 *
 * !! ORDER IS NOT ARBITRARY. The page-scoped questions come FIRST, while the question he just
 * claimed is still what he is thinking about. The client-level ones are the same every time and
 * are the ones most likely to already be answered from an earlier page, so they come after and
 * are skippable without losing the thing he opened the thread for.
 */
export const EVIDENCE_TOPICS: EvidenceTopic[] = [
  {
    key: "direct_answer",
    scope: "page",
    prompt: "How do you actually answer this when a patient or customer asks it in the room?",
  },
  {
    key: "experience",
    scope: "page",
    prompt: "What do you see in your own patients or customers around this? Anything that surprises people.",
  },
  {
    key: "process",
    scope: "page",
    prompt: "Walk through how you do it, step by step, the way you would explain it on the phone.",
  },
  {
    key: "candidacy",
    scope: "page",
    prompt: "Who is a good candidate for this, and who do you turn away.",
  },
  {
    key: "misconceptions",
    scope: "page",
    prompt: "What do people get wrong about this before they come in.",
  },
  {
    key: "examples",
    scope: "page",
    prompt: "A real example you can tell without naming anybody.",
  },
  {
    key: "pricing",
    scope: "client",
    prompt:
      "Pricing, in the range you would actually say out loud, and what moves it. Skip this if you would not put a number on a page.",
  },
  {
    key: "geography",
    scope: "client",
    prompt: "Where you serve, and anything local that matters to how you do this.",
  },
  {
    key: "terminology",
    scope: "client",
    prompt: "The words your customers use for this, including the ones that are technically wrong.",
  },
  {
    key: "qualifications",
    scope: "client",
    prompt: "Your training, licences and years doing this, only what you can prove.",
  },
  {
    key: "policies",
    scope: "client",
    prompt: "Policies that touch this: consultations, deposits, follow-ups, cancellations.",
  },
];

export function topicByKey(key: string): EvidenceTopic | undefined {
  return EVIDENCE_TOPICS.find((t) => t.key === key);
}

/**
 * The next topic after this one, or null at the end.
 *
 * A null key means "start", which is how `ask` enters the walk without special-casing the first
 * topic at the call site.
 */
export function nextTopic(key: string | null): EvidenceTopic | null {
  if (!key) return EVIDENCE_TOPICS[0] ?? null;
  const i = EVIDENCE_TOPICS.findIndex((t) => t.key === key);
  if (i < 0) return EVIDENCE_TOPICS[0] ?? null;
  return EVIDENCE_TOPICS[i + 1] ?? null;
}

/** Where in the walk we are, for a card that has to say so. */
export function topicPosition(key: string): { at: number; of: number } {
  const i = EVIDENCE_TOPICS.findIndex((t) => t.key === key);
  return { at: i < 0 ? 1 : i + 1, of: EVIDENCE_TOPICS.length };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface RecordSourceInput {
  clientId: string;
  /** Null files it in the client library, where every later page can read it. */
  pageId: string | null;
  sourceType: SourceType;
  sourceContent: string;
  topic?: string | null;
  sourceUrl?: string | null;
  sourceDate?: string | null;
  collectedBy?: string | null;
  collectedVia?: CollectedVia | null;
  slackTs?: string | null;
}

/**
 * File one source, verbatim.
 *
 * !! NOTHING IN HERE READS THE TEXT, for the same reason appendPageBody does not. The whole
 * value of this table is that it holds what was actually said. A tidy-up here would make the
 * evidence a paraphrase of the evidence, and every claim traced back to it would be traced back
 * to a model's words wearing the client's label.
 */
export async function recordSource(
  input: RecordSourceInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const content = input.sourceContent.trim();
  if (!content) return { ok: false, error: "There was nothing to file." };

  const { data, error } = await supabaseAdmin
    .from("page_sources")
    .insert({
      client_id: input.clientId,
      page_id: input.pageId,
      source_type: input.sourceType,
      source_content: content,
      topic: input.topic ?? null,
      source_url: input.sourceUrl ?? null,
      source_date: input.sourceDate ?? null,
      collected_by: input.collectedBy ?? null,
      collected_via: input.collectedVia ?? null,
      slack_ts: input.slackTs ?? null,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data?.id) return { ok: false, error: "The source was not filed." };
  return { ok: true, id: data.id as string };
}

/**
 * Remember the crawl instead of throwing it away.
 *
 * draftPage reads the client's website live on every draft and discards it, so a published page
 * written from that crawl had no record of what it was written from and the gate had nothing to
 * check its numbers against. This keeps ONE current row per URL: the site changes, and an
 * eighteen-month-old crawl asserted as today's fact is worse than no row.
 */
export async function recordWebsiteSnapshot(args: {
  clientId: string;
  url: string;
  content: string;
}): Promise<void> {
  const content = args.content.trim();
  if (!content) return;

  const { data: existing } = await supabaseAdmin
    .from("page_sources")
    .select("id")
    .eq("client_id", args.clientId)
    .eq("source_type", "CLIENT_WEBSITE")
    .eq("source_url", args.url)
    .is("page_id", null)
    .maybeSingle();

  const now = new Date().toISOString();

  if (existing?.id) {
    await supabaseAdmin
      .from("page_sources")
      .update({
        source_content: content,
        source_date: now.slice(0, 10),
        updated_at: now,
      })
      .eq("id", existing.id as string);
    return;
  }

  await recordSource({
    clientId: args.clientId,
    pageId: null,
    sourceType: "CLIENT_WEBSITE",
    sourceContent: content,
    topic: "What their own website says",
    sourceUrl: args.url,
    sourceDate: now.slice(0, 10),
    collectedVia: "crawl",
  });
}

/**
 * A person read this source and says it is true.
 *
 * Verification is a claim about the world and is recorded as one. It is deliberately NOT what
 * the gate blocks on: an unverified source is still the client's own words, and requiring a
 * second human pass before anything could publish would make the gate a queue rather than a
 * check. It shows on the panel so somebody can see what has been read.
 */
export async function verifySource(
  id: string,
  by: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabaseAdmin
    .from("page_sources")
    .update({
      verified_by: by,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteSource(
  clientId: string,
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabaseAdmin
    .from("page_sources")
    .delete()
    .eq("id", id)
    .eq("client_id", clientId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Everything a page may be written from: its own sources plus the client library.
 *
 * Page-scoped first, because they are about the question actually being answered and the drafter
 * numbers them in the order it receives them.
 */
export async function loadEvidenceFor(
  clientId: string,
  pageId: string | null
): Promise<PageSource[]> {
  const { data, error } = await supabaseAdmin
    .from("page_sources")
    .select(COLUMNS)
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[page-evidence] load failed:", error.message);
    return [];
  }

  const all = (data ?? []).map((r) => toSource(r as unknown as Record<string, unknown>));
  const mine = pageId ? all.filter((s) => s.pageId === pageId) : [];
  const library = all.filter((s) => s.pageId === null);
  return [...mine, ...library];
}

/** Just the client library, for a panel that groups the two. */
export async function loadClientLibrary(clientId: string): Promise<PageSource[]> {
  const all = await loadEvidenceFor(clientId, null);
  return all.filter((s) => s.pageId === null);
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

/** Per-source and total ceilings, so a large client library cannot crowd out the question. */
const SOURCE_CHARS = 2500;
const EVIDENCE_CHARS = 18000;

/** A source as a prompt sees it: numbered, typed, and quoted verbatim. */
export interface EvidenceRef {
  ref: string;
  type: SourceType;
  label: string;
  topic: string | null;
  content: string;
  scope: "this page" | "the business";
  /** Null for the two virtual rows synthesized out of audit_reports. */
  sourceId: string | null;
}

/**
 * Number the evidence S1..Sn.
 *
 * !! THERE IS EXACTLY ONE OF THESE AND THAT IS THE POINT. The drafter writes `sourceRef: "S3"`
 * into client_pages.evidence_map and the gate reads that ref back weeks later to decide whether
 * a claim rests on the business's own knowledge. If the two numbered the same sources
 * differently, every stored ref would silently point at a different source than the one it was
 * written against, and the first_party_ratio check would be measuring nothing. Both call this.
 *
 * !! FIRST-PARTY SOURCES ARE NUMBERED FIRST AND SURVIVE THE TRIM. The whole point of this layer
 * is that the business's own knowledge outranks anything general, so an outside-research row can
 * be dropped by the ceiling and a dictated answer never is. Page-scoped comes before the client
 * library within that, because it is about the question actually being answered.
 *
 * The sort must stay STABLE for the same input, since stored refs are compared against it. Array
 * .sort is stable in every runtime this ships to, and the reads that feed it are ordered by
 * created_at, so equal keys keep their creation order.
 */
export function numberEvidence(sources: PageSource[]): EvidenceRef[] {
  const ordered = [...sources]
    .filter((s) => isEvidence(s.sourceType)) // A record of absence is not something to cite.
    .sort((a, b) => {
      const fp = Number(isFirstParty(b.sourceType)) - Number(isFirstParty(a.sourceType));
      if (fp !== 0) return fp;
      return Number(Boolean(b.pageId)) - Number(Boolean(a.pageId));
    });

  const out: EvidenceRef[] = [];
  let budget = EVIDENCE_CHARS;

  for (const s of ordered) {
    const content = s.sourceContent.slice(0, SOURCE_CHARS);
    if (content.length > budget) break;
    budget -= content.length;
    out.push({
      ref: `S${out.length + 1}`,
      type: s.sourceType,
      label: sourceLabel(s.sourceType),
      topic: s.topic,
      content,
      scope: s.pageId ? "this page" : "the business",
      sourceId: s.id,
    });
  }

  return out;
}

/**
 * Everything a page may be written from, numbered, including the two verbatim first-party
 * fields that have lived on audit_reports since July and that nothing here ever read.
 *
 * !! intake_answers AND call_notes ARE SYNTHESIZED AS SOURCES RATHER THAN PASTED INTO THE PROMPT.
 * They are the business's own words, written by them at intake or taken down on a call with
 * them, so a claim has to be able to point AT them. Prose folded into the preamble can ground a
 * page but cannot be cited, and an uncitable ground is exactly what produces a claim the gate
 * then reports as unsupported.
 *
 * They are appended last so they take the highest ref numbers, which keeps every ref already
 * stored in an evidence_map pointing at the same row it did when it was written. Adding a source
 * to the front would renumber history.
 */
export async function loadNumberedEvidence(
  clientId: string,
  pageId: string | null
): Promise<EvidenceRef[]> {
  const stored = await loadEvidenceFor(clientId, pageId);
  const refs = numberEvidence(stored);

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("contact_id")
    .eq("id", clientId)
    .maybeSingle();

  if (!client?.contact_id) return refs;

  const { data: report } = await supabaseAdmin
    .from("audit_reports")
    .select("intake_answers, call_notes")
    .eq("contact_id", client.contact_id as string)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!report) return refs;

  const extra: Array<[string | null, string]> = [
    [(report.intake_answers as string | null)?.trim() || null, "What they told us at intake"],
    [(report.call_notes as string | null)?.trim() || null, "What they said on the call"],
  ];

  for (const [text, topic] of extra) {
    if (!text) continue;
    refs.push({
      ref: `S${refs.length + 1}`,
      type: "FIRST_PARTY_DATA",
      label: sourceLabel("FIRST_PARTY_DATA"),
      topic,
      content: text.slice(0, SOURCE_CHARS),
      scope: "the business",
      sourceId: null,
    });
  }

  return refs;
}

/** A one-line count for a card, saying what the page actually stands on. */
export function evidenceSummary(sources: PageSource[]): string {
  const firstParty = sources.filter((s) => isFirstParty(s.sourceType)).length;
  const other = sources.filter((s) => isEvidence(s.sourceType) && !isFirstParty(s.sourceType)).length;

  if (firstParty === 0 && other === 0) return "No evidence on file.";

  const parts: string[] = [];
  if (firstParty) parts.push(`${firstParty} first-party`);
  if (other) parts.push(`${other} outside`);
  return `${parts.join(", ")}.`;
}
