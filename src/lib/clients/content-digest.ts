// The twice-weekly content rhythm.
//
// Two messages a week to a live client. The first asks whether anything interesting
// happened; the second sends two questions their buyers actually ask. They answer both by
// VOICE NOTE, which is the only form of answer a business owner between appointments will
// reliably give, and the answers become pages on their hub.
//
// ─── WHY THERE IS NO NEW CRON ────────────────────────────────────────────────────────
//
// vercel.json already carries 14 entries against a Hobby plan that documents 2.
// report-reminders.ts refused to add a 15th and this refuses for the same reason: it
// hangs off /api/cron/followup-digest, which already runs daily at 13:00 UTC and is
// already the "what is due today" job.
//
// ─── NOTHING IS SENT, AND NOTHING IS GENERATED ───────────────────────────────────────
//
// This posts a DRAFT into the ops thread with a wa.me link on it, exactly like every other
// client message. A human taps it. There is no send path and there must not be one.
//
// It also writes no page copy. It picks QUESTIONS, from what the engines were actually
// asked about this business. A question nobody asks produces a page nobody is looking for,
// which is the precise failure this whole product exists to fix, so when there are no
// unanswered questions left the week is SKIPPED rather than filled with invented ones.

import { supabaseAdmin } from "@/lib/db";
import { postDraft, recurringDraftKey, type RecurringDraft } from "@/lib/clients/client-drafts";

/**
 * Which weekday carries which ask. 0 is Sunday, UTC.
 *
 * The story nudge goes FIRST in the week, deliberately. Something they volunteered is
 * better material than an answer to a question we picked, so it gets first refusal; the
 * question set lands later as the fallback for a week where nothing came up.
 */
const SCHEDULE: Record<number, RecurringDraft> = {
  2: "ask_stories", // Tuesday
  4: "ask_content", // Thursday
};

/** How many questions go in one message. Two. A list of ten gets none of them answered. */
const QUESTIONS_PER_WEEK = 2;

interface Candidate {
  clientId: string;
  name: string;
}

/**
 * Clients in the content rhythm.
 *
 * Gated on `first_page` being complete rather than on billing status alone. Before the
 * first page is published there is nowhere for an answer to go, and asking a client for
 * material we cannot yet use is how the rhythm loses its credibility in week one. It is
 * the same dependency delivery step 32 already declares.
 */
/**
 * ‼️ EXPORTED, BECAUSE TWO RHYTHM JOBS MUST NOT DISAGREE ABOUT WHO IS LIVE.
 *
 * The weekly report (delivery step 32) rides the same digest cron and answers the same
 * question: which clients are far enough along to be in the rhythm. Two copies of this query
 * is how one job starts sending a client their weekly report while the other has decided they
 * are not ready for a content nudge.
 */
export async function clientsInRhythm(): Promise<Candidate[]> {
  const { data: steps, error } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("client_id")
    .eq("step_key", "first_page")
    .eq("status", "complete");

  if (error) {
    console.error("[content-digest] eligibility read failed:", error.message);
    return [];
  }

  const ids = [...new Set((steps ?? []).map((s) => s.client_id as string))];
  if (ids.length === 0) return [];

  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, billing_status")
    .in("id", ids)
    .in("billing_status", ["pilot", "active"]);

  return (clients ?? []).map((c) => ({
    clientId: c.id as string,
    name: (c.dba_name as string) || (c.legal_name as string) || "Client",
  }));
}

const eligibleClients = clientsInRhythm;

/**
 * Questions this client is absent from and has not answered yet.
 *
 * Absent, not merely unanswered: a question the engines already name them in does not need
 * a page. `mentioned` is tri-state on purpose (a failed call is `no_data` with a null, and
 * run-prompts.ts refuses to turn that into a guessed false), so this filters on an explicit
 * `mentioned = false` with `status = 'ok'` and never on falsiness. Reading a null as "they
 * were absent" would put an engine outage on a client's content calendar.
 */
