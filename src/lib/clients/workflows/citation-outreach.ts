// `citation_outreach`: one reviewed draft per off-site target.
//
// ‼️ IT DRAFTS AND IT DOES NOT QUEUE, AND THAT IS NOT CAUTION, IT IS ARITHMETIC. An
// offsite_targets row is a DOMAIN: the engines cited nytimes.com, so nytimes.com is on the
// list. outreach_send_queue.recipient is NOT NULL and there is no person on that row. The
// missing piece is a human being's address, and the two ways to get one are to look it up by
// hand or to scrape it. §7 permits the first and this lane will not do the second.
//
// So the draft is written, the suppression list is checked against the domain, and it waits for
// somebody to put a name and an address on it. That IS §7's "emailing a human to ask for
// inclusion, a quote, or a correction, as a reviewed draft", taken at its word.
//
// ‼️ NOTHING HERE POSTS ANYWHERE. harvest.ts states the ban this lane inherits, and it predates
// both files: "DOES NOT POST: anywhere, ever, to any forum, as anyone." A forum on the target
// list is a place we read, never a place we write.
//
// ‼️ AND A LISTED SUBJECT IS A DIFFERENT EMAIL FROM A CITED DOMAIN. We put the subject on one of
// our own pages, so the first line is "you are in this" rather than a favour ask. Same lane,
// different opening, and the kind on the row is what decides which.

import type { WorkflowContext, WorkflowResult } from "./registry";
import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { checkSuppression } from "@/lib/outreach/suppression";
import { complianceFooter } from "@/lib/outreach/footer";

const MODEL = "claude-sonnet-4-6" as const;

/** How many drafts one run produces. */
const BATCH = 5;

interface TargetRow {
  id: string;
  domain: string;
  example_url: string | null;
  times_cited: number;
  kind: string;
}

interface Drafted {
  subject: string;
  body: string;
}

const SYSTEM = `You write one short email to a publication, directory or site that an AI answer
engine cited while answering questions about a client's market.

There are two situations and the brief says which:

LISTED SUBJECT. We named them on a page of ours: a roundup, a comparison or a review. The email
tells them they are in it and where. It is not a favour ask, so do not write one.

CITED SOURCE. An engine read them while answering a question our client should be part of. The
email asks whether they would consider including the client, or asks for a correction if
something about the client there is wrong.

RULES, all absolute:
- ONE ask, one question mark in the whole body. Never two.
- Say why this email reached THEM specifically. A stranger who cannot tell deletes it.
- No flattery. No "I hope this finds you well". No "I am reaching out". No "circling back".
- NO em dash, anywhere.
- No figure that was not given to you.
- No attachment, no link except the one page URL if the brief gives you one.
- Under a hundred and twenty words. Short enough to read on a phone without scrolling.
- Do NOT write a sign off, a signature, an unsubscribe line or a postal address. Those are
  appended in code. Stop after your last sentence.

Return JSON: { "subject": string, "body": string }`;

function faults(raw: unknown): string[] {
  const v = raw as Partial<Drafted> | null;
  const f: string[] = [];
  const subject = typeof v?.subject === "string" ? v.subject.trim() : "";
  const body = typeof v?.body === "string" ? v.body.trim() : "";

  if (!subject) f.push("subject is missing.");
  if (!body) f.push("body is missing.");
  if (hasBannedDash(subject) || hasBannedDash(body)) f.push("an em dash appears.");

  const marks = (body.match(/\?/g) ?? []).length;
  if (marks > 1) f.push(`the body asks ${marks} questions. It must ask exactly one.`);
  if (body.split(/\s+/).length > 200) f.push("the body is too long.");

  // ‼️ THE MODEL MUST NOT WRITE THE COMPLIANCE BLOCK. It is appended in code so it cannot be
  // paraphrased into something that no longer says what the statute requires, and a model that
  // writes its own produces two.
  if (/unsubscribe|opt out|opt-out/i.test(body)) f.push("do not write an unsubscribe line; it is appended.");
  return f;
}

