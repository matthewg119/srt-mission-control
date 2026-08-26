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
import {
  recordSource,
  loadEvidenceFor,
  evidenceSummary,
  nextTopic,
  topicByKey,
  topicPosition,
  type EvidenceTopic,
} from "./page-evidence";

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

/**
 * What the thread is doing right now.
 *
 * ‼️ WITHOUT THIS, TYPED TEXT MEANS TWO DIFFERENT THINGS IN ONE THREAD. In `body` mode, which
 * is the original behaviour and the default, everything typed appends to answer_md word for
 * word. In `evidence` mode the same typing files a source and the page body is not touched. The
 * stored mode is what decides, exactly as the stored pageId already decides whether a bare digit
 * is a claim or a sentence about the page.
 */
type StudioMode = "body" | "evidence";

interface Session {
  threadTs: string;
  clientId: string;
  pageId: string | null;
  candidates: MenuItem[];
  mode: StudioMode;
  evidenceTopic: string | null;
}

async function readSession(threadTs: string): Promise<Session | null> {
  const { data, error } = await supabaseAdmin
    .from("page_studio_sessions")
    // ‼️ THE COLUMN IS `studio_mode`, NOT `mode`, AND THAT IS NOT A STYLE CHOICE.
    // `mode` is a built-in ordered-set aggregate in Postgres, and a PostgREST select naming a
    // bare `mode` resolves to the aggregate whenever the column is not there, failing with
    // "WITHIN GROUP is required for ordered-set aggregate mode". That error names neither this
    // table nor the missing column, and it would take down `readSession` for every thread.
    .select("thread_ts, client_id, page_id, candidates, studio_mode, evidence_topic")
    .eq("thread_ts", threadTs)
    .maybeSingle();

  // ‼️ A READ FAILURE AND AN UNKNOWN THREAD ARE THE SAME RETURN VALUE AND VERY DIFFERENT EVENTS,
  // so the failure is logged rather than swallowed. The caller treats null as "not one of ours"
  // and stays deliberately silent, which is right for a stray message and catastrophic for a
  // broken query: if this select ever fails, EVERY thread in the channel goes quiet with nothing
  // on screen to say so. The way that happens in practice is deploying this file before
  // docs/2026-08-26-evidence-and-gate.sql has been run, when studio_mode does not exist yet.
  if (error) {
    console.error(
      `[page-studio] session read failed (${error.message}). If this names studio_mode or ` +
        `evidence_topic, docs/2026-08-26-evidence-and-gate.sql has not been run on this database.`
    );
    return null;
  }

  if (!data) return null;
  return {
    threadTs: data.thread_ts as string,
    clientId: data.client_id as string,
    pageId: (data.page_id as string | null) ?? null,
    candidates: ((data.candidates as MenuItem[] | null) ?? []).filter((c) => c && c.question),
    // Rows written before docs/2026-08-26-evidence-and-gate.sql have no mode. Defaulting to
    // body is correct: everything this lane did before that migration was body mode.
    mode: ((data.studio_mode as string | null) ?? "body") === "evidence" ? "evidence" : "body",
    evidenceTopic: (data.evidence_topic as string | null) ?? null,
  };
}

async function setMode(
  session: Session,
  mode: StudioMode,
  topic: string | null
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("page_studio_sessions")
    .update({ studio_mode: mode, evidence_topic: topic, updated_at: new Date().toISOString() })
    .eq("thread_ts", session.threadTs);

  if (error) console.error("[page-studio] mode write failed:", error.message);
  session.mode = mode;
  session.evidenceTopic = topic;
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
  lines.push("Reply with a number to claim one. Then `ask` to walk the interview, or just talk");
  lines.push("and your words go into the page exactly as you said them. `draft` writes it from");
  lines.push("the evidence, `polish` tidies what you wrote, `check` runs the quality gate,");
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
      "\n*`ask`* walks the interview: what only they know, filed as evidence rather than as page " +
      "copy, and the drafter is then held to it.\n" +
      "Or just talk, and everything you send lands in the body word for word.\n" +
      "`draft` writes it from the evidence, `polish` tidies what you wrote, `check` runs the " +
      "quality gate, `done` finishes."
  );
}

