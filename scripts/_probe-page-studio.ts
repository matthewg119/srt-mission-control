// THE PAGE STUDIO IS REACHABLE, AND THE COMMANDS MATCH WHAT A PERSON ACTUALLY TYPES.
//
//   bunx tsx --env-file=.env.local scripts/_probe-page-studio.ts
//
// ‼️ THIS EXISTS BECAUSE THE LANE FAILED SILENTLY FOR WEEKS AND NOTHING ANYWHERE SAID SO.
//
// Matthew typed `page SRT Agency LLC` into #aeo-seo-page-drafting and got nothing back. Two
// separate causes, and neither of them was the studio's logic, which would have replied with a
// candidate card, "No client matches", or a disambiguation list on every path:
//
//   1. THE BOT IS NOT A MEMBER OF THE CHANNEL. Slack lets a bot chat.postMessage into a public
//      channel it has never joined, but it does not DELIVER message.channels events from one.
//      So the request never arrived, nothing errored, and every log was empty. slack-bot.ts's
//      joinChannel() has carried a comment about that asymmetry since it was written.
//   2. HE TYPED IT AS A CODE SPAN. The backticks arrive as literal characters and every command
//      in that lane is anchored at the start of the message.
//
// Both are fixed. This probe is what stops either coming back as silence: it checks the
// membership over the real API and the unwrapping as pure string work.
//
// A source probe plus one read-only Slack call. It writes nothing, posts nothing, and joins
// nothing: joining a channel is a decision, not a repair a probe gets to make on its own.

import { slack } from "../src/lib/slack-bot";
import { pageStudioChannel, unwrapFormatting } from "../src/lib/clients/page-studio";

let failures = 0;

function check(ok: boolean, label: string, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (!ok) failures += 1;
}