export async function pickQuestions(clientId: string, limit = QUESTIONS_PER_WEEK): Promise<string[]> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("contact_id, domain")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return [];

  // Anything already written up, in any state. A draft page is a question somebody is
  // already working on, so asking again would produce two answers to one question.
  const { data: pages } = await supabaseAdmin
    .from("client_pages")
    .select("question")
    .eq("client_id", clientId);

  const taken = new Set((pages ?? []).map((p) => (p.question as string)?.trim()).filter(Boolean));

  // ── page_candidates FIRST, and that ordering is the point ─────────────────
  //
  // These are the market's own phrasings: harvested off the pages the engines cited, or
  // pasted back from a deep-research brief a person ran (question_bank, source 'harvest' /
  // 'deep_research'), then substituted per client into page_candidates and ranked. The
  // audit's twenty are generated by a model from a classification, which is a good enough
  // proxy to SELL on and a worse one to build a client's content calendar on.
  //
  // Highest score first, and questions no engine currently names them for before the rest:
  // a question they already win is a page that changes nothing.
  const { data: candidates } = await supabaseAdmin
    .from("page_candidates")
    .select("question, score, currently_named")
    .eq("client_id", clientId)
    .order("score", { ascending: false })
    .limit(50);

  const ranked = (candidates ?? [])
    .filter((c) => !taken.has(((c.question as string) ?? "").trim()))
    .sort((a, b) => Number(a.currently_named === true) - Number(b.currently_named === true))
    .map((c) => c.question as string);

  if (ranked.length > 0) return ranked.slice(0, limit);

  // Same join ladder the client board uses, and deliberately the SAME TWO RUNGS.
  //
  // ‼️ audit_reports.client_id is NOT used here even though it is the better key. It is
  // added by docs/2026-08-19-artifact-plumbing.sql, which has not been run, and PostgREST
  // fails the WHOLE query on one unknown column rather than ignoring it. Selecting a
  // column that does not exist yet would not degrade this to "no questions found", it
  // would error every week for every client. Add the rung when the migration is applied.
  let q = supabaseAdmin
    .from("audit_reports")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1);

  if (client.contact_id) q = q.eq("contact_id", client.contact_id as string);
  else if (client.domain) q = q.ilike("website", `%${client.domain as string}%`);
  else return [];

  const { data: report } = await q.maybeSingle();
  if (!report) return [];

  const { data: runs } = await supabaseAdmin
    .from("audit_runs")
    .select("prompt")
    .eq("report_id", report.id as string)
    .eq("status", "ok")
    .eq("mentioned", false);

  const absent = [...new Set((runs ?? []).map((r) => r.prompt as string))];
  return absent.filter((p) => !taken.has(p.trim())).slice(0, limit);
}

export interface ContentDigestResult {
  posted: string[];
  skipped: string[];
}

/**
 * Post today's ask, if today is one of the two days.
 *
 * Idempotent through the database, not through a flag: the draft key carries the ISO week
 * and client_messages is UNIQUE on (client_id, draft_key), so a cron that runs twice on a
 * Tuesday posts one message. Same guarantee the step drafts already rely on.
 */
export async function runContentDigest(opts: { dry?: boolean; now?: Date } = {}): Promise<ContentDigestResult> {
  const now = opts.now ?? new Date();
  const base = SCHEDULE[now.getUTCDay()];

  const result: ContentDigestResult = { posted: [], skipped: [] };
  if (!base) return result;

  for (const client of await eligibleClients()) {
    const key = recurringDraftKey(base, now);

    if (base === "ask_content") {
      const questions = await pickQuestions(client.clientId);
      // ‼️ SKIP, never invent. A week with nothing left to ask is a real state and it is
      // worth noticing: it means every question the engines asked has a page. Filling it
      // with a made-up question would hide that and waste the client's attention.
      if (questions.length === 0) {
        result.skipped.push(`${client.name}: no unanswered questions left`);
        continue;
      }

      if (!opts.dry) {
        await postDraft(client.clientId, key, {
          questions: questions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
        }).catch((e) =>
          console.error(`[content-digest] ${client.name} post failed:`, (e as Error).message)
        );
      }
    } else if (!opts.dry) {
      await postDraft(client.clientId, key).catch((e) =>
        console.error(`[content-digest] ${client.name} post failed:`, (e as Error).message)
      );
    }

    result.posted.push(client.name);
  }

  return result;
}
