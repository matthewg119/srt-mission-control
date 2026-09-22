// W0 steps 2 to 5, and W2b: propose, confirm, then commit the values AND file the evidence.
//
// ‼️ ONE PRESS DOES BOTH WRITES, AND THE ORDER OF THAT DECISION MATTERS. An earlier draft of the
// 2026-09-23 prompt had the paste file its research as evidence automatically. That contradicts
// what W0 is for: if a paste writes evidence before a person has confirmed it, the page gate is
// then verifying pages against text nobody approved, and the confirmation card is theatre. The
// same press that commits the field values files the evidence.
//
// ‼️ WHY W2b MATTERS AT ALL, MEASURED 2026-09-20: research-intake.ts contains ZERO references to
// page_sources or recordSource. A pasted report is written to audience_documents and to
// avatar_briefs.research_text, and NOWHERE THE PAGE GATE READS. So you run the research precisely
// to verify what you are about to publish, paste it back, and `unsupported` and `experience_claims`
// still block the page because the gate never saw it. page-evidence.ts already declares
// EXTERNAL_RESEARCH as a SourceType. The slot exists, documented, and nothing filled it.

import { supabaseAdmin } from "@/lib/db";
import { DATASET_FIELDS, type DatasetKey } from "./dataset-spec";
import { commitValues, type ProposedValue } from "./field-values";
import type { FieldQuestion, ResearchCitation } from "./field-extraction";
import { recordSource, type RecordSourceInput } from "./page-evidence";

const DATASET_LABEL: Record<DatasetKey, string> = {
  avatar: "Avatar",
  audience: "Audience",
  offer: "Offer",
};

export interface OpenProposal {
  id: string;
  clientId: string;
  audienceId: string | null;
  sourceDocumentId: string | null;
  proposed: ProposedValue[];
  questions: FieldQuestion[];
  unanswered: string[];
  citations: ResearchCitation[];
}

/**
 * Open a proposal, discarding any older one for this client.
 *
 * ‼️ THE DISCARD IS EXPLICIT RATHER THAN A RACE. `client_field_proposals_open_idx` allows one open
 * row per client, so a second paste has to retire the first. Doing it here and saying so on the
 * card is visible; letting the insert fail would leave the operator looking at a stale card that
 * still has a button on it.
 */
export async function openProposal(args: {
  clientId: string;
  audienceId: string | null;
  sourceDocumentId: string | null;
  proposed: readonly ProposedValue[];
  questions: readonly FieldQuestion[];
  unanswered: readonly string[];
  citations: readonly ResearchCitation[];
}): Promise<{ ok: true; id: string; replaced: boolean } | { ok: false; error: string }> {
  const now = new Date().toISOString();

  const { data: stale } = await supabaseAdmin
    .from("client_field_proposals")
    .update({ status: "discarded", decided_at: now, decided_by: "superseded by a newer paste" })
    .eq("client_id", args.clientId)
    .eq("status", "open")
    .select("id");

  const { data, error } = await supabaseAdmin
    .from("client_field_proposals")
    .insert({
      client_id: args.clientId,
      audience_id: args.audienceId,
      source_document_id: args.sourceDocumentId,
      proposed: args.proposed,
      questions: args.questions,
      unanswered: args.unanswered,
      citations: args.citations,
    })
    .select("id")
    .maybeSingle();

  if (error || !data?.id) {
    if (error && /client_field_proposals/.test(error.message)) {
      return {
        ok: false,
        error:
          "the proposal could not be opened: docs/2026-09-24-commit-field-values-fn.sql has not been run.",
      };
    }
    return { ok: false, error: error?.message ?? "the proposal could not be opened" };
  }

  return { ok: true, id: String(data.id), replaced: (stale?.length ?? 0) > 0 };
}

const PROPOSAL_COLUMNS =
  "id, client_id, audience_id, source_document_id, proposed, questions, unanswered, citations";