async function main(): Promise<void> {
  // ── 1. The wrappers a person actually types ────────────────────────────────
  //
  // The pairs are stripped one layer at a time from the outside in, so a bolded code span
  // unwraps too. Anything with only one side is left alone: a message that opens with a
  // backtick and never closes it is not a command wearing a costume, it is prose.
  const cases: Array<[string, string]> = [
    ["page srt-agency-llc", "page srt-agency-llc"],
    ["`page srt-agency-llc`", "page srt-agency-llc"],
    ["```page x```", "page x"],
    ["```page srt-agency-llc```", "page srt-agency-llc"],
    ["*page srt-agency-llc*", "page srt-agency-llc"],
    ["_page srt-agency-llc_", "page srt-agency-llc"],
    ["*`page srt-agency-llc`*", "page srt-agency-llc"],
    ["  `page SRT Agency LLC`  ", "page SRT Agency LLC"],
    ["`done`", "done"],
    ["`magnet 2`", "magnet 2"],
    // Unpaired, and therefore untouched.
    ["`page srt", "`page srt"],
    ["page srt`", "page srt`"],
    // ‼️ NOT A WRAPPER. An emphasised word mid-sentence is dictation and must survive whole,
    // because this same text is what gets appended to a page verbatim.
    ["we do *lip filler* here", "we do *lip filler* here"],
    // A lone marker is shorter than its own pair and must not underflow into an empty string.
    ["`", "`"],
    ["*", "*"],
  ];

  for (const [input, expected] of cases) {
    const got = unwrapFormatting(input);
    check(got === expected, `unwrap ${JSON.stringify(input)}`, got === expected ? undefined : `got ${JSON.stringify(got)}`);
  }

  // Every command the lane understands still matches after unwrapping. The regexes here are
  // copies on purpose: if one in page-studio.ts is tightened, this notices.
  const commands: Array<[string, RegExp]> = [
    ["`page x`", /^page\b/i],
    ["`done`", /^done$/i],
    ["`polish`", /^polish$/i],
    ["`ask`", /^ask$/i],
    ["`body`", /^body$/i],
    ["`draft`", /^draft$/i],
    ["`check`", /^check$/i],
    ["`magnet more`", /^magnet(?:\s+(.+))?$/i],
    ["`review`", /^review(?:\s+(quotes?|quote\s+[0-9]{1,2}))?$/i],
    ["`review quotes`", /^review(?:\s+(quotes?|quote\s+[0-9]{1,2}))?$/i],
    ["`3`", /^([0-9]{1,2})$/],
  ];
  for (const [typed, re] of commands) {
    check(re.test(unwrapFormatting(typed)), `a backticked ${JSON.stringify(typed)} still matches its command`);
  }

  // ── 1b. A command must not eat a sentence ─────────────────────────────────
  //
  // ‼️ THE FAILURE THIS CATCHES IS SILENT, WHICH IS WHY IT IS ASSERTED RATHER THAN TRUSTED.
  // In a studio thread, anything that is not a command is appended to the page VERBATIM. So a
  // command pattern that is one character too loose does not throw, it swallows a sentence of
  // dictation and puts nothing on screen to say it did. page-studio.ts already carries that
  // warning about `next`; these are the two commands added 2026-09-08 that take an argument.
  //
  // Caught live before this existed: "avatars are hard to write" matched the avatar command and
  // captured "s are hard to write".
  //
  // The patterns are COPIES on purpose. If one in page-studio.ts is loosened, this notices.
  const OFFER_CMD = /^offer(?:\s*[:]\s*(.+))?$/i;
  const AVATAR_CMD = /^avatar(?:\s*:\s*(.+)|\s+(new\s+.+))?$/i;
  const KEYWORDS_CMD = /^keywords?$/i;
  // ‼️ THE THIRD ONE, AND THE RISKIEST OF THE THREE. This lane is ABOUT reviews, so the word
  // shows up in ordinary dictation constantly: "reviews are up this month", "review the copy
  // before it ships", "our review tool is live". Anchored at both ends and the plural is
  // deliberately not a command, so all three of those reach the page untouched.
  const REVIEW_CMD = /^review(?:\s+(quotes?|quote\s+[0-9]{1,2}))?$/i;

  const argCommands: Array<[string, "offer" | "avatar" | "keywords" | "review" | "body"]> = [
    ["offer", "offer"],
    ["offer: lip filler", "offer"],
    ["offer: lip filler | the one they rebook", "offer"],
    ["`offer: lip filler`", "offer"],
    ["avatar", "avatar"],
    ["avatar: med spa owner", "avatar"],
    ["avatar new busy clinic manager", "avatar"],
    ["keywords", "keywords"],
    ["keyword", "keywords"],
    // ‼️ EVERY ONE OF THESE IS DICTATION AND MUST REACH THE PAGE UNTOUCHED.
    ["offer them a discount on the second visit", "body"],
    ["offers we make to new patients", "body"],
    ["avatars are hard to write", "body"],
    ["avatar research takes a while", "body"],
    ["avatar: new patients only", "avatar"],
    ["keywords matter less than people think", "body"],
    ["the offer: what we give away", "body"],
    ["review", "review"],
    ["review quotes", "review"],
    ["review quote 3", "review"],
    ["`review`", "review"],
    // ‼️ DICTATION ABOUT REVIEWS, IN A LANE ABOUT REVIEWS. All of these must reach the page.
    ["reviews are up this month", "body"],
    ["review the copy before it ships", "body"],
    ["our review tool is live", "body"],
    ["reviewed it with her yesterday", "body"],
    ["review quotes from last month were better", "body"],
  ];

  for (const [typed, expected] of argCommands) {
    const c = unwrapFormatting(typed);
    // The same precedence order as the real dispatch in page-studio.ts.
    const got = OFFER_CMD.test(c)
      ? "offer"
      : AVATAR_CMD.test(c)
        ? "avatar"
        : KEYWORDS_CMD.test(c)
          ? "keywords"
          : REVIEW_CMD.test(c)
            ? "review"
            : "body";
    check(got === expected, `${JSON.stringify(typed)} is ${expected}`, got === expected ? undefined : `read as ${got}`);
  }

  // ── 2. The channel, over the real API ──────────────────────────────────────
  const channel = pageStudioChannel();
  const join = process.argv.includes("--join");
  console.log("");
  console.log(`Channel: ${channel}${process.env.SLACK_PAGE_STUDIO_CHANNEL ? " (from SLACK_PAGE_STUDIO_CHANNEL)" : " (code fallback)"}`);

  if (!process.env.SLACK_BOT_TOKEN) {
    console.log("SLACK_BOT_TOKEN is not set, so the membership half was not checked.");
    console.log("Run with --env-file=.env.local. Without it this probe checks strings only.");
  } else {
    const info = await slack.getChannelInfo(channel);
    if (!info) {
      check(false, "the channel resolves", `conversations.info returned nothing for ${channel}. Wrong id, or the bot cannot see it.`);
    } else {
      check(true, `the channel resolves`, `#${info.name ?? "unknown"}`);
      check(info.is_archived !== true, "it is not archived");
      // ‼️ THE ONE THAT MATTERED. A false here is the whole bug and it is invisible from the
      // application side, because posting keeps working while receiving does not.
      check(
        info.is_member === true,
        "the bot is a member, so Slack will deliver message events from it",
        info.is_member === true
          ? undefined
          : `is_member is ${String(info.is_member)}. Slack will not deliver message.channels events from this ` +
            `channel, so every command typed in it is dropped before it reaches any code. ` +
            `Fix: type "/invite @<the bot>" in #${info.name ?? channel}, or re-run this with --join.`
      );

      // ‼️ OPT IN, AND THAT IS THE POINT. Joining a channel is an action in somebody's
      // workspace, so a probe does not get to take it on its own just because it noticed. The
      // flag is here so the fix is one command rather than a hunt through Slack's UI.
      if (join && info.is_member !== true) {
        const res = await slack.joinChannel(channel);
        console.log("");
        console.log(
          res.ok
            ? `Joined #${info.name ?? channel}. Re-run without --join to confirm.`
            : `Could not join: ${res.error ?? "unknown"}. A private channel needs a human to /invite.`
        );
      }
    }
  }

  console.log("");
  if (failures) {
    console.error(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("All checks passed. The page studio can hear you.");
}

void main();

export {};
