// The `final prompt` door: the reading and the posting half of final-prompt.ts.
//
// Split from it so the builder stays pure and a probe can drive it with a context built by hand,
// which is the same split suggestions.ts and gap-thread.ts already have.
//
// ‼️ IT UPLOADS A FILE RATHER THAN POSTING A MESSAGE. This prompt carries the research already on
// file, the avatar sheet, the short offer, the letter and the text of every document ever dropped
// on this client. That is tens of thousands of characters on a real lead, and a Slack section over
// 3,000 fails the WHOLE message rather than truncating, so a message could not carry it even
// clipped. postFrameworkScript solved the same problem the same way.

import { slack } from "@/lib/slack-bot";
import type { LeadContext } from "./lead-context";
import { buildFinalPrompt, finalPromptSummary } from "./final-prompt";
import { AVATAR_SHEET, SHORT_OFFER, BELIEF_OPENING, MAX_NECESSARY_BELIEFS } from "@/config/avatar-framework";

export interface FinalPromptPost {
  message: string;
  after?: () => Promise<void>;
}

export async function postFinalPrompt(args: {
  ctx: LeadContext;
  clientId: string;
  channel: string;
  threadTs: string;
}): Promise<FinalPromptPost> {
  const { ctx, clientId, channel, threadTs } = args;

  // buildContext refuses when no avatar is confirmed, and that refusal is load-bearing rather than
  // incidental: research filed under the wrong avatar lands in question_bank, which is keyed by
  // vertical and shared by every client in it, with no per-client key to unpick it afterwards.
  const { buildContext, RESEARCH_SECTIONS } = await import("./artifacts/deep-research-run");
  const built = await buildContext(clientId);

  const { docTextsFor } = await import("./doc-text");
  const docs = await docTextsFor(clientId);

  const result = buildFinalPrompt({
    ctx,
    research: built.ok ? built.ctx : null,
    docs,
    sections: RESEARCH_SECTIONS,
    avatarSheet: AVATAR_SHEET,
    shortOffer: SHORT_OFFER,
    beliefOpening: BELIEF_OPENING,
    maxBeliefs: MAX_NECESSARY_BELIEFS,
  });

  if (!result.ok) {
    // The builder's own refusal, or buildContext's, whichever fired. Said in words rather than
    // answered with a generic prompt: a prompt built on a failed select is worse than none.
    const why = built.ok ? result.error : built.error;
    return { message: `:warning: No final prompt: ${why}` };
  }

  const prompt = result.prompt;
  const slug =
    (built.ok ? built.ctx.avatarSlug : "") ||
    ctx.identity.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "lead";

  return {
    message: finalPromptSummary(prompt),
    after: async () => {
      // uploadFile returns {ok:false} and never throws, and the share no-ops when the bot is not
      // a member of the channel.
      await slack.joinChannel(channel).catch(() => {});
      const res = (await slack.uploadFile(
        channel,
        `final-prompt-${slug}.txt`,
        Buffer.from(prompt.body, "utf8"),
        "text/plain",
        threadTs
      )) as { ok?: boolean; error?: string };

      if (res?.ok !== true) {
        const { postClientReply } = await import("./client-events");
        await postClientReply({
          clientId,
          stepKey: null,
          channel,
          threadTs,
          text: `:warning: The prompt was built but could not be uploaded: ${res?.error ?? "no reason given"}.`,
        }).catch(() => {});
      }
    },
  };
}
