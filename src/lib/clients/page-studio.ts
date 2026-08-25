// The page studio — talk at a ranked question, get a draft with your own words in it.
//
// Step 13 scores and ranks the questions worth building a page about and prints them as a PDF.
// Nothing turned any of that into a page. The only way to write one was the Hub panel's
// textarea, and the only way to get words into that was to type them.
//
// This is the other door. `page <client>` in the page channel posts the ranked list; a bare
// digit claims one; everything typed or dictated after that lands in the body VERBATIM.
//
// ‼️ NO MODEL TOUCHES HIS WORDS UNLESS HE TYPES `polish`, AND THAT IS THE WHOLE POINT.
// The concern this lane answers was about machine-written text at volume. There is no
// watermark in Claude's output and Google does not read one — SynthID is image, audio and
// video, and there is no text watermark on Anthropic API output. What Google's policy actually
// penalises is scaled, unhelpful, unedited content, which is a fact about the writing and not
// about who typed it. So nothing here is a workaround: it is a lane where his own words go in
// unchanged, and a model only gets near them when he asks for that by name.
//
// ‼️ NO THIRD PARTY, AND NONE IS NEEDED. The pages exist so an engine answering a buyer's
// question has something on the client's OWN domain to cite. learn.{clientdomain} already
// publishes, is indexed, has a per-host sitemap.xml and an llms.txt, carries QAPage markup and
// sits behind the Day 0 wall. Publishing anywhere else breaks the one thing it is for.
//
// ‼️ STEP 12 AND STEP 13 COME FROM THE SAME CORPUS AND DO OPPOSITE JOBS.
// Step 12 is the MEASUREMENT set: 40 or 60 questions, approved on the call, frozen at Day 0,
// and the thing the day 30, 60 and 90 numbers are scored against. Nothing is ever published
// from it. Step 13 is the PUBLISHING backlog: the same phrases scored for which are worth a
// page. This lane reads step 13 and only step 13.
//
// Precedents this follows rather than reinvents: drop-studio.ts for what a bare digit means
// against stored state, thread-assistant.ts for the abandon branch, and voice-notes.ts for the
// download-and-transcribe path, which is imported rather than copied.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { isVoiceNote, transcribeAudio } from "./voice-notes";
import { startPageDraft, appendPageBody, listAllForBoard, type ClientPage } from "@/lib/hub/pages";

/**
 * The channel this lane owns.
 *
 * Env-first, matching AUDIT_CHANNEL_ID and SLACK_CLIENT_ONBOARDING_CHANNEL. The literal is a
 * documented fallback rather than the usual "unset means off": this lane has exactly one
 * channel, its id is known, and an unset var would make the whole feature silently absent with
 * nothing on screen to say so.
 */
export function pageStudioChannel(): string {
  return process.env.SLACK_PAGE_STUDIO_CHANNEL || "C09QPHZGPUY";
}

