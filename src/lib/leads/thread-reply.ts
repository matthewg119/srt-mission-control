// Routing for a message typed inside a lead's thread in #hot-leads.
//
// ‼️ THE ROUTER IS contacts.slack_thread_ts, WHICH IS UNIQUE-INDEXED BY
// docs/2026-09-23-lead-thread-index.sql. That is what makes this safe to run in a channel that
// also carries speed-to-lead notices and standalone audit posts: a thread under anything other
// than a lead card resolves no contact, this returns false, and the message falls through to the
// generic assistant exactly as it did before.
//
// WHAT THIS LANE IS
// The lead arrives here and the work should be doable here. Everything below is a doorway to a
// function that already existed and is already reached from the CRM lead page; see the header of
// lead-actions.ts. The one genuinely new behaviour is the fallthrough: once a finished audit
// exists, free text is forwarded to that audit's thread VERBATIM, which is what makes "paste the
// reply they emailed me and draft the answer" work from in here.

import { slack } from "@/lib/slack-bot";
import {
  buildDraftCommand,
  contactByThread,
  findUsableAudit,
  postBookingLink,
  postLeadStatus,
  proxyToAuditThread,
  runAuditForContact,
} from "./lead-actions";
import { runLeadThreadAgent } from "./thread-agent";

const AUDIT_RE = /^(run\s+(the\s+)?audit|audit|run\s+(the\s+)?scan|scan\s+them)\s*$/i;
const STATUS_RE = /^(status|where\s+are\s+we)\s*\??$/i;
const HELP_RE = /^(help|commands|\?)\s*$/i;
const LINK_RE = /^((send\s+|booking\s+|the\s+)?link|book|booking)\s*$/i;

/**
 * Verbs that mean something specific to handleAuditThreadReply, listed so the reply can name what
 * it ran rather than saying "something happened".
 *
 * ‼️ THIS TABLE PICKS A LABEL. It does not rewrite the text, with exactly one documented exception
 * (a bare `draft`, see buildDraftCommand). The audit thread is a state machine keyed on
 * outreach_stage and it is what decides what the words mean; see the note on proxyToAuditThread.
 *
 * ‼️ SINGLE LINE ONLY, AND THAT IS WHAT KEEPS A PASTED REPLY OUT OF HERE. These are prefix
 * matches, so an email that opens "Call me Tuesday and we can talk" would otherwise be routed to
 * the call-script builder instead of being read as what the prospect said, which is the single
 * most important thing this lane does. A typed command is one line; a pasted email is not.
 */
const PROXY_VERBS: Array<{ re: RegExp; label: string }> = [
  { re: /^loom\b/i, label: "Loom" },
  { re: /^script\b/i, label: "Loom script" },
  { re: /^redesign\b/i, label: "Redesign asset" },
  { re: /^close\b/i, label: "Closing script" },
  { re: /^call\b/i, label: "Follow-up call script" },
  { re: /^avatars?\b/i, label: "Avatars" },
  { re: /^brief\b/i, label: "Niche brief" },
  { re: /^image\b/i, label: "Dream-lead image prompt" },
  { re: /^questions\b/i, label: "Intake questions" },
  { re: /^reveal\b/i, label: "Reveal" },
  { re: /^draft\b/i, label: "Draft" },
  { re: /^nudge\s+\d/i, label: "Nudge" },
  { re: /^email\s+\d/i, label: "Sequence email" },
  { re: /^seed\s+\d/i, label: "Seed" },
  { re: /^[1-6]\s*$/, label: "Pick" },
];

const HELP = [
  "*In a lead thread:*",
  "`run audit` the AI visibility audit on their site, linked to this lead. Four to six minutes, the score comes back here.",
  "`status` where this lead actually is  ·  `link` the /onboarding2 booking URL carrying their report",
  "",
  "*Once the audit is finished, this thread is a remote control for it:*",
  "*Paste what they emailed back* and I draft the answer  ·  `1` `2` `3` pick a draft, it goes to your Outlook",
  "`loom` pick the customer then the picture then the script  ·  `call` follow-up script  ·  `close` the selling one",
  "`avatars`  ·  `brief`  ·  `reveal`  ·  `nudge 2-5`  ·  `email 2-5`  ·  `loom <url>` / `redesign <url>` store an asset",
  "",
  "Onboarding does not start here. They book through the link, and that is what opens their channel and their board.",
].join("\n");

export async function handleLeadThreadReply(args: {
  channel: string;
  threadTs: string;
  text: string;
  messageTs: string | null;
  userId: string;
}): Promise<boolean> {
  const contact = await contactByThread(args.threadTs);
  if (!contact) return false; // not a lead thread, let the other handlers run

  const text = args.text.trim();
  const by = args.userId ? `<@${args.userId}>` : "someone in Slack";
  const reply = (s: string) => slack.postThreadReply(args.channel, args.threadTs, s);

  if (HELP_RE.test(text)) {
    await reply(HELP);
    return true;
  }

  if (STATUS_RE.test(text)) {
    await postLeadStatus({ contact, channel: args.channel, threadTs: args.threadTs });
    return true;
  }

  if (AUDIT_RE.test(text)) {
    await runAuditForContact({ contact, channel: args.channel, threadTs: args.threadTs, by });
    return true;
  }

  if (LINK_RE.test(text)) {
    await postBookingLink({ contact, channel: args.channel, threadTs: args.threadTs });
    return true;
  }

  const oneLine = !text.includes("\n");
  const verb = oneLine ? PROXY_VERBS.find((v) => v.re.test(text)) : undefined;
  if (verb) {
    // The one verb that cannot be forwarded as typed. See buildDraftCommand: at awaiting_intake
    // the audit thread reads free text as the intake answers, so a bare `draft` would become the
    // answer rather than the instruction. `draft <anything>` is already an answer, so it rides
    // through untouched.
    const forwarded = /^draft\s*$/i.test(text) ? await buildDraftCommand(contact) : text;

    await proxyToAuditThread({
      contact,
      channel: args.channel,
      threadTs: args.threadTs,
      text: forwarded,
      label: verb.label,
      by,
    });
    return true;
  }

  // Free text. With a finished audit this is almost always the prospect's reply pasted in, and the
  // audit thread's own stage machine is the only thing that knows what to do with it. Without one
  // there is nothing to paste into yet, so it is a question for the assistant.
  const report = await findUsableAudit(contact.id);
  if (report) {
    await proxyToAuditThread({
      contact,
      channel: args.channel,
      threadTs: args.threadTs,
      text,
      label: "Their reply",
      by,
    });
    return true;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    await reply("AI is not configured, so I cannot answer. `ANTHROPIC_API_KEY` is unset.");
    return true;
  }

  try {
    const answer = await runLeadThreadAgent({
      contact,
      channel: args.channel,
      threadTs: args.threadTs,
      messageTs: args.messageTs,
      text,
      by,
    });
    // In the thread, never at the top of the channel. That distinction is the whole point of this
    // lane: one lead per thread, and the answer belongs with the person it is about.
    await reply(answer || "I do not have an answer for that.");
  } catch (err) {
    console.error("[leads] thread agent failed:", err);
    await reply(`:warning: That failed: ${(err as Error).message}`);
  }
  return true;
}