export async function runCitationOutreach(ctx: WorkflowContext): Promise<WorkflowResult> {
  // The offer is the single message source. §11 point 4: one edit there changes the directory
  // copy, the outreach copy and the page drafts, and nothing downstream keeps its own copy.
  const { loadOffer } = await import("@/lib/clients/offers");
  const offer = await loadOffer(ctx.clientId);
  if (!offer.treatment) {
    return {
      ok: false,
      error:
        "This client has no locked offer, so there is nothing to ask anybody to include. " +
        "`offer:` in the step ten thread locks one.",
    };
  }

  const { data, error } = await supabaseAdmin
    .from("offsite_targets")
    .select("id, domain, example_url, times_cited, kind")
    .eq("client_id", ctx.clientId)
    .eq("status", "new")
    // Listed subjects first: they are already qualified, so they are the ones worth a person's
    // time before anybody writes to a stranger.
    .order("kind", { ascending: true })
    .order("times_cited", { ascending: false })
    .limit(BATCH * 3);

  if (error) return { ok: false, error: `The targets could not be read: ${error.message}` };

  const all = (data ?? []) as TargetRow[];
  if (all.length === 0) {
    return {
      ok: false,
      error:
        "No off-site target is waiting. Run `offsite_targets` first, or every one of them has " +
        "already been picked up.",
    };
  }

  // ‼️ SUPPRESSION IS CHECKED ON THE DOMAIN BEFORE A WORD IS WRITTEN, not after. checkSuppression
  // already knows `domain_contacted`, `opted_out` and `current_client`, and asking it first is
  // what stops a draft existing for somebody who told us to stop.
  const usable: TargetRow[] = [];
  const suppressed: string[] = [];
  for (const t of all) {
    if (usable.length >= BATCH) break;
    const hit = await checkSuppression({ email: null, domain: t.domain }).catch(() => null);
    if (hit) suppressed.push(`${t.domain} (${hit.reason})`);
    else usable.push(t);
  }

  if (usable.length === 0) {
    return {
      ok: false,
      error: `Every target in reach is suppressed: ${suppressed.join(", ")}.`,
    };
  }

  // Throws when OUTREACH_POSTAL_ADDRESS is unset, which is the correct shape: an email with no
  // postal address is the thing the statute names, and a missing constant is a minute's fix.
  let footer: { text: string };
  try {
    footer = complianceFooter();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const drafts: Array<{ domain: string; kind: string; subject: string; body: string }> = [];
  const failed: string[] = [];

  for (const t of usable) {
    try {
      const res = await callClaudeJSON<Drafted>({
        model: MODEL,
        system: SYSTEM,
        user: [
          `Client: ${ctx.clientName}`,
          `What they sell: ${offer.treatment}`,
          offer.terms.length ? `What their customers call it: ${offer.terms.join(", ")}` : "",
          offer.outcomePromise ? `The outcome they promise: ${offer.outcomePromise}` : "",
          "",
          t.kind === "listed_subject"
            ? `SITUATION: LISTED SUBJECT. We named "${t.domain}" on one of our own pages.`
            : `SITUATION: CITED SOURCE. An AI engine cited ${t.domain} ${t.times_cited} time${
                t.times_cited === 1 ? "" : "s"
              } while answering questions about this market.`,
          t.example_url ? `The page it cited: ${t.example_url}` : "",
          "",
          "Write the email. Address it to the role, not to a name: the person sending it fills",
          "the name in, because nobody here knows who it is yet.",
        ]
          .filter(Boolean)
          .join("\n"),
        maxTokens: 1200,
        validate: (v): v is Drafted => faults(v).length === 0,
        describeInvalid: (v) => faults(v).join(" "),
      });
      drafts.push({
        domain: t.domain,
        kind: t.kind,
        subject: res.data.subject,
        // The compliance block, appended in code so it cannot be paraphrased away.
        body: `${res.data.body.trim()}\n${footer.text}`,
      });
    } catch (e) {
      failed.push(`${t.domain}: ${(e as Error).message}`);
    }
  }

  if (drafts.length === 0) {
    return { ok: false, error: `Nothing came back usable. ${failed.join(" | ")}` };
  }

  // Mark what was drafted, so a second run moves on rather than rewriting the same five.
  await supabaseAdmin
    .from("offsite_targets")
    .update({ status: "queued", updated_at: new Date().toISOString() })
    .in(
      "id",
      usable.filter((t) => drafts.some((d) => d.domain === t.domain)).map((t) => t.id)
    );

  const note = [
    `:envelope_with_arrow: *${drafts.length} off-site draft${drafts.length === 1 ? "" : "s"} for ${ctx.clientName}.*`,
    "",
    ...drafts.flatMap((d) => [
      `*${d.domain}*${d.kind === "listed_subject" ? "  _already named on one of our pages_" : ""}`,
      `_Subject:_ ${d.subject}`,
      d.body,
      "",
    ]),
    suppressed.length ? `_Skipped as suppressed:_ ${suppressed.join(", ")}` : "",
    failed.length ? `_Did not draft:_ ${failed.join(" | ")}` : "",
    "",
    // ‼️ SAID PLAINLY, BECAUSE THE PROMPT SAYS "QUEUED" AND THIS DOES NOT QUEUE.
    "*Nothing is queued and nothing will send.* A target is a DOMAIN, and the send queue needs a " +
      "person. Find the right human, put their address on it, and send it from your own mailbox. " +
      "The postal address and the opt-out line are already in the body.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return {
    ok: true,
    output: { note, drafts, suppressed, failed },
    summary: `${drafts.length} off-site drafts for ${ctx.clientName}, none queued`,
  };
}