/** Append what he said, verbatim, and say what happened to it. */
async function append(
  session: Session,
  text: string,
  source: "typed" | "voice",
  messageTs: string
): Promise<void> {
  if (!session.pageId) {
    await say(session.threadTs, "Pick a number from the list first, then this goes into that page.");
    return;
  }

  const res = await appendPageBody(session.clientId, session.pageId, text);
  if (!res.ok) {
    await say(session.threadTs, `:warning: ${res.error}`);
    return;
  }

  // ‼️ DICTATION INTO THE BODY IS ALSO EVIDENCE, AND FILING IT IS NOT BOOKKEEPING.
  // Without this row the page's own body is the only place those words exist, and the publish
  // gate would read a page dictated by the person who does the work as a page with nothing
  // behind it: `orphan_numbers` would refuse a price he said out loud, and `no_evidence` would
  // refuse the best-sourced page this product can produce. The words are already stored
  // verbatim in answer_md; this says WHERE THEY CAME FROM, which is the thing answer_md cannot.
  await recordSource({
    clientId: session.clientId,
    pageId: session.pageId,
    sourceType: "CLIENT_VOICE",
    sourceContent: text,
    topic: "Dictated straight into the page",
    collectedVia: source === "voice" ? "slack_voice" : "slack_typed",
    slackTs: messageTs,
  }).then((r) => {
    if (!r.ok) console.error("[page-studio] body source not filed:", r.error);
  });

  await say(
    session.threadTs,
    source === "voice"
      ? `Transcribed and added, word for word. The page is now ${res.words} words.\n> ${text.slice(0, 300)}${text.length > 300 ? "…" : ""}`
      : `Added, word for word. The page is now ${res.words} words.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The interview: `ask`
// ─────────────────────────────────────────────────────────────────────────────

/** How one topic is put to him. Numbered, so the card says how much is left. */
function topicCard(topic: EvidenceTopic): string {
  const { at, of } = topicPosition(topic.key);
  return (
    `*${at} of ${of}.* ${topic.prompt}\n` +
    (topic.scope === "client"
      ? "_Files against the business, so every future page for them can use it. Answer it once._\n"
      : "_About this page._\n") +
    "Talk or type. `next` to move on, `body` to go back to writing the page itself."
  );
}

/**
 * `ask` — switch the thread into the interview.
 *
 * ‼️ THE PAGE BODY IS NOT TOUCHED IN THIS MODE, and that separation is the whole feature.
 * What he says here is knowledge about the business, not prose for one page: pricing philosophy
 * and candidacy criteria feed every page the client will ever have, and pasting them into one
 * page's body both loses them for the others and makes that page read like an interview
 * transcript. The evidence is what the drafter is then held to.
 */
async function startInterview(session: Session): Promise<void> {
  if (!session.pageId) {
    await say(
      session.threadTs,
      "Pick a number from the list first. The interview files against that page and against the client."
    );
    return;
  }

  const first = nextTopic(null);
  if (!first) {
    await say(session.threadTs, "There are no interview topics configured.");
    return;
  }

  await setMode(session, "evidence", first.key);

  const existing = await loadEvidenceFor(session.clientId, session.pageId);

  await say(
    session.threadTs,
    "*Collecting what only they know.*\n" +
      "Nothing you say in here goes into the page body. It is filed as evidence, and the " +
      "drafter is then allowed to use that and nothing else.\n" +
      (existing.length ? `_Already on file: ${evidenceSummary(existing)}_\n` : "") +
      "\n" +
      topicCard(first)
  );
}

/** File one answer against the current topic and move the walk on. */
async function recordAnswer(
  session: Session,
  text: string,
  via: "slack_voice" | "slack_typed",
  messageTs: string
): Promise<void> {
  const topic = session.evidenceTopic ? topicByKey(session.evidenceTopic) : null;
  if (!topic) {
    // The stored topic no longer exists, which happens if EVIDENCE_TOPICS is edited under a
    // live thread. Say so rather than filing the answer against nothing.
    await say(
      session.threadTs,
      ":warning: This thread is on a topic that no longer exists. `ask` restarts the interview, `body` goes back to writing."
    );
    return;
  }

  const res = await recordSource({
    clientId: session.clientId,
    // ‼️ A CLIENT-SCOPED TOPIC FILES WITH page_id NULL. That is what makes the answer reusable:
    // pricing dictated once here shows up as evidence on every page this client ever gets. A
    // page-scoped answer filed against the client would be worse than useless, because it would
    // ground a later page in something said about a different question.
    pageId: topic.scope === "client" ? null : session.pageId,
    sourceType: "CLIENT_VOICE",
    sourceContent: text,
    topic: topic.prompt,
    collectedVia: via,
    slackTs: messageTs,
  });

  if (!res.ok) {
    await say(session.threadTs, `:warning: That was not filed: ${res.error}\nSay it again.`);
    return;
  }

  const words = text.split(/\s+/).filter(Boolean).length;
  const following = nextTopic(topic.key);

  if (!following) {
    await setMode(session, "body", null);
    await say(
      session.threadTs,
      `Filed, word for word. ${words} words against *${topic.key}*.\n\n` +
        "*That is the whole interview.* Back to page mode. `draft` writes the page from what " +
        "you just gave me, `check` runs it past the quality gate, `done` finishes."
    );
    return;
  }

  await setMode(session, "evidence", following.key);
  await say(
    session.threadTs,
    `Filed, word for word. ${words} words against *${topic.key}*.\n\n${topicCard(following)}`
  );
}

/** `next` / `skip` — nothing to say about this one. */
async function skipTopic(session: Session): Promise<void> {
  const following = nextTopic(session.evidenceTopic);
  if (!following) {
    await setMode(session, "body", null);
    await say(
      session.threadTs,
      "That was the last one. Back to page mode. `draft`, `check` or `done`."
    );
    return;
  }
  await setMode(session, "evidence", following.key);
  await say(session.threadTs, topicCard(following));
}

/** `body` — leave the interview, whatever is left of it. */
async function leaveInterview(session: Session): Promise<void> {
  await setMode(session, "body", null);
  await say(
    session.threadTs,
    "Back to page mode. Everything you say now goes into the page body word for word."
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// `draft` and `check`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `draft` — write the page from the evidence.
 *
 * ‼️ IT SUGGESTS, EXACTLY AS `polish` DOES. Nothing is saved and nothing is overwritten. The
 * two commands are deliberately separate rather than one smart one: `polish` tidies HIS words
 * and is allowed to add nothing, `draft` writes from the evidence and has to say what each
 * claim rests on. A single command guessing which job it is on would sometimes rewrite a
 * dictated page it was only meant to tidy, and he would find out after it published.
 */
async function draft(session: Session): Promise<void> {
  if (!session.pageId) {
    await say(session.threadTs, "Pick a number first, then `draft` writes that page.");
    return;
  }

  const { data: page } = await supabaseAdmin
    .from("client_pages")
    .select("question, slug")
    .eq("id", session.pageId)
    .eq("client_id", session.clientId)
    .maybeSingle();

  const sources = await loadEvidenceFor(session.clientId, session.pageId);
  if (sources.length === 0) {
    await say(
      session.threadTs,
      "There is nothing on file for this page or this client, so a draft would be a page about " +
        "the topic rather than about them, and the gate would refuse it. Run `ask` first."
    );
    return;
  }

  await say(session.threadTs, `Writing from ${evidenceSummary(sources)} Nothing in the page changes.`);

  const { draftPage } = await import("@/lib/hub/draft-page");
  const res = await draftPage(session.clientId, (page?.question as string) ?? "", {
    pageId: session.pageId,
  });

  if (!res.ok) {
    await say(session.threadTs, `:warning: Could not draft that: ${res.error}`);
    return;
  }

  const unbacked = res.page.evidenceUsed.filter((c) => c.sourceRef === null);

  await say(
    session.threadTs,
    "*A draft from the evidence. This is a suggestion, and your page is unchanged.*\n" +
      `Title: ${res.page.title}\n\n` +
      "```\n" +
      res.page.answerMd.slice(0, 2200) +
      (res.page.answerMd.length > 2200 ? "\n…" : "") +
      "\n```\n" +
      (unbacked.length
        ? `:warning: *${unbacked.length} claim${unbacked.length === 1 ? "" : "s"} with no source behind ${unbacked.length === 1 ? "it" : "them"}*, which will block the publish:\n` +
          unbacked.slice(0, 4).map((c) => `  • ${c.claim}`).join("\n") +
          "\nDictate the missing piece and draft again, or take the claim out on the board.\n"
        : `:white_check_mark: All ${res.page.evidenceUsed.length} claims trace to a source.\n`) +
      `Take it or leave it on the board: ${appUrl()}/dashboard/clients/${session.clientId}`
  );
}

