// The email for "they already got the thing, and now what."
//
// Every existing drafter covers a different moment and none of them covers this one:
//
//   draftPermissionEmail   earns a yes. Ends with the fixed PERMISSION_CLOSE ask.
//   draftRevealMessage     hands everything over, once, the moment they say yes.
//   draftSequenceEmail     the post-reveal belief ladder.
//   draftObjectionReply    answers something they objected to.
//   draftDeliveryEmail     the Loom hand-over, gated on a transcript.
//
// What was missing is the most common state in the pipeline: he sent it, they said yes or said
// nothing, and the thread has gone quiet. Asked for that, the router fell through to "revise email
// 1", so a prospect who already had the video got "I recorded a 4 min video, want me to send it
// over?" bolted onto the bottom of an email that opened "I sent over a short video last week."
//
// ‼️ This drafter must NEVER call ensurePermissionClose(). That helper appends the permission ask
// in code and is correct for the stage it belongs to; running it here is the exact bug above. The
// close for a follow-up is written by the model, because unlike the permission ask it changes with
// what they actually said.

import { callClaudeJSON } from "@/lib/claude-calls";
import {
  ensureSignoff,
  noDashes,
  reportContext,
  enforceLinkPolicy,
  linkPolicyFor,
  VOICE_RULES,
  PARAGRAPH_RULES,
  type EmailDraft,
} from "./email-assistant";
import { polishBody } from "./format-guard";
import type { ReportView } from "./report-view";
import type { AuditReportRow } from "./types";
import { formatThreadTruth, type ThreadTruth } from "./thread-truth";

const MODEL = "claude-sonnet-4-6" as const;

export interface FollowupDraft extends EmailDraft {
  /** Reply to this Graph message id so it lands on the real thread. Null = send as new. */
  replyToMessageId: string | null;
  removedLinks: string[];
  /** Things the operator should know before sending. Never smoothed over. */
  flags: string[];
}

/**
 * What kind of quiet this is. Derived from the mailbox, not asserted, because the difference
 * between "never answered" and "answered and then we went quiet" is the whole email.
 */
function situation(truth: ThreadTruth): string {
  if (truth.theyReplied) {
    return (
      "THEY REPLIED AND THE BALL IS IN OUR COURT. This is not a chase, it is an answer. Respond to " +
      "what they actually said, quoted below. Do not re-introduce yourself, do not re-explain the " +
      "audit, and do not ask permission for something they have already agreed to."
    );
  }
  if (truth.sent.length === 0) {
    return (
      "NOTHING HAS ACTUALLY BEEN SENT to this address that we can see. Do not write as if there is " +
      "a thread. Say so in the flags rather than inventing a history."
    );
  }
  const d = truth.daysSilent ?? 0;
  if (d >= 14) {
    return (
      `WE HAVE SENT ${truth.sent.length} MESSAGE(S) AND HAD NO REPLY IN ${d} DAYS. This is the last ` +
      "honest touch before it goes cold. One short paragraph, one new piece of value or one clean " +
      "way out. Do not stack another ask on top of the ones they have already ignored."
    );
  }
  return (
    `WE HAVE SENT ${truth.sent.length} MESSAGE(S) AND HAD NO REPLY IN ${d} DAY(S). Assume they never ` +
    "opened it rather than that they decided against it. Make the email openable on its own: the " +
    "finding has to survive without the previous one being read."
  );
}

/**
 * The rules that make a follow-up not read like a follow-up.
 *
 * `bannedPhraseWarnings()` in the Follow-Up Operator already catches "just checking in" AFTER the
 * fact; stating it up front is cheaper than a correction retry.
 */
