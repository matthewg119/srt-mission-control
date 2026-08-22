// The `webinar` lane in #content-full: script in, deck.pptx + slide-plan.md back in the thread.
//
// Two halves, split for the same reason `ingest-avatar` is: the Slack event handler has to ack
// fast, and a 1,500-word script is a dozen Claude calls. `startWebinarDeck` posts the receipt
// and hands off to /api/content/webinar-deck, which owns its own 300s budget.

import { slack } from "@/lib/slack-bot";
import { authorDeck, deckTitle } from "./author";
import { renderDeck, writePlan, deckWarnings } from "./render";
import { runParity, validateSlides, splitSections } from "./parity";
import { resolveScript } from "./extract";
import { slideText, type DeckSlide } from "./types";

export interface SlackFileRef {
  name?: string;
  mimetype?: string;
  url_private_download?: string;
}

/** Kick the build off. Returns false when there was nothing to build from. */
export async function startWebinarDeck(args: {
  channel: string;
  threadTs: string;
  text: string;
  files: SlackFileRef[];
}): Promise<boolean> {
  const hasScript = args.text.trim().length > 0 || args.files.length > 0;
  if (!hasScript) {
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      "Paste the webinar script under `webinar`, or attach it as a .pdf, .docx or .txt."
    );
    return true;
  }

  await slack.postThreadReply(args.channel, args.threadTs, "Reading the script...");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  try {
    await fetch(`${appUrl}/api/content/webinar-deck`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: args.channel,
        thread_ts: args.threadTs,
        text: args.text,
        files: args.files.map((f) => ({
          name: f.name,
          mimetype: f.mimetype,
          url_private_download: f.url_private_download,
        })),
      }),
    });
  } catch (e) {
    console.error("[webinar-deck] dispatch error:", (e as Error).message);
    await slack.postThreadReply(args.channel, args.threadTs, `Could not start the build: ${(e as Error).message}`);
  }
  return true;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The whole build. Runs inside the route, which owns the long timeout. */
export async function buildWebinarDeck(args: {
  channel: string;
  threadTs: string;
  text: string;
  files: Array<{ name?: string; mimetype?: string; url_private_download?: string }>;
}): Promise<void> {
  const { channel, threadTs } = args;
  const say = (msg: string) => slack.postThreadReply(channel, threadTs, msg).catch(() => {});

  const downloaded: Array<{ buffer: Buffer; name: string; mime: string }> = [];
  for (const f of args.files) {
    if (!f.url_private_download) continue;
    try {
      downloaded.push({
        buffer: await slack.downloadFile(f.url_private_download),
        name: f.name ?? "attachment",
        mime: f.mimetype ?? "",
      });
    } catch (e) {
      console.error("[webinar-deck] download failed:", (e as Error).message);
    }
  }

  const source = await resolveScript({ text: args.text, files: downloaded });
  if (!source) {
    await say("I could not read a script out of that. Paste the text, or attach a .pdf, .docx or .txt.");
    return;
  }

  const { headers } = splitSections(source.text);
  const scriptWords = source.text.split(/\s+/).filter(Boolean).length;
  await say(
    `Script read from ${source.origin}: ~${scriptWords.toLocaleString()} words` +
    (headers.length ? `, ${plural(headers.length, "section")} (${headers.join(" · ")}).` : ".") +
    " Chunking it by idea now."
  );

  // Progress is throttled to the batch boundaries the author already reports, so a 12-call
  // build says something every 20 seconds or so instead of going silent for four minutes.
  let lastPost = 0;
  const authored = await authorDeck(source.text, (msg) => {
    const now = Date.now();
    if (now - lastPost > 20_000 || /plainly|error/.test(msg)) {
      lastPost = now;
      void say(msg);
    }
  });

  const slides: DeckSlide[] = authored.slides;
  if (!slides.length) {
    await say("That produced no slides. Nothing was built.");
    return;
  }
  validateSlides(slides);

  const parity = runParity(source.text, slides);
  const onScreen = slides.reduce((n, s) => n + slideText(s).split(/\s+/).filter(Boolean).length, 0);
  const visuals = slides.filter((s) => s.visual).length;

  const title = deckTitle(source.text);
  const pptx = await renderDeck(slides, title);
  const plan = writePlan(slides);

  // uploadFile RETURNS {ok:false}, it does not throw. Unchecked, a missing files:write scope or
  // a channel the bot is not in produces a confident summary with no deck attached to it.
  const uploads = await Promise.all([
    slack.uploadFile(
      channel,
      "deck.pptx",
      pptx,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      threadTs
    ),
    slack.uploadFile(channel, "slide-plan.md", Buffer.from(plan, "utf8"), "text/markdown", threadTs),
  ]);
  const failed = uploads
    .map((r, i) => (r?.ok === false ? `${i === 0 ? "deck.pptx" : "slide-plan.md"} (${r.error ?? "unknown"})` : null))
    .filter(Boolean);

  const lines: string[] = [];
  if (failed.length) {
    lines.push(
      `Could not upload ${failed.join(" and ")}. The deck built fine; this is a Slack upload ` +
      `problem (check the bot has files:write and is in this channel).`
    );
  }
  lines.push(
    parity.ok
      ? `PARITY PASS. ${parity.scriptWords.toLocaleString()} script words, ${parity.deckWords.toLocaleString()} on the slides.`
      : `PARITY FAIL. ${parity.scriptWords.toLocaleString()} script words, ${parity.deckWords.toLocaleString()} on the slides. Check these before recording:`
  );
  if (!parity.ok) for (const p of parity.problems) lines.push("```" + p + "```");
  lines.push(`${plural(slides.length, "slide")}, ${plural(onScreen, "word")} on screen, ${visuals} with a visual.`);
  if (authored.sections.length) lines.push(`Sections: ${authored.sections.join(" · ")}`);
  if (parity.removed.length) {
    lines.push(`Delivery notes kept off the slides (${parity.removed.length}): ${parity.removed.slice(0, 6).join(", ")}`);
  }
  if (authored.fellBackBatches > 0) {
    lines.push(
      `${authored.fellBackBatches} of ${authored.totalBatches} passages were chunked plainly ` +
      `(no purple, no visual) because they would not come back verbatim. The words are still exact.`
    );
  }
  for (const w of deckWarnings(slides)) lines.push(`Warning: ${w}`);
  lines.push(
    "Canva: Uploads, drop deck.pptx in, it opens as an editable design. Select all and swap the " +
    "font to Baloo 2 or Fredoka ExtraBold, then replace the gray boxes using the prompts in the " +
    "speaker notes."
  );

  await say(lines.join("\n"));
}
