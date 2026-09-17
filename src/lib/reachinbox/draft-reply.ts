// Draft Matthew's answer to a cold-campaign reply, and put it on the approval card in that
// prospect's own thread.
//
// WHAT THIS LANE DOES NOT HAVE, AND WHY IT SHAPES EVERY RULE BELOW
// No audit has been run on this business. There is no score, no count of buyer questions, no
// competitor list, no crawl. Every other drafter in this repo is handed an AuditReportRow and
// builds its prompt out of measured facts. This one is handed a sentence a stranger typed. So it
// deliberately does NOT reuse reportContext, CTA_RULE or SUBJECT_STYLE from email-assistant: the
// first two assume a report, and SUBJECT_STYLE explicitly instructs the model to put a real score
// and a real competitor name in the subject line. Reaching for them here is exactly how this lane
// would start inventing numbers about a business nobody has looked at.
//
// It DOES reuse STYLE_RULES (which carries the em-dash ban), COMPLIANCE_RULES, the subject format
// instruction, the parser, the dash strip and the linter, because none of those need a report.

import { callClaudeText } from "@/lib/claude-calls";
import {
  COMPLIANCE_RULES,
  STYLE_RULES,
  SUBJECT_LINE_INSTRUCTION,
  noDashes,
  parseSubjectAndBody,
  type EmailDraft,
} from "@/lib/audit-engine/email-assistant";
import { draftWithLint, retryInstruction, type GatedDraft } from "@/lib/audit-engine/draft-linter";
import { getMattVoiceExamples, renderVoiceExamplesForPrompt } from "@/lib/ai-intel/voice-examples";
import { displayName } from "@/lib/followup-operator/digest";
import type { OutreachProspectRow } from "@/lib/followup-operator/types";

/**
 * Prospect-facing rules, guarded at module load.
 *
 * The onboarding2 config precedent: a banned character in copy is a build failure, not something
 * to notice in production. If someone later edits this string and types an em dash into the very
 * rule that bans em dashes, `next build` stops.
 */
function guard(s: string): string {
  if (/[\u2014\u2013]/.test(s)) {
    throw new Error("CAMPAIGN_REPLY_RULES contains an em dash or en dash, which it forbids.");
  }
  return s;
}

export const CAMPAIGN_REPLY_RULES = guard(
  [
    "Under 140 words in the body. Plain text, ready to paste and send.",
    "Never use an em dash or an en dash, and never use a spaced hyphen as a sentence connector. Periods and commas only. Write ranges as '3 to 5'. This is the rule that gets checked first, because an em dash is the clearest tell that a human did not write the email.",
    "Answer the actual thing they said FIRST, in their own terms. Then make the ask.",
    "THE ONE ASK IS A SHORT ONBOARDING CALL. Not a 20 minute discovery call. Not a price negotiation unless they asked about price. Not a video unless they asked for one.",
    "Write no sign-off, no name and no signature block. One is appended automatically when it sends, and a second would double-sign the email.",
    "Never say or imply that anything has been sent, booked, scheduled or started. This is a draft that a human has not approved yet.",
    "If they asked to be removed or told you to stop, the reply is one short line acknowledging it and nothing else. No pitch, no ask, no link.",
    "No links unless they asked for one.",
    "You have no measured data about this business. No score, no ranking, no competitor name, no traffic number. If a number would make the sentence work, the sentence is wrong.",
  ].join("\n")
);

const MODEL = "claude-sonnet-4-6" as const;

/**
 * The subject that keeps the reply in their inbox thread.
 *
 * Strips any number of leading re: prefixes before adding one back, or an answered thread turns
 * into "re: re: re: Quick question" after three exchanges.
 */
export function campaignReplySubject(
  threadSubject: string | null | undefined,
  modelSubject: string
): string {
  const existing = (threadSubject ?? "").trim();
  if (existing) {
    const bare = existing.replace(/^(\s*re\s*:\s*)+/i, "").trim();
    if (bare) return noDashes(`re: ${bare}`);
  }
  return noDashes((modelSubject || "Following up").trim());
}

function buildSystem(voiceBlock: string): string {
  return [
    "You draft Matthew Garcia's reply to someone who answered a cold email campaign. Matthew runs SRT Agency ('Search Retrieval Tactics'), an AI-search-visibility agency: it gets businesses cited in the answers ChatGPT, Perplexity and Google AI give to buyers.",
    "NO AUDIT HAS BEEN RUN ON THIS BUSINESS. Nothing has been measured about them. Read the rules below before writing a single number.",
    CAMPAIGN_REPLY_RULES,
    STYLE_RULES,
    COMPLIANCE_RULES,
    SUBJECT_LINE_INSTRUCTION,
    voiceBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildUser(p: OutreachProspectRow, replyText: string, retry: string): string {
  return [
    `Business: ${displayName(p)}${p.website ? ` (${p.website})` : " (no website on file)"}`,
    `Their address: ${p.email}`,
    `Campaign that reached them: ${p.campaign ?? "unknown"}`,
    "",
    "They replied:",
    `"${replyText.trim().slice(0, 4000)}"`,
    "",
    "Draft Matthew's reply now.",
    retry,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Draft the reply, gated by the shared linter.
 *
 * `stage: "objection"` is the honest classification: a campaign reply IS an objection reply in
 * every respect the linter checks. A new stage would have started as a copy of those rules.
 */
export async function draftCampaignReply(input: {
  prospect: OutreachProspectRow;
  replyText: string;
}): Promise<GatedDraft<EmailDraft>> {
  const voice = renderVoiceExamplesForPrompt(await getMattVoiceExamples(6));
  const system = buildSystem(voice);

  return draftWithLint<EmailDraft>(
    async (_attempt, previous) => {
      const { text } = await callClaudeText({
        model: MODEL,
        system,
        user: buildUser(input.prospect, input.replyText, retryInstruction(previous)),
        maxTokens: 700,
        temperature: 0.6,
      });
      const parsed = parseSubjectAndBody(text);
      return {
        subject: campaignReplySubject(input.prospect.thread_subject, parsed.subject),
        body: noDashes(parsed.body),
      };
    },
    (d) => ({ body: d.body, subject: d.subject, stage: "objection" })
  );
}