/**
 * A REAL follow-up Matthew sent after a pitch, given to me as the reference on 2026-08-11.
 *
 * Same precedent as PERMISSION_EXAMPLE_NO_REDESIGN: a real sent email teaches shape far better
 * than a list of adjectives. What this one is actually doing, beat by beat, is worth naming
 * because a model shown only the text will copy the surface and miss the moves:
 *
 *  - It opens on an OBLIGATION, not a chase. "One thing I owe you in writing before you decide"
 *    gives him a reason to be in the inbox that is not "you didn't reply".
 *  - The scarcity is REAL and stated against itself: "there's no discount clock on this" first,
 *    THEN the capacity limit. A constraint you disarm before you use it reads as a fact.
 *  - The tiers are laid out in full and compared, so the decision can be made inside the email.
 *  - "Leave anytime, keep everything" is risk framing that is TRUE. It is not a guarantee, a
 *    refund or a performance promise, and it must never be rewritten into one.
 *  - The yes is one word. "Reply yes and I'll send the booking link."
 *  - The NO is given explicitly and cheaply: "if it's a no, just say so and I'll stop the emails."
 *    That is what makes the yes mean something, and it is the beat models delete first.
 *  - It ends on the give: "the scorecard is yours either way."
 *
 * ‼️ Withheld unless the link policy is `any`. It quotes the price, and showing it on a permission
 * stage follow-up teaches the model to quote it to someone who has not seen the work yet.
 *
 * ‼️ THE FIGURES IN HERE ARE A COPY AND NOTHING BINDS THEM (2026-08-25). This is a few-shot example,
 * so it has to read as a finished email rather than as an interpolated template, which means the
 * price is a literal. It went stale once already, quoting a two-tier ladder for four days after the
 * offer changed. If you edit config/pitch.ts, edit this string in the same commit.
 *
 * ‼️ THE SCARCITY LINE IS NOW TRUE AND IT WAS NOT BEFORE. It used to say "we can only take 5
 * clients at a time and this month we already took 2", which was a slot count attached to nothing,
 * of exactly the kind FREE_FIRST_BUILD's doc comment bans. The founding cohort IS a real countable
 * limit, so the example states that instead. If the founding seats fill, this paragraph comes out.
 */
const FOLLOWUP_EXAMPLE_POST_PITCH = `One thing I owe you in writing before you decide.

There's no discount clock on this. What there is, is 5 founding seats, and they're given in exchange for a case study when we hit the results.

You start free. The monthly retainer only starts once we've brought you 5 qualified AI-sourced inquiries inside the first 30 days. After that it is $349/mo, month to month.

What that covers, every month:
· We re-write your current pages
· We turn your happy customers into the evidence the engines quote
· We fix any NAP mismatches online
· Your monthly AI Visibility Report, so you're measuring me rather than trusting me

Leave anytime, keep everything
pages, profiles, data.

If it's a yes,

reply "Core" or "Complete" and I'll send the start link today.

If it's a no, just say so and I'll stop the emails

the scorecard is yours either way.`;

const FOLLOWUP_RULES = [
  'Never open with "just checking in", "circling back", "bumping this", "following up on my last email", or any variant. They all say "I have nothing new" in the first four words.',
  "Never guilt them about not replying, never mention that they did not reply, never count how many times you have written.",
  "Every follow-up carries something the last one did not: a different question they are absent from, a competitor now taking that answer, something on their site. If there is nothing new, say less, not more.",
  "One ask, at the very end, and make it the smallest one that still moves this forward.",
  "Do not re-pitch. They have the finding already. Repeating it reads as if you forgot you sent it.",
  "No em dashes, no en dashes, never ' - ' as a connector.",
].join("\n");

