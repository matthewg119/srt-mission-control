// Step 11's side of Matthew's framework: the script file, and the documents that come back.
//
// The pure half (parsers, the script builder) is src/lib/clients/avatar-framework.ts. This file is the
// part that reads and writes: posting the script, storing `avatar sheet:`, `short offer:` and `beliefs:`,
// and deciding what reaches the SHARED avatar record.
//
// ‼️ EVERY DOCUMENT LANDS ON THIS CLIENT FIRST. The chat that wrote them had this client's sales letter
// and offer in its prompt. The research and the avatar sheet reach the shared avatar_briefs only when that
// is empty, or on `share research` / `share sheet`; a quote joins the shared bank only when its link is in
// the stored research, so nothing from this client's letter becomes another client's evidence.
//
// ‼️ THE HANDOVER IS THE ONE THING THAT WAITS FOR THE LETTER, NOT STEP 11's [Done]. Step 11's evidence is
// that research came back, and `prompt short` research needs no letter. Blocking [Done] on the letter
// would stop a step that can run.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import {
  buildFrameworkScript,
  readAvatarSheet,
  readBeliefs,
  kindFromFilename,
  readFrameworkPaste,
  readShortOffer,
  type FrameworkDocumentKind,
} from "./avatar-framework";

export interface FrameworkReply {
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The script
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Post step 11's script into its thread, as a file. Returns what the thread was told.
 *
 * ‼️ ok:true WITH A NOTE WHEN THE LETTER IS NOT APPROVED YET. The step runner treats an error as terminal,
 * and a missing letter is a wait, not a failure. `letter approve` posts the script later.
 */
export async function postFrameworkScript(clientId: string): Promise<{ ok: true; posted: boolean; note: string } | { ok: false; error: string }> {
  const { approvedLetterFor } = await import("./sales-letter");
  const { notifyStep, channelFor, anchorTsFor } = await import("./step-board");
  const { stepNumber } = await import("@/config/delivery-steps");

  const letter = await approvedLetterFor(clientId);
  if (!letter.ok) {
    // ‼️ "RIGHT HERE", NOT "AT STEP 10", SINCE 2026-09-22. This note used to send somebody to
    // another thread to type one word, and typing it here instead matched nothing and reached the
    // assistant, which invented an Approve button. sales-letter.ts now takes these in this thread.
    const note =
      `:hourglass: The framework script waits for an approved sales letter, and ${letter.message}. ` +
      "Right here, or in step " +
      `${stepNumber("offer_locked")}'s thread: \`letter use\`, \`letter draft\` or \`letter replace:\`, ` +
      "then `letter approve`, and the script lands here. `prompt short` gives the short research " +
      "prompt now, if you want to start without it.";
    await notifyStep(clientId, "avatar_harvest", note).catch(() => {});
    return { ok: true, posted: false, note };
  }

  const { buildContext, researchHeadingContract } = await import("./artifacts/deep-research-run");
  const built = await buildContext(clientId);
  if (!built.ok) return { ok: false, error: built.error };

  const { loadOffer } = await import("./offers");
  const { audienceFor } = await import("./audiences");
  const [offer, aud] = await Promise.all([loadOffer(clientId), audienceFor(clientId)]);
  const audienceLabel = aud.ok ? aud.audience.label : built.ctx.avatarLabel;

  const script = buildFrameworkScript({
    clientName: built.ctx.clinicName,
    offer: offer.treatment ?? built.ctx.primaryTreatment ?? "the offer",
    terms: offer.terms,
    outcome: offer.outcomePromise,
    audienceLabel,
    city: built.ctx.city,
    letter: letter.doc.content,
    headingContract: researchHeadingContract(built.ctx),
  });

  const channel = await channelFor(clientId);
  const thread = channel ? await anchorTsFor(clientId, "avatar_harvest") : null;
  if (!channel || !thread) return { ok: false, error: "step 11 has no thread to post the script into" };

  // ‼️ uploadFile RETURNS {ok:false} AND NEVER THROWS, and the share no-ops when the bot is not a member.
  await slack.joinChannel(channel).catch(() => {});
  const slug = audienceLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "audience";
  const res = (await slack.uploadFile(
    channel,
    `framework-script-${slug}.txt`,
    Buffer.from(script, "utf8"),
    "text/plain",
    thread
  )) as { ok?: boolean; error?: string };
  if (res?.ok !== true) return { ok: false, error: `the script could not be uploaded: ${res?.error ?? "no reason given"}` };

  const note =
    `:scroll: The framework script for *${audienceLabel}* is above: seven messages for ONE chat, built on the approved letter. ` +
    "Bring back `research:`, `avatar sheet:`, `short offer:` and `beliefs:`, each as its own message (or a file with the prefix on its first line).";
  await notifyStep(clientId, "avatar_harvest", note).catch(() => {});
  return { ok: true, posted: true, note };
}

// ─────────────────────────────────────────────────────────────────────────────
// The paste-backs
// ─────────────────────────────────────────────────────────────────────────────

const SHARE = /^\s*share\s+(research|sheet)\s*$/i;
const PROMPT = /^\s*prompt\s*$/i;

/** `avatar sheet:`, `short offer:`, `beliefs:`, `share research`, `share sheet` and `prompt` in step 11's thread. */
export async function handleFrameworkThreadReply(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<FrameworkReply | null> {
  if (input.stepKey !== "avatar_harvest") return null;

  if (PROMPT.test(input.text)) {
    const res = await postFrameworkScript(input.clientId);
    if (!res.ok) return { message: `:warning: ${res.error}` };
    // postFrameworkScript already posted its own line into the thread either way.
    return { message: res.posted ? ":point_up: Posted again." : ":point_up: See above." };
  }

  const share = SHARE.exec(input.text);
  if (share) return shareToAvatar(input.clientId, share[1].toLowerCase() === "research" ? "deep_research" : "avatar_sheet");

  const paste = readFrameworkPaste(input.text);
  if (!paste) return null;
  return storeFrameworkDocument({ clientId: input.clientId, kind: paste.kind, body: paste.body, by: input.by });
}

/** A document that came back, stored on this client's audience. Also the entry point for dropped files. */
export async function storeFrameworkDocument(args: {
  clientId: string;
  kind: FrameworkDocumentKind;
  body: string;
  by: string;
}): Promise<FrameworkReply> {
  const { audienceFor } = await import("./audiences");
  const aud = await audienceFor(args.clientId);
  if (!aud.ok) return { message: `:warning: Not stored: ${aud.error}` };
  const audience = aud.audience;

  const { storeDocument } = await import("./audience-documents");

  if (args.kind === "avatar_sheet") {
    const read = readAvatarSheet(args.body);
    if (!read.ok) return { message: `:warning: Not stored: ${read.error}` };
    const saved = await storeDocument({
      clientId: args.clientId,
      audienceId: audience.id,
      offerId: null,
      kind: "avatar_sheet",
      content: args.body,
      parsed: { answered: read.parsed.answered, sections: read.parsed.sections, subs: read.parsed.subs },
      source: "pasted",
      by: args.by,
    });
    if (!saved.ok) return { message: `:warning: Not stored: ${saved.error}` };

    const shared = await shareSheetIfEmpty(audience, args.body, read.parsed);
    const quotes = await shareQuotesWithLinks(args.clientId, audience, read.parsed.sections);
    return {
      message: [
        `:white_check_mark: Avatar sheet stored for *${audience.label}*: ${read.parsed.answered.length} headings and lines answered` +
          (read.parsed.missingHeadings.length ? `, ${read.parsed.missingHeadings.length} heading(s) missing (${read.parsed.missingHeadings.join("; ")})` : "") +
          ".",
        shared,
        quotes,
        ...(await cardLines(args.clientId)),
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  // The short offer and the beliefs belong to the OFFER, so an offer has to be stored under this audience.
  const { loadOffer } = await import("./offers");
  const offer = await loadOffer(args.clientId);
  if (!offer.id || offer.audienceId !== audience.id) {
    return {
      message: ":warning: Not stored: there is no offer stored under this audience yet. Lock it at the prep call (`offer:`) first.",
    };
  }

  if (args.kind === "short_offer") {
    const read = readShortOffer(args.body);
    if (!read.ok) return { message: `:warning: Not stored: ${read.error}` };
    const saved = await storeDocument({
      clientId: args.clientId,
      audienceId: audience.id,
      offerId: offer.id,
      kind: "short_offer",
      content: args.body,
      parsed: { answered: read.parsed.answered, sections: read.parsed.sections },
      source: "pasted",
      by: args.by,
    });
    if (!saved.ok) return { message: `:warning: Not stored: ${saved.error}` };
    const headlines = await headlineCandidates(args.clientId, audience.id, read.parsed.sections.headline_ideas ?? "");
    return {
      message: [
        `:white_check_mark: Short offer stored for *${offer.treatment}*: ${read.parsed.answered.length} of its headings answered.`,
        headlines,
        ...(await cardLines(args.clientId)),
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  const read = readBeliefs(args.body);
  if (!read.ok) return { message: `:warning: Not stored: ${read.error}` };
  const saved = await storeDocument({
    clientId: args.clientId,
    audienceId: audience.id,
    offerId: offer.id,
    kind: "necessary_beliefs",
    content: read.beliefs.join("\n"),
    parsed: { beliefs: read.beliefs.map((text, i) => ({ id: `B${i + 1}`, text })) },
    source: "pasted",
    by: args.by,
  });
  if (!saved.ok) return { message: `:warning: Not stored: ${saved.error}` };
  return {
    message: [
      `:white_check_mark: ${read.beliefs.length} necessary belief${read.beliefs.length === 1 ? "" : "s"} stored for *${offer.treatment}*. Every page's stories install these:`,
      ...read.beliefs.map((b, i) => `  *B${i + 1}.* ${b}`),
      ...(await cardLines(args.clientId)),
    ].join("\n"),
  };
}

/** The completeness card for the primary audience, after a paste. Never throws. */
async function cardLines(clientId: string): Promise<string[]> {
  try {
    const { completenessFor } = await import("./dataset-completeness");
    const { formatDatasetReport } = await import("./dataset-spec");
    const primary = (await completenessFor(clientId)).find((c) => c.audience?.isPrimary);
    return primary?.audience ? ["", ...formatDatasetReport(primary.audience.label, true, primary.reports, primary.snapshot.offer.applies)] : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// What reaches the SHARED avatar record
// ─────────────────────────────────────────────────────────────────────────────

type Audience = import("./audiences").ResolvedAudience;

/** The shared avatar sheet is written from this paste only when nobody has written one. */
async function shareSheetIfEmpty(audience: Audience, sheet: string, parsed: { answered: string[] }): Promise<string> {
  if (!audience.researchAvatarSlug) return "";
  const { data, error } = await supabaseAdmin
    .from("avatar_briefs")
    .select("avatar_sheet")
    .eq("vertical", audience.researchVertical)
    .eq("avatar_slug", audience.researchAvatarSlug)
    .maybeSingle();
  if (error) return `:warning: The shared avatar record could not be read (${error.message}), so it was left alone.`;
  if (data?.avatar_sheet) {
    return `:lock: The shared avatar sheet for *${audience.label}* was left as it was. \`share sheet\` makes this one the shared sheet.`;
  }
  if (!data) return "";
  const { error: writeErr } = await supabaseAdmin
    .from("avatar_briefs")
    .update({ avatar_sheet: sheet, avatar_sheet_parsed: parsed, updated_at: new Date().toISOString() })
    .eq("vertical", audience.researchVertical)
    .eq("avatar_slug", audience.researchAvatarSlug)
    .is("avatar_sheet", null);
  return writeErr
    ? `:warning: The shared avatar sheet could not be written: ${writeErr.message}`
    : `:busts_in_silhouette: It is also the shared avatar sheet now: the next client targeting *${audience.label}* starts from it.`;
}

/** `share research` / `share sheet`: this client's live copy becomes the shared one, on purpose. */
async function shareToAvatar(clientId: string, kind: "deep_research" | "avatar_sheet"): Promise<FrameworkReply> {
  const { audienceFor } = await import("./audiences");
  const aud = await audienceFor(clientId);
  if (!aud.ok) return { message: `:warning: Nothing shared: ${aud.error}` };
  const audience = aud.audience;
  if (!audience.researchAvatarSlug) return { message: ":warning: Nothing shared: this audience has no avatar key." };

  const { currentDocument } = await import("./audience-documents");
  const cur = await currentDocument({ audienceId: audience.id, offerId: null, kind });
  if (!cur.ok) return { message: `:warning: ${cur.error}` };
  if (!cur.doc) {
    return { message: `:warning: Nothing to share: no ${kind === "deep_research" ? "research" : "avatar sheet"} is stored on this client yet.` };
  }

  if (kind === "deep_research") {
    const { storeAvatarResearch } = await import("./avatars");
    await storeAvatarResearch({
      vertical: audience.researchVertical,
      avatarSlug: audience.researchAvatarSlug,
      avatarLabel: audience.label,
      researchText: cur.doc.content,
      clientId,
    });
  } else {
    const { error } = await supabaseAdmin
      .from("avatar_briefs")
      .update({ avatar_sheet: cur.doc.content, avatar_sheet_parsed: cur.doc.parsed, updated_at: new Date().toISOString() })
      .eq("vertical", audience.researchVertical)
      .eq("avatar_slug", audience.researchAvatarSlug);
    if (error) return { message: `:warning: Not shared: ${error.message}` };
  }
  return {
    message: `:busts_in_silhouette: This client's ${kind === "deep_research" ? "research" : "avatar sheet"} is now the shared one for *${audience.label}*. Every client targeting that avatar reads it.`,
  };
}

/**
 * Quotes from the sheet that carry a link, into the shared voice-of-customer bank.
 *
 * ‼️ ONLY WHEN THE LINK IS IN THE STORED RESEARCH. A quote whose link the research never cited could be the
 * chat paraphrasing this client's letter, and the shared bank backs numbers in every client's headlines.
 */
async function shareQuotesWithLinks(clientId: string, audience: Audience, sections: Record<string, string>): Promise<string> {
  if (!audience.researchAvatarSlug) return "";
  const { currentDocument } = await import("./audience-documents");
  const own = await currentDocument({ audienceId: audience.id, offerId: null, kind: "deep_research" });
  const { data: brief } = await supabaseAdmin
    .from("avatar_briefs")
    .select("research_text, voc_quotes")
    .eq("vertical", audience.researchVertical)
    .eq("avatar_slug", audience.researchAvatarSlug)
    .maybeSingle();
  const research = `${own.ok ? own.doc?.content ?? "" : ""}\n${(brief?.research_text as string | null) ?? ""}`;
  if (!brief || !research.trim()) return "";

  const quoteKeys = ["general_quotes", "pain_quotes", "mindset_phrases", "emotional_state_quotes", "difficulty_quotes", "urgency_quotes"];
  const existing = Array.isArray(brief.voc_quotes) ? (brief.voc_quotes as Array<{ text?: string }>) : [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Set(existing.map((q) => norm(q.text ?? "")));

  const added: Array<{ text: string; source: string; source_url: string }> = [];
  for (const key of quoteKeys) {
    for (const line of (sections[key] ?? "").split(/\r?\n/)) {
      const quote = /["“]([^"”]{12,400})["”]/.exec(line)?.[1]?.trim();
      const url = /(https?:\/\/[^\s)>\]]+)/.exec(line)?.[1];
      if (!quote || !url || !research.includes(url)) continue;
      if (seen.has(norm(quote))) continue;
      seen.add(norm(quote));
      added.push({ text: quote, source: "framework avatar sheet", source_url: url });
    }
  }
  if (!added.length) return "";

  const { error } = await supabaseAdmin
    .from("avatar_briefs")
    .update({ voc_quotes: [...existing, ...added], updated_at: new Date().toISOString() })
    .eq("vertical", audience.researchVertical)
    .eq("avatar_slug", audience.researchAvatarSlug);
  return error
    ? `:warning: ${added.length} quote(s) could not join the shared bank: ${error.message}`
    : `:speech_balloon: ${added.length} quote${added.length === 1 ? "" : "s"} with links the research cites joined the shared bank headlines back numbers against.`;
}

/**
 * The short offer's headline ideas, as headline candidates for this audience, through the same rules.
 *
 * ‼️ THE ONES headlineFaults REJECTS ARE LISTED, NEVER DROPPED SILENTLY. Most sales headlines are not
 * query-shaped, which the page lane requires, so most will be rejected, and a reply that only counted the
 * survivors would read as if the short offer had almost no ideas.
 */
async function headlineCandidates(clientId: string, audienceId: string, block: string): Promise<string> {
  const ideas = block
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s>*_#`~-]*(?:\d+[.)]\s*)?/, "").replace(/[*_`]/g, "").trim())
    .map((l) => l.split(/\s+\/\s+/)[0].replace(/^["“]|["”]$/g, "").trim())
    .filter((l) => l.length >= 8 && !/^\[.*\]$/.test(l));
  if (!ideas.length) return "";

  const { headlineFaults, storeHeadlines, clientVocQuotes } = await import("./client-headlines");
  const quotes = await clientVocQuotes(clientId);
  const faults = headlineFaults(ideas, ideas.length, quotes.map((q) => q.text).join(" "));
  const bad = new Map(faults.filter((f) => f.headline).map((f) => [f.headline, f.why]));
  const good = ideas.filter((h) => !bad.has(h));

  let stored = 0;
  if (good.length) {
    const res = await storeHeadlines({ clientId, headlines: good, origin: "framework", audienceId });
    stored = res.ok ? res.stored.length : 0;
  }
  const rejected = ideas.filter((h) => bad.has(h));
  return [
    `:newspaper: ${ideas.length} headline idea${ideas.length === 1 ? "" : "s"} from the short offer: ${stored} kept as headline candidates.`,
    ...rejected.slice(0, 6).map((h) => `  • not kept: "${h.slice(0, 90)}" (${bad.get(h)})`),
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Files dropped into step 11's thread
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A text, Markdown or Word file dropped in step 11's thread, routed by its first line (or by the prefix
 * typed with it). A long answer does not fit a Slack message, which is why this exists.
 */
export async function storeFrameworkFile(args: {
  clientId: string;
  slackFileId: string;
  messageText: string;
  by: string;
}): Promise<FrameworkReply | null> {
  const { data: doc } = await supabaseAdmin
    .from("client_docs")
    .select("storage_ref, filename, content_type")
    .eq("slack_file_id", args.slackFileId)
    .maybeSingle();
  if (!doc?.storage_ref) return null;

  const dl = await supabaseAdmin.storage.from("onboarding").download(doc.storage_ref as string);
  if (dl.error || !dl.data) return { message: `:warning: *${doc.filename}* could not be read back: ${dl.error?.message ?? "no data"}` };
  const { extractFileText } = await import("@/lib/deck/extract");
  const text = await extractFileText(Buffer.from(await dl.data.arrayBuffer()), String(doc.filename ?? ""), String(doc.content_type ?? ""));
  if (!text?.trim()) return null;

  // ‼️ THREE SIGNALS, STRICTLY WEAKENING, AND THE ORDER IS THE WHOLE POINT.
  //
  // A typed prefix is a person saying what the file is. A first line is the document saying so
  // itself. A filename is only the name somebody saved it under, so it is consulted last and only
  // when both others miss. It was added because on 2026-09-22 four files whose first line is a
  // TITLE ("# AI Referral Engine Avatar Sheet") matched neither of the first two, fell through to
  // ingestResearchFile, and were shredded into a shared corpus as research.
  const typed = readFrameworkPaste(args.messageText);
  const firstLine = typed ? null : readFrameworkPaste(text);
  const named = typed || firstLine ? null : kindFromFilename(String(doc.filename ?? ""), text);

  const paste = typed ? { kind: typed.kind, body: text } : (firstLine ?? named);
  if (!paste) return null;

  const reply = await storeFrameworkDocument({ clientId: args.clientId, kind: paste.kind, body: paste.body, by: args.by });

  // ‼️ SAY WHICH SIGNAL CHOSE THE KIND, SO A GUESS READS AS A GUESS.
  //
  // The stored-reply already names the kind ("Avatar sheet stored for..."), but it names it the
  // same confident way whether a person typed the prefix or this function inferred it off a
  // filename. On 2026-09-22 the misfiling was invisible in the thread and surfaced three cards
  // later on the completeness count. A route taken off the weakest signal says so, and says how to
  // correct it, in the message that announces it.
  const lines = [`*${doc.filename}*`, reply.message];
  if (named) {
    lines.push(
      "_Read as that from the filename, because no prefix was typed and the first line is a title._ " +
        "If that is wrong, send it again with `avatar sheet:`, `short offer:` or `beliefs:` on the " +
        "first line or typed with the file."
    );
  }
  return { message: lines.join("\n") };
}
