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
import { recordSource } from "./page-evidence";

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

export async function openProposalFor(clientId: string): Promise<OpenProposal | null> {
  const { data, error } = await supabaseAdmin
    .from("client_field_proposals")
    .select("id, client_id, audience_id, source_document_id, proposed, questions, unanswered, citations")
    .eq("client_id", clientId)
    .eq("status", "open")
    .maybeSingle();

  if (error || !data) return null;
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

/** How long one Slack message body may be before the WHOLE message is rejected. */
const CARD_LIMIT = 2900;

/**
 * The proposal card, grouped by dataset.
 *
 * ‼️ RETURNS SEVERAL MESSAGES, NOT ONE LONG ONE. A card body over 3,000 characters fails the whole
 * message, and twenty-plus proposed fields with their values will exceed it. Split on line
 * boundaries under 2,900, the way rerun-gaps.ts does. A truncated card is worse than two cards:
 * the fields that fell off the end are the ones nobody confirms.
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

/** Split on line boundaries so no message exceeds the cap. Never mid-line: a cut value is a lie. */
function splitLines(lines: readonly string[]): string[] {
  const out: string[] = [];
  let buf = "";
  for (const line of lines) {
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
 * The confirm. Commits the values AND files the evidence, in that order.
 *
 * ‼️ VALUES FIRST, EVIDENCE SECOND, AND A FAILURE TO FILE EVIDENCE DOES NOT UNDO THE VALUES. The
 * values are the thing a person just read and approved; the evidence is a derived convenience for
 * the gate and can be re-filed. Undoing a confirmed set of values because a source row failed to
 * insert would throw away the decision rather than the side effect.
 */
export async function confirmProposal(args: {
  clientId: string;
  confirmedBy: string;
}): Promise<{ ok: true; lines: string[] } | { ok: false; error: string }> {
  const p = await openProposalFor(args.clientId);
  if (!p) {
    return {
      ok: false,
      error: "there is no open proposal for this client. Paste the research again to make one.",
    };
  }

  const committed = await commitValues({
    clientId: p.clientId,
    audienceId: p.audienceId,
    values: p.proposed,
    sourceDocumentId: p.sourceDocumentId,
    confirmedBy: args.confirmedBy,
  });
  if (!committed.ok) return { ok: false, error: committed.error };

  await supabaseAdmin
    .from("client_field_proposals")
    .update({ status: "committed", decided_at: new Date().toISOString(), decided_by: args.confirmedBy })
    .eq("id", p.id);

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
  const cites = p.citations.filter((c) => c.sourceUrl?.trim() && c.content?.trim());
  const dropped = p.citations.length - cites.length;

  let filed = 0;
  for (const c of cites) {
    const res = await recordSource({
      clientId: p.clientId,
      // ‼️ page_id NULL: the client library pool, not one page. The research backs whichever page
      // ends up making the claim, and pinning it to one would hide it from the other nineteen.
      pageId: null,
      // ‼️ EXTERNAL_RESEARCH, NOT CUSTOMER_REVIEW OR CLIENT_VOICE. isFirstParty() deliberately
      // excludes this type and that must not be "fixed": research about the buyer is evidence, and
      // it is not the business's own voice. What changes is that no_evidence, unsupported and
      // experience_claims can finally SEE it. A real customer quote with a URL is CUSTOMER_REVIEW
      // and comes in through the page studio's `review` command instead.
      sourceType: "EXTERNAL_RESEARCH",
      sourceContent: c.content.trim(),
      sourceUrl: c.sourceUrl.trim(),
      collectedVia: "board",
      collectedBy: args.confirmedBy,
    });
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