/** `check` — run the quality gate and say what it found. */
async function check(session: Session): Promise<void> {
  if (!session.pageId) {
    await say(session.threadTs, "Pick a number first, then `check` runs the gate on that page.");
    return;
  }

  await say(session.threadTs, "Running the gate. This reads the page against its evidence.");

  const { runGate, renderVerdict } = await import("@/lib/hub/page-gate");
  const res = await runGate(session.clientId, session.pageId, { runBy: "page studio" });

  if (!res.ok) {
    await say(session.threadTs, `:warning: The gate did not run: ${res.error}`);
    return;
  }

  const { data: page } = await supabaseAdmin
    .from("client_pages")
    .select("slug")
    .eq("id", session.pageId)
    .maybeSingle();

  await say(session.threadTs, renderVerdict(res.run, (page?.slug as string) ?? ""));
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
      // Both walls said here rather than discovered at the Publish button, which is where each
      // costs a walk back.
      "_Publishing refuses while the Day 0 archive is unstamped. Once a page is live, the " +
      "baseline the day 30, 60 and 90 numbers are measured against cannot be recovered._\n" +
      "_It also refuses until the quality gate has read this exact body and not blocked. " +
      "`check` runs it._"
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
async function handleVoice(
  session: Session,
  files: StudioFile[],
  messageTs: string
): Promise<void> {
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

  // The transcript goes wherever the thread is pointing. A voice note in the interview is an
  // answer to the topic on screen; the same note in body mode is page copy.
  if (parts.length) {
    const joined = parts.join("\n\n");
    if (session.mode === "evidence") {
      await recordAnswer(session, joined, "slack_voice", messageTs);
    } else {
      await append(session, joined, "voice", messageTs);
    }
  }

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

  // ‼️ THE MODE COMMANDS ARE MATCHED BEFORE THE BODY APPEND AND AFTER NOTHING ELSE.
  // They are whole-word only, for the reason `done` and `polish` already are: a sentence that
  // happens to begin with "next" is a sentence, and swallowing it as a command would lose
  // dictation with no sign that it did.
  if (/^ask$/i.test(text)) {
    await startInterview(session);
    return true;
  }

  if (session.mode === "evidence" && /^(next|skip)$/i.test(text)) {
    await skipTopic(session);
    return true;
  }

  if (/^body$/i.test(text)) {
    await leaveInterview(session);
    return true;
  }

  if (/^draft$/i.test(text)) {
    await draft(session);
    return true;
  }

  if (/^check$/i.test(text)) {
    await check(session);
    return true;
  }

  // Voice notes first: a note usually arrives with no text at all, and when it does carry a
  // caption that caption is about the recording rather than page copy.
  if (args.files.some((f) => isVoiceNote(f))) {
    await handleVoice(session, args.files, args.messageTs);
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

  // The stored mode decides what typing means. Body mode is the default and is unchanged.
  if (session.mode === "evidence") {
    await recordAnswer(session, text, "slack_typed", args.messageTs);
    return true;
  }

  await append(session, text, "typed", args.messageTs);
  return true;
}