export async function draftFollowupEmail(
  report: AuditReportRow,
  view: ReportView,
  truth: ThreadTruth,
  instruction: string
): Promise<FollowupDraft> {
  const policy = linkPolicyFor(report);
  const flags: string[] = [];

  // What they said, verbatim. This is the single reason to read the mailbox at all, and quoting it
  // back is what makes the email land as a reply from a person rather than a scheduled touch.
  const theirWords = truth.replies
    .map((r) => (r.body ?? r.preview ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((t, i) => `Reply ${i + 1}, verbatim:\n"""\n${t}\n"""`)
    .join("\n\n");

  if (truth.theyReplied && !theirWords) {
    flags.push(
      "They replied but the body could not be read from Outlook, so this draft is written blind to what they said. Read the thread before sending."
    );
  }
  if (!truth.anchorMessageId) {
    flags.push(
      "No message on the existing thread could be found, so this will go out as a NEW email rather than a reply. Check that it is not a second conversation."
    );
  }
  if (truth.conflictsWithStoredStage) {
    flags.push(
      `The stored stage said "${truth.storedStage}" and the mailbox says "${truth.derivedStage}". This draft trusts the mailbox.`
    );
  }

  const { data } = await callClaudeJSON<{ subject: string; body: string }>({
    model: MODEL,
    system: [
      "You write the follow-up email for SRT Agency LLC, an AI-search-visibility agency. Matthew ran an audit on THIS business and has already been in contact with them.",
      "",
      "THE SITUATION:",
      situation(truth),
      "",
      "RULES:",
      FOLLOWUP_RULES,
      "",
      // The permission close is a constant appended in code for the stage it belongs to. Saying so
      // is what stops the model reaching for it here, where it would contradict the whole email.
      "This is NOT a permission-stage email. Do not end with 'want me to send it over', do not offer to send the breakdown or the video as if they have not been offered it, and do not append the permission close. Write your own last line, aimed at where this conversation actually is.",
      truth.theyReplied
        ? "They said yes or engaged. Move it forward. Do not ask for permission you already have."
        : "",
      policy.mode === "none"
        ? "No URLs or links of any kind in this email."
        : policy.mode === "redesign_only"
          ? `Exactly one link is allowed and it is this one: ${policy.url}. No other URL may appear.`
          : "Links and the offer are allowed, this thread is post-reveal.",
      "",
      VOICE_RULES,
      PARAGRAPH_RULES,
      // Shape, from a real sent email. Gated on `any` because it quotes prices: shown at
      // permission stage it would teach the model to quote them to someone who has seen nothing.
      policy.mode === "any"
        ? [
            "",
            "SHAPE REFERENCE. A real follow-up that worked, at the decision stage. Copy the MOVES, not the words, and never the specifics of another prospect's offer:",
            "- open on something you owe them, never on their silence",
            "- disarm a constraint before you use it, and only use constraints that are true",
            "- make the decision possible inside the email, do not send them somewhere to decide",
            "- one-word yes",
            "- give them the no, explicitly and cheaply. This is what makes the yes real, and it is the line most likely to get dropped. Keep it.",
            "- end on the thing they keep either way",
            "",
            FOLLOWUP_EXAMPLE_POST_PITCH,
            "END OF REFERENCE.",
          ].join("\n")
        : "",
      "Never guarantee customers, clients or revenue. Never invent a statistic, a competitor name, or a number that is not in the findings below. The prospect can check every one of them.",
      "Keep it short. A follow-up that runs longer than the email it follows is a rewrite, not a follow-up.",
    ]
      .filter(Boolean)
      .join("\n"),
    user: [
      `Audit findings for this business:\n${reportContext(report, view)}`,
      "",
      formatThreadTruth(truth),
      theirWords ? `\nWHAT THEY SAID:\n${theirWords}` : "",
      truth.anchorSubject ? `\nThe existing thread's subject is "${truth.anchorSubject}". This goes out as a REPLY on it, so write a subject only in case it has to be sent fresh.` : "",
      report.loom_url ? `\nA video was recorded for them: ${report.loom_url}` : "",
      report.redesign_url ? `\nA free redesign was built for them: ${report.redesign_url}` : "",
      `\nWhat Matthew asked for:\n"""\n${instruction}\n"""`,
      "\nReturn the email as JSON.",
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 1400,
    temperature: 0.5,
    schemaHint: '{ "subject": string, "body": string }',
    validate: (v: unknown): v is { subject: string; body: string } =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as { subject?: unknown }).subject === "string" &&
      typeof (v as { body?: unknown }).body === "string" &&
      (v as { body: string }).body.trim().length > 20,
    describeInvalid: () => "Return a JSON object with a non-empty `subject` string and a `body` string of real length.",
  });

  const subject = enforceLinkPolicy(noDashes(data.subject), { mode: "none" });
  const body = enforceLinkPolicy(noDashes(data.body), policy);
  const polished = await polishBody(body.text, { allowEmphasis: policy.mode === "any" });

  return {
    subject: subject.text.trim(),
    body: ensureSignoff(polished.body),
    replyToMessageId: truth.anchorMessageId,
    removedLinks: [...subject.removed, ...body.removed],
    flags,
  };
}