export async function openProposalFor(clientId: string): Promise<OpenProposal | null> {
  const { data, error } = await supabaseAdmin
    .from("client_field_proposals")
    .select(PROPOSAL_COLUMNS)
    .eq("client_id", clientId)
    .eq("status", "open")
    .maybeSingle();

  if (error || !data) return null;
  return toProposal(data);
}

/**
 * The proposal with this id, open or not.
 *
 * ‼️ THIS IS WHAT THE REACTION HANDLER MUST USE, AND THE REASON IS A RACE IT CANNOT SEE. The handler
 * finds the card by its Slack message ts, which identifies one specific proposal. Passing only the
 * client id onward and re-resolving through openProposalFor would let a paste landing in between
 * swap the open row, so the confirm would commit values nobody read: the open-per-client unique
 * index guarantees one open proposal, not that it is the SAME one. Loading by id closes that, and
 * the .eq("status", "open") on the decide below closes the other half, so a lost race writes
 * nothing rather than writing twice.
 */
export async function proposalById(id: string): Promise<OpenProposal | null> {
  const { data, error } = await supabaseAdmin
    .from("client_field_proposals")
    .select(PROPOSAL_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return toProposal(data);
}

function toProposal(data: Record<string, unknown>): OpenProposal {
  return {
    id: String(data.id),
    clientId: String(data.client_id),
    audienceId: (data.audience_id as string | null) ?? null,
    sourceDocumentId: (data.source_document_id as string | null) ?? null,
    proposed: (data.proposed ?? []) as ProposedValue[],
    questions: (data.questions ?? []) as FieldQuestion[],
    unanswered: (data.unanswered ?? []) as string[],
    citations: (data.citations ?? []) as ResearchCitation[],
  };
}

const LABELS = new Map(DATASET_FIELDS.map((f) => [f.key, f.label]));

/**
 * How long one chunk of the card may be.
 *
 * ‼️ 3,000 IS THE BLOCK KIT `section` CEILING, NOT THE ceiling for THIS message. These chunks go
 * out through slack.postThreadReply, which is chat.postMessage with a plain `text` body and no
 * blocks, where the limit is nearer 40,000. So a single long value posts today rather than failing.
 * The split is kept anyway for two reasons: a card nobody can scroll is a card nobody reads, and
 * the day this card grows buttons it becomes blocks and the real 3,000 ceiling arrives with them.
 * Stated plainly because the old comment here claimed the whole message already failed, which sent
 * the next reader looking for a bug that was not there.
 */
const CARD_LIMIT = 2900;

/** Room for the continuation indent, so a wrapped bullet still fits once indented. */
const WRAP_INDENT = "    ";

/**
 * The proposal card, grouped by dataset.
 *
 * ‼️ RETURNS SEVERAL MESSAGES, NOT ONE LONG ONE. Twenty-plus proposed fields with their values will
 * run past any sensible message length. Split on line boundaries under 2,900, the way rerun-gaps.ts
 * does. A truncated card is worse than two cards: the fields that fell off the end are the ones
 * nobody confirms.
 */
export function formatProposalCard(p: OpenProposal): string[] {
  const lines: string[] = [
    ":card_index_dividers: *Read the research and found values for " +
      p.proposed.length +
      " field" +
      (p.proposed.length === 1 ? "" : "s") +
      ".* Nothing is saved yet.",
    "",
  ];

  for (const dataset of ["avatar", "audience", "offer"] as const) {
    const mine = p.proposed.filter((v) => v.dataset === dataset);
    if (!mine.length) continue;
    lines.push(`*${DATASET_LABEL[dataset]}*`);
    for (const v of mine) {
      const where = v.sourceSection ? ` _(section ${v.sourceSection})_` : " _(section not cited)_";
      lines.push(`  • *${LABELS.get(v.fieldKey) ?? v.fieldKey}:* ${v.value}${where}`);
    }
    lines.push("");
  }

  if (p.questions.length) {
    lines.push(
      ":grey_question: *Not saved, because the research does not say clearly enough.* Answer these " +
        "and they get filled properly:"
    );
    for (const q of p.questions) {
      lines.push(`  • *${LABELS.get(q.fieldKey) ?? q.fieldKey}:* ${q.question} _(${q.because})_`);
    }
    lines.push("");
  }

  if (p.unanswered.length) {
    const names = p.unanswered.map((k) => LABELS.get(k) ?? k);
    lines.push(`:heavy_minus_sign: The report says nothing about: ${names.join(", ")}.`);
    lines.push("");
  }

  lines.push(
    "React :white_check_mark: to save these values and file the research as evidence the page gate can see."
  );

  return splitLines(lines);
}

/**
 * Wrap one over-long line onto several, at whitespace.
 *
 * ‼️ WRAP, NEVER TRUNCATE. A cut value on a confirmation card is the exact failure the whole
 * proposal table exists to refuse: somebody approves what they read and something else is written.
 * Every character of the value survives; only its line breaks change. A single WORD longer than the
 * limit is cut, because at that point there is no whitespace to break on and no real field value
 * looks like that.
 */
export function wrapLine(line: string, limit: number): string[] {
  if (line.length <= limit || limit <= WRAP_INDENT.length) return [line];
  const out: string[] = [];
  let rest = line;
  let width = limit;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width);
    if (cut <= 0) cut = width;
    out.push(rest.slice(0, cut));
    rest = WRAP_INDENT + rest.slice(cut).trimStart();
    width = limit;
  }
  if (rest.trim()) out.push(rest);
  return out;
}

