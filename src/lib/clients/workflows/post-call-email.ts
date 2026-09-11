// The email after a call with a CLIENT, written from the notes somebody took on it.
//
// ‼️ THERE IS ALREADY ONE OF THESE AND IT IS FOR A DIFFERENT PERSON. notes-email.ts drafts the
// post-call email for a PROSPECT: it is keyed on an audit report, reads the outreach thread, and
// asks permission to send a Loom. This one is for a business we are already delivering for, where
// the questions are what was promised, what they asked for, and what happens next.
//
// What it reuses rather than reinvents: the guards. callbackCommitments and outOfScopeAsks read a
// set of notes for the two things an email must not get wrong -- a callback somebody promised, and
// an ask that is outside what we do. Getting either wrong in writing is worse than the email not
// existing.
//
// ‼️ A DRAFT. It is posted into the ops thread for a person to send. Nothing here mails anybody:
// client-messages.ts's rule is that client-facing messages are drafts and nothing can send them.

import { callClaudeJSON } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { COMPLIANCE_RULES, STYLE_RULES, VOICE_RULES, ensureSignoff } from "@/lib/audit-engine/email-assistant";
import { callbackCommitments, outOfScopeAsks } from "@/lib/audit-engine/notes-guards";
import type { WorkflowContext, WorkflowResult } from "./registry";

const MODEL = "claude-sonnet-4-6" as const;

interface DraftedEmail {
  subject: string;
  body: string;
}

function looksLikeEmail(v: unknown): v is DraftedEmail {
  if (!v || typeof v !== "object") return false;
  const d = v as DraftedEmail;
  return (
    typeof d.subject === "string" &&
    d.subject.trim().length > 0 &&
    d.subject.length <= 90 &&
    typeof d.body === "string" &&
    d.body.trim().length > 80 &&
    !hasBannedDash(d.subject) &&
    !hasBannedDash(d.body)
  );
}

function whyInvalid(v: unknown): string {
  const d = v as DraftedEmail;
  if (typeof d?.subject !== "string" || !d.subject.trim()) return "there was no subject";
  if (d.subject.length > 90) return `the subject is ${d.subject.length} characters, which is too long for an inbox`;
  if (typeof d?.body !== "string" || d.body.trim().length <= 80) return "the body was missing or a single line";
  if (hasBannedDash(d.subject) || hasBannedDash(d.body)) {
    return "the draft uses an em dash, an en dash or ' - ' as a connector, which is banned in all copy";
  }
  return "the payload did not match the shape";
}

export async function runPostCallEmail(ctx: WorkflowContext): Promise<WorkflowResult> {
  const reads = await import("../client-reads");

  const profile = await reads.clientProfile(ctx.clientId);
  if ("error" in profile) return { ok: false, error: profile.error };

  const audits = await reads.clientAudits(ctx.clientId, 10);
  const withNotes = audits.find((a) => (a.callNotes ?? "").trim().length > 0);
  const notes = (withNotes?.callNotes ?? "").trim();

  if (!notes) {
    return {
      ok: false,
      error:
        "there are no call notes on file for this client, and this email is written FROM them. " +
        "Paste the notes into the audit thread first: an email written without them would be a " +
        "generic follow-up with their name on it.",
    };
  }

  // The two things an email must not get wrong. Surfaced to the model as facts rather than left
  // for it to notice, and repeated in the summary so the person sending it sees them too.
  const callbacks = callbackCommitments(notes);
  const outOfScope = outOfScopeAsks(notes);

  const planStatus = await reads.clientPlan(ctx.clientId);
  const plannedPages = "error" in planStatus ? 0 : planStatus.rows.length;
  const nextStep = profile.steps.next;

  const facts = [
    `Client: ${profile.client.name}.`,
    profile.offer.treatment ? `What they sell, as locked with them: ${profile.offer.treatment}.` : "",
    profile.offer.positioning ? `How they want to be known for it: ${profile.offer.positioning}.` : "",
    `Where the work is: ${profile.steps.done} of ${profile.steps.total} delivery steps complete.` +
      (nextStep ? ` The next one is "${nextStep.label}".` : ""),
    plannedPages ? `${plannedPages} pages are on their plan.` : "",
    "",
    "THE CALL NOTES, verbatim. Everything in the email comes from these:",
    notes.slice(0, 6000),
    "",
    callbacks.length
      ? `PROMISED ON THE CALL. The email must honour each one, in the words it was promised:\n${callbacks
          .map((c) => `  - ${c.line}`)
          .join("\n")}`
      : "No specific callback was promised in the notes.",
    outOfScope.length
      ? `ASKED FOR, AND OUTSIDE WHAT WE DO. Do not agree to these, and do not go quiet on them either:\n${outOfScope
          .map((c) => `  - ${c.line}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system = [
    "You write the follow-up email after a call with a CLIENT: a business we are already doing the",
    "work for. This is not a sales email and there is nothing to pitch.",
    "",
    "It does three things, in this order: confirm what was decided, confirm what we said we would do",
    "and by when, and say what we need from them. Nothing else.",
    "",
    "RULES:",
    "Everything comes from the call notes. If something was not said on the call, it is not in the",
    "email. Never invent a date, a number, a deliverable or a commitment.",
    "Anything promised on the call appears in the email, in the words it was promised.",
    "An ask that is outside what we do is answered honestly, not agreed to and not ignored.",
    "Short. A person reads this on a phone between appointments.",
    "",
    VOICE_RULES,
    "",
    COMPLIANCE_RULES,
    "",
    STYLE_RULES,
  ].join("\n");

  let drafted: DraftedEmail;
  try {
    const res = await callClaudeJSON<DraftedEmail>({
      model: MODEL,
      system,
      user: facts,
      maxTokens: 2000,
      temperature: 0.5,
      schemaHint: '{"subject":"the subject line","body":"the email body, plain text"}',
      validate: looksLikeEmail,
      describeInvalid: whyInvalid,
      timeoutMs: 120_000,
    });
    drafted = res.data;
  } catch (e) {
    return { ok: false, error: `the drafting call failed: ${(e as Error).message}` };
  }

  // The sign-off is appended by code, never left to the model: it is the one part of the email that
  // is the same every time and the one part a model reliably gets subtly wrong.
  const body = ensureSignoff(drafted.body);

  const summary = [
    `*Subject:* ${drafted.subject}`,
    "",
    body,
    "",
    callbacks.length
      ? `:pushpin: Promised on the call, and the draft has to carry each one: ${callbacks.map((c) => `"${c.line}"`).join(", ")}`
      : "",
    outOfScope.length
      ? `:warning: Asked for and outside what we do: ${outOfScope.map((c) => `"${c.line}"`).join(", ")}. Read how the draft answers those before sending.`
      : "",
    `Written from the call notes on ${withNotes?.createdAt?.slice(0, 10) ?? "the audit on file"}. It is a DRAFT: nothing has been sent.`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    ok: true,
    output: {
      subject: drafted.subject,
      body,
      callbacks: callbacks.map((c) => c.line),
      outOfScope: outOfScope.map((c) => c.line),
      sourceReportId: withNotes?.id ?? null,
    },
    summary,
  };
}