/** How the channel is NAMED in another feature's card. A raw id helps nobody. */
export function pageStudioHint(): string {
  return `<#${pageStudioChannel()}>`;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

/** How many ranked questions the card offers. More than this and nobody reads to the bottom. */
const MENU_SIZE = 12;

// ─────────────────────────────────────────────────────────────────────────────
// The session
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One numbered item on the card.
 *
 * ‼️ FROZEN ON THE ROW, NOT RE-DERIVED AT DIGIT TIME. Re-running the ranking query when a
 * digit arrives would let a re-run of step 13 change what "2" means between the card being
 * posted and the number being typed. Same hazard client_pages.question is stored verbatim to
 * avoid, and the same shape content_jobs.data.fit_menu already uses.
 */
interface MenuItem {
  question: string;
  score: number;
  origin: "harvested" | "derived";
}

interface Session {
  threadTs: string;
  clientId: string;
  pageId: string | null;
  candidates: MenuItem[];
}

async function readSession(threadTs: string): Promise<Session | null> {
  const { data } = await supabaseAdmin
    .from("page_studio_sessions")
    .select("thread_ts, client_id, page_id, candidates")
    .eq("thread_ts", threadTs)
    .maybeSingle();

  if (!data) return null;
  return {
    threadTs: data.thread_ts as string,
    clientId: data.client_id as string,
    pageId: (data.page_id as string | null) ?? null,
    candidates: ((data.candidates as MenuItem[] | null) ?? []).filter((c) => c && c.question),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Posting, always checked
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ slackFetch RETURNS {ok:false} AND NEVER THROWS, so every post in this file goes through
 * here. An unchecked failure in this lane is the worst kind: he dictates for two minutes, the
 * reply never lands, and there is nothing on screen saying whether the words were kept.
 */
async function say(threadTs: string, text: string): Promise<boolean> {
  const res = (await slack.postThreadReply(pageStudioChannel(), threadTs, text)) as {
    ok?: boolean;
    error?: string;
  };
  if (!res?.ok) {
    console.error("[page-studio] reply failed:", res?.error ?? "unknown", text.slice(0, 120));
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// `page <client>`
// ─────────────────────────────────────────────────────────────────────────────

interface ClientRow {
  id: string;
  slug: string;
  name: string;
}

/**
 * Find the client he named.
 *
 * ‼️ ZERO MATCHES AND TWO MATCHES ARE THE SAME ANSWER, and the answer is a question back.
 * Picking the first of two would open a draft against the wrong client's hub, and the mistake
 * is only visible once the page is published on somebody's real domain. Same rule the presence
 * attribution follows: something unsure has found nothing.
 */
async function resolveClient(term: string): Promise<ClientRow[]> {
  const q = term.trim();
  if (q.length < 2) return [];

  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, slug, legal_name, dba_name")
    .or([`slug.ilike.%${q}%`, `legal_name.ilike.%${q}%`, `dba_name.ilike.%${q}%`].join(","))
    .limit(6);

  const rows = (data ?? []).map((r) => ({
    id: r.id as string,
    slug: (r.slug as string) ?? "",
    name: (((r.dba_name as string | null) || (r.legal_name as string)) ?? "this client") as string,
  }));

  // An exact slug match is unambiguous even when the fuzzy search also found neighbours.
  const exact = rows.filter((r) => r.slug.toLowerCase() === q.toLowerCase());
  return exact.length === 1 ? exact : rows;
}

/** The ranked menu, harvested first and derived after, each labelled. */
async function buildMenu(clientId: string): Promise<MenuItem[]> {
  const { data } = await supabaseAdmin
    .from("page_candidates")
    .select("question, score, origin")
    .eq("client_id", clientId)
    .order("score", { ascending: false })
    .limit(MENU_SIZE * 3);

  const rows: MenuItem[] = (data ?? [])
    .map((r) => ({
      question: ((r.question as string) ?? "").trim(),
      score: Number(r.score ?? 0),
      // Rows written before docs/2026-08-25-lane-4-pages.sql carry no origin. Defaulting them
      // to harvested is correct: everything this table held before that migration was.
      origin:
        (((r.origin as string | null) ?? "harvested") === "derived" ? "derived" : "harvested") as
          | "harvested"
          | "derived",
    }))
    .filter((r) => r.question.length > 0);

  const harvested = rows.filter((r) => r.origin === "harvested").slice(0, MENU_SIZE);
  const derived = rows.filter((r) => r.origin === "derived").slice(0, 4);
  return [...harvested, ...derived];
}

function statusMark(question: string, pages: ClientPage[]): string {
  const match = pages.find((p) => p.question.trim().toLowerCase() === question.trim().toLowerCase());
  if (!match) return "";
  return match.status === "published" ? "  `[published]`" : "  `[drafted]`";
}

/**
 * `page <client name or slug>` — post the card and open the session.
 *
 * The card is a reply under his own message, and that message's ts is the thread. Everything
 * after this happens in that thread, which is what makes two clients workable at once in one
 * channel.
 */
async function startSession(text: string, messageTs: string): Promise<void> {
  const term = text.replace(/^\s*page\b/i, "").trim();
  const channel = pageStudioChannel();

  if (!term) {
    await say(messageTs, "Which client? `page <name or slug>`, for example `page srt-agency-llc`.");
    return;
  }

  const matches = await resolveClient(term);
  if (matches.length === 0) {
    await say(messageTs, `No client matches "${term}". Try the slug from the client board.`);
    return;
  }
  if (matches.length > 1) {
    await say(
      messageTs,
      `"${term}" matches ${matches.length} clients, so I have not guessed:\n` +
        matches.map((m) => `  • \`${m.slug}\` — ${m.name}`).join("\n") +
        "\nRun `page` again with one of those slugs."
    );
    return;
  }

  const client = matches[0];
  const [menu, pages] = await Promise.all([buildMenu(client.id), listAllForBoard(client.id)]);

  if (menu.length === 0) {
    await say(
      messageTs,
      `*${client.name}* has no scored page candidates yet. That is step 13 on the delivery ` +
        "checklist, and it needs the phrase harvest (step 10) to have run first.\n" +
        `${appUrl()}/dashboard/clients/${client.id}`
    );
    return;
  }

  const harvested = menu.filter((m) => m.origin === "harvested");
  const derived = menu.filter((m) => m.origin === "derived");

  const lines: string[] = [
    `*${client.name}* — page candidates, best first.`,
    "",
    // The distinction, said on the card rather than assumed. It is the question Matthew asked
    // about these two steps, and it is a question rather than a defect.
    "_This is step 13, the PUBLISHING backlog: what is worth writing._",
    "_Step 12 is the MEASUREMENT set, frozen at Day 0, and nothing is ever published from it._",
    "",
  ];

  harvested.forEach((m, i) => {
    lines.push(`*${i + 1}.* ${m.question}${statusMark(m.question, pages)}  _(${m.score})_`);
  });

  if (derived.length) {
    lines.push("");
    lines.push("*Ideas we proposed*, not questions anybody typed. Tools, guides and comparisons:");
    derived.forEach((m, i) => {
      const n = harvested.length + i + 1;
      lines.push(`*${n}.* ${m.question}${statusMark(m.question, pages)}  _(derived, ${m.score})_`);
    });
  }

  lines.push("");
  lines.push("Reply with a number to claim one. Then type, or send a voice note, and your words");
  lines.push("go into the page exactly as you said them. `polish` when you want it tidied,");
  lines.push("`done` when you are finished, `cancel` to drop this.");

  const posted = (await slack.postThreadReply(channel, messageTs, lines.join("\n"))) as {
    ok?: boolean;
    error?: string;
  };
  if (!posted?.ok) {
    console.error("[page-studio] card post failed:", posted?.error ?? "unknown");
    return;
  }

  const { error } = await supabaseAdmin.from("page_studio_sessions").upsert(
    {
      thread_ts: messageTs,
      client_id: client.id,
      page_id: null,
      candidates: menu,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "thread_ts" }
  );
  if (error) {
    console.error("[page-studio] session write failed:", error.message);
    await say(
      messageTs,
      ":warning: The list posted but the session did not save, so a number will not work in this thread. Run `page` again."
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-thread
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A bare digit claims item N.
 *
 * 1-based against the FROZEN menu, exactly as pickFitWorkflow reads job.data.fit_menu. Out of
 * range says the range rather than doing nothing, because a digit that vanishes reads as the
 * bot being down.
 */
async function claim(session: Session, n: number): Promise<void> {
  const item = session.candidates[n - 1];
  if (!item) {
    await say(session.threadTs, `Pick a number between 1 and ${session.candidates.length}.`);
    return;
  }

  const opened = await startPageDraft({ clientId: session.clientId, question: item.question });
  if (!opened.ok) {
    await say(session.threadTs, `:warning: ${opened.error}`);
    return;
  }

  const { error } = await supabaseAdmin
    .from("page_studio_sessions")
    .update({
      page_id: opened.id,
      claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("thread_ts", session.threadTs);

  if (error) {
    console.error("[page-studio] claim write failed:", error.message);
    await say(
      session.threadTs,
      ":warning: The draft opened but this thread did not attach to it, so nothing you say next would be filed. Run `page` again."
    );
    return;
  }

  await say(
    session.threadTs,
    (opened.resumed ? "*Back on a draft you already started.*\n" : "*Draft opened.*\n") +
      `> ${item.question}\n` +
      (item.origin === "derived"
        ? "_A page we proposed rather than a question anybody typed._\n"
        : "") +
      "\nTalk or type. Everything you send lands in the body word for word. " +
      "`polish` tidies it, `done` finishes."
  );
}

/** Append what he said, verbatim, and say what happened to it. */
async function append(session: Session, text: string, source: "typed" | "voice"): Promise<void> {
  if (!session.pageId) {
    await say(session.threadTs, "Pick a number from the list first, then this goes into that page.");
    return;
  }

  const res = await appendPageBody(session.clientId, session.pageId, text);
  if (!res.ok) {
    await say(session.threadTs, `:warning: ${res.error}`);
    return;
  }

  await say(
    session.threadTs,
    source === "voice"
      ? `Transcribed and added, word for word. The page is now ${res.words} words.\n> ${text.slice(0, 300)}${text.length > 300 ? "…" : ""}`
      : `Added, word for word. The page is now ${res.words} words.`
  );
}

/**
 * `polish` — the ONE opt-in.
 *
 * ‼️ IT SUGGESTS. IT NEVER WRITES. What he dictated stays in the body untouched and the tidied
 * version is posted in the thread for him to take or ignore. Overwriting would make this lane
 * exactly the thing it exists to avoid: his words replaced by a model's without him choosing
 * it, one command earlier than he meant.
 */
async function polish(session: Session): Promise<void> {
  if (!session.pageId) {
    await say(session.threadTs, "Nothing to polish yet. Pick a number, then say something.");
    return;
  }

  const { data: page } = await supabaseAdmin
    .from("client_pages")
    .select("question, answer_md")
    .eq("id", session.pageId)
    .eq("client_id", session.clientId)
    .maybeSingle();

  const body = ((page?.answer_md as string | null) ?? "").trim();
  if (!body) {
    await say(session.threadTs, "The page is still empty, so there is nothing to tidy. Say something first.");
    return;
  }

  await say(session.threadTs, "Tidying what you wrote. Nothing in the page changes.");

  const { draftPage } = await import("@/lib/hub/draft-page");
  const res = await draftPage(session.clientId, (page?.question as string) ?? "", {
    existingBody: body,
  });

  if (!res.ok) {
    await say(
      session.threadTs,
      `:warning: Could not tidy that: ${res.error}\nWhat you wrote is untouched.`
    );
    return;
  }

  await say(
    session.threadTs,
    "*A tidied version. This is a suggestion, and your page is unchanged.*\n" +
      `Title: ${res.page.title}\n\n` +
      "```\n" +
      res.page.answerMd.slice(0, 2400) +
      (res.page.answerMd.length > 2400 ? "\n…" : "") +
      "\n```\n" +
      `Take it or leave it on the board: ${appUrl()}/dashboard/clients/${session.clientId}`
  );
}

/** `done` — the board link, and the thread released. */
async function finish(session: Session): Promise<void> {
  const board = `${appUrl()}/dashboard/clients/${session.clientId}`;

  if (!session.pageId) {
    await supabaseAdmin.from("page_studio_sessions").delete().eq("thread_ts", session.threadTs);
    await say(session.threadTs, "Nothing was claimed, so nothing was written. Thread released.");
    return;
  }

  const { data: page } = await supabaseAdmin
    .from("client_pages")
    .select("slug, answer_md")
    .eq("id", session.pageId)
    .maybeSingle();

  const words = ((page?.answer_md as string | null) ?? "").split(/\s+/).filter(Boolean).length;

  await supabaseAdmin.from("page_studio_sessions").delete().eq("thread_ts", session.threadTs);

  await say(
    session.threadTs,
    `*Saved as a draft.* ${words} word${words === 1 ? "" : "s"} at \`/${page?.slug ?? ""}\`.\n` +
      `Edit, format and publish it in the Hub panel: ${board}\n\n` +
      // Said here rather than discovered at the Publish button, which is where it costs a walk
      // back to the checklist.
      "_Publishing refuses while the Day 0 archive is unstamped. That is the one hard wall in " +
      "this system: once a page is live, the baseline the day 30, 60 and 90 numbers are " +
      "measured against cannot be recovered._"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice notes
// ─────────────────────────────────────────────────────────────────────────────

export interface StudioFile {
  id?: string;
  name?: string;
  mimetype?: string;
  filetype?: string;
  subtype?: string;
  url_private_download?: string;
}

/**
 * Transcribe every voice note on one message and append them as ONE chunk.
 *
 * ‼️ ONE REPLY PER MESSAGE, NOT ONE PER FILE. The onboarding lane learned this: four identical
 * replies under one upload is noise nobody reads, and here it would also mean several appends
 * racing each other on the same body.
 *
 * ‼️ slack.downloadFile IS THE ONE SLACK HELPER THAT THROWS. Everything else in that client
 * returns {ok:false}. A failure here has to end in a message asking him to paste it, because
 * the alternative is two minutes of speech going nowhere with no sign that it did.
 */
async function handleVoice(session: Session, files: StudioFile[]): Promise<void> {
  const notes = files.filter((f) => isVoiceNote(f));
  if (notes.length === 0) return;

  if (!session.pageId) {
    await say(session.threadTs, "Pick a number from the list first, then send that again.");
    return;
  }

  const parts: string[] = [];
  const failures: string[] = [];

  for (const file of notes) {
    if (!file.url_private_download) {
      failures.push(`${file.name ?? "a voice note"}: Slack gave no download URL`);
      continue;
    }
    try {
      const buf = await slack.downloadFile(file.url_private_download);
      const result = await transcribeAudio(
        buf,
        file.name ?? "note.m4a",
        file.mimetype ?? "audio/mpeg"
      );
      if (result.ok && result.text) parts.push(result.text.trim());
      else failures.push(`${file.name ?? "a voice note"}: ${result.error ?? "empty transcript"}`);
    } catch (e) {
      failures.push(`${file.name ?? "a voice note"}: ${(e as Error).message}`);
    }
  }

  if (parts.length) await append(session, parts.join("\n\n"), "voice");

  if (failures.length) {
    await say(
      session.threadTs,
      `:warning: Could not transcribe ${failures.length} of ${notes.length}:\n` +
        failures.map((f) => `  • ${f}`).join("\n") +
        "\nType it instead and it goes in the same way."
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The one entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything the page channel does.
 *
 * Returns true when it handled the event. The channel is dedicated so the caller returns
 * either way; the flag exists so the caller stays a one-line call rather than a branch.
 */
export async function handlePageStudioEvent(args: {
  text: string;
  messageTs: string;
  threadTs: string | null;
  files: StudioFile[];
}): Promise<boolean> {
  const text = (args.text ?? "").trim();
  const inThread = Boolean(args.threadTs && args.threadTs !== args.messageTs);

  // Top level: `page <client>` is the only thing that starts anything.
  if (!inThread) {
    if (/^page\b/i.test(text)) {
      await startSession(text, args.messageTs);
      return true;
    }
    if (text || args.files.length) {
      await say(
        args.messageTs,
        "Start with `page <client name or slug>`, then pick a number and talk."
      );
    }
    return true;
  }

  const session = await readSession(args.threadTs as string);
  if (!session) {
    // Not one of ours. Silence rather than a nudge: this channel can hold ordinary
    // conversation under a released card, and answering all of it would be the bot talking
    // to itself.
    return false;
  }

  // ‼️ THE ABANDON BRANCH, AND IT IS NOT OPTIONAL. Every thread session in this repo has one.
  // Without it a menu left half-finished eats a digit typed days later and claims a question
  // nobody meant to claim.
  if (/^(cancel|nevermind|never mind|stop)$/i.test(text)) {
    await supabaseAdmin.from("page_studio_sessions").delete().eq("thread_ts", session.threadTs);
    await say(session.threadTs, "Dropped. Nothing else in this thread will be read as a page.");
    return true;
  }

  if (/^done$/i.test(text)) {
    await finish(session);
    return true;
  }

  if (/^polish$/i.test(text)) {
    await polish(session);
    return true;
  }

  // Voice notes first: a note usually arrives with no text at all, and when it does carry a
  // caption that caption is about the recording rather than page copy.
  if (args.files.some((f) => isVoiceNote(f))) {
    await handleVoice(session, args.files);
    return true;
  }

  // ‼️ THE DIGIT IS ONLY A CLAIM WHILE NOTHING IS CLAIMED. Once a page is open, "3" is
  // something he said about the page and belongs in the body. Same doctrine as
  // thread-assistant.ts, where a bare digit means different things at different moments and
  // the stored state is what decides.
  const digit = /^([0-9]{1,2})$/.exec(text);
  if (digit && !session.pageId) {
    await claim(session, Number(digit[1]));
    return true;
  }

  if (!text) return true;

  await append(session, text, "typed");
  return true;
}