/**
 * Split on line boundaries so no message exceeds the cap. Never mid-line: a cut value is a lie.
 *
 * ‼️ THE WRAP HAS TO HAPPEN FIRST, AND THAT IS NOT COSMETIC. The `&& buf` below is what lets the
 * first line of a chunk be over-long: without it, a single line longer than the limit would loop
 * forever emitting empty chunks. So the guard is right and the input has to be made safe before it
 * runs. Once no member of `lines` can exceed CARD_LIMIT, no chunk can either.
 */
export function splitLines(lines: readonly string[]): string[] {
  const out: string[] = [];
  let buf = "";
  for (const line of lines.flatMap((l) => wrapLine(l, CARD_LIMIT))) {
    const next = buf ? buf + "\n" + line : line;
    if (next.length > CARD_LIMIT && buf) {
      out.push(buf);
      buf = line;
    } else {
      buf = next;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * The evidence rows one confirmed proposal produces, and how many citations were refused.
 *
 * ‼️ PURE, AND IT TAKES THE PROPOSAL AND NOTHING ELSE. The two arguments are the whole point: the
 * citations come from the row that was shown on the card, so a caller cannot file evidence drawn
 * from some other document alongside values drawn from this one. A probe can assert that by reading
 * the arity, which a comment saying the same thing cannot.
 *
 * ‼️ A CLAIM WITH NO source_url IS NOT EVIDENCE. Filing a model's unsourced assertion as a source
 * launders an invention into a citation. Refused here and counted, so the card can say so out loud
 * rather than quietly filing fewer rows than the card promised.
 */
export function evidenceRowsFor(
  p: OpenProposal,
  confirmedBy: string
): { rows: RecordSourceInput[]; dropped: number } {
  const cites = p.citations.filter((c) => c.sourceUrl?.trim() && c.content?.trim());
  return {
    dropped: p.citations.length - cites.length,
    rows: cites.map((c) => ({
      clientId: p.clientId,
      // ‼️ page_id NULL: the client library pool, not one page. The research backs whichever page
      // ends up making the claim, and pinning it to one would hide it from the other nineteen.
      pageId: null,
      // ‼️ EXTERNAL_RESEARCH, NOT CUSTOMER_REVIEW OR CLIENT_VOICE. isFirstParty() deliberately
      // excludes this type and that must not be "fixed": research about the buyer is evidence, and
      // it is not the business's own voice. What changes is that no_evidence, unsupported and
      // experience_claims can finally SEE it. A real customer quote with a URL is CUSTOMER_REVIEW
      // and comes in through the page studio's `review` command instead.
      sourceType: "EXTERNAL_RESEARCH" as const,
      sourceContent: c.content.trim(),
      sourceUrl: c.sourceUrl.trim(),
      collectedVia: "board" as const,
      collectedBy: confirmedBy,
    })),
  };
}

/**
 * The confirm. Commits the values AND files the evidence, in that order.
 *
 * ‼️ VALUES FIRST, EVIDENCE SECOND, AND A FAILURE TO FILE EVIDENCE DOES NOT UNDO THE VALUES. The
 * values are the thing a person just read and approved; the evidence is a derived convenience for
 * the gate and can be re-filed. Undoing a confirmed set of values because a source row failed to
 * insert would throw away the decision rather than the side effect.
 */
export async function confirmProposal(args: {
  /**
   * ‼️ THE PROPOSAL ITSELF, NOT A CLIENT ID TO LOOK ONE UP BY. The caller already identified one
   * specific proposal, by the ts of the message somebody reacted to. Handing over an id to
   * re-resolve would reopen the window in which a newer paste replaces the open row, and this
   * function would then commit values that were never on screen. Taking the object makes that
   * impossible rather than unlikely.
   */
  proposal: OpenProposal;
  confirmedBy: string;
}): Promise<{ ok: true; lines: string[] } | { ok: false; error: string }> {
  const p = args.proposal;

  const committed = await commitValues({
    clientId: p.clientId,
    audienceId: p.audienceId,
    values: p.proposed,
    sourceDocumentId: p.sourceDocumentId,
    confirmedBy: args.confirmedBy,
  });
  if (!committed.ok) return { ok: false, error: committed.error };

  // ‼️ .eq("status", "open") IS THE SECOND HALF OF THE RACE FIX. Two reactions arriving together
  // would otherwise both commit and both stamp the row. The values are written by then either way,
  // but only one press can move the row out of `open`, so the second sees zero rows updated rather
  // than silently agreeing that it was the one that did it.
  await supabaseAdmin
    .from("client_field_proposals")
    .update({ status: "committed", decided_at: new Date().toISOString(), decided_by: args.confirmedBy })
    .eq("id", p.id)
    .eq("status", "open");

  const lines = [
    `:white_check_mark: Saved ${committed.written} value${committed.written === 1 ? "" : "s"}` +
      (committed.superseded
        ? `, replacing ${committed.superseded} that ${committed.superseded === 1 ? "was" : "were"} already on file.`
        : "."),
  ];

  // ── W2b: the same press files the research where the gate can see it. ──────────────────────
  //
  // ‼️ A CLAIM WITH NO source_url IS NOT EVIDENCE. Filing a model's unsourced assertion as a source
  // launders an invention into a citation, which is exactly what a dangling reference is refused
  // for elsewhere. Citations without a URL are dropped here and counted, so the card can say so.
  // ‼️ FROM THE PROPOSAL ROW, NOT FROM THE CALLER. The citations were read out of the same paste
  // that produced the values and were shown on the same card. Taking them from an argument would
  // let a confirm file evidence from a different document than the one that was approved.
  const { rows, dropped } = evidenceRowsFor(p, args.confirmedBy);

  let filed = 0;
  for (const row of rows) {
    const res = await recordSource(row);
    if (res.ok) filed++;
  }

  if (filed) {
    lines.push(
      `:card_file_box: Filed ${filed} cited claim${filed === 1 ? "" : "s"} as evidence the page gate can read.`
    );
  }
  if (dropped) {
    lines.push(
      `:heavy_minus_sign: ${dropped} claim${dropped === 1 ? "" : "s"} had no source URL and ${dropped === 1 ? "was" : "were"} not filed. ` +
        "An unsourced assertion is not evidence."
    );
  }

  return { ok: true, lines };
}
