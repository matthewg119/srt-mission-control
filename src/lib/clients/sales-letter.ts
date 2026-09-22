// The sales letter, at step 10 (the prep call), for the offer being locked.
//
// Matthew, 2026-09-15: "we need a sales letter first so make sure we can build the sales letter after or
// while in the call ... (if they don't have any in their website) and we can use that sales letter to
// finish this avatar creation framework". The framework's first chat message analyses the offer's sales
// page, so step 11's script is not handed over until a letter is approved.
//
// ‼️ AN INTERNAL WORKING DOCUMENT. It never publishes, and nothing in it reaches a page without passing the
// evidence gate. Its job is to be read by the framework chat.
//
// ‼️ ONE COMMAND PER MESSAGE, THE FIRST LINE DECIDES (the rule of e9b0f3e):
//   letter use            take the client's own sales page for this offer, if one is plainly on their site
//   letter use <url>      take that page
//   letter draft          write one (ONE model call, so only when typed: D9, nothing costs money unattended)
//   letter text           the whole letter, as a file
//   letter replace:       the edited letter, verbatim, keeping every prior version
//   letter approve [id]   approve the version shown
//
// ‼️ FAULTS BLOCK APPROVAL ONLY FOR A LETTER WE DRAFTED. A model writing "guaranteed" or an invented figure
// is our fabrication. A page taken from the client's site, or a letter Matthew pasted, is somebody's real
// words, so its faults are listed as warnings and the approval is theirs to make.

import { supabaseAdmin } from "@/lib/db";
import { hasBannedDash } from "@/lib/copy-guard";
import { normalizePhrase } from "./phrase-quality";
import { isLocked, loadOffer, type StoredOffer } from "./offers";
import {
  approveDocument,
  currentDocument,
  documentFingerprint,
  shortId,
  storeDocument,
  type AudienceDocument,
  type DocumentFault,
} from "./audience-documents";

/**
 * A letter COMMAND, not any line that starts with the word. "letter looks good to me" is a person
 * talking, and it has to reach the assistant rather than be refused as a malformed command.
 */
const LETTER_PREFIX = /^\s*letter\s+(use|draft|text|approve|replace)\b/i;

export type LetterCommand =
  | { kind: "none" }
  | { kind: "use"; url: string | null }
  | { kind: "draft" }
  | { kind: "text" }
  | { kind: "replace"; body: string }
  | { kind: "approve"; id: string | null }
  | { kind: "refused"; message: string };

/**
 * Read one message as one letter command, by its FIRST line.
 *
 * ‼️ `letter replace:` CARRIES A DOCUMENT, SO IT NEVER GETS THE SECOND-LINE CHECK. A letter is full of lines
 * that start "Price:", "Offer:" or "Terms:", and refusing it as a combined command would make the one
 * command that exists to take a document unable to take one. Every other letter command is one line, and a
 * second line refuses it.
 */
export function readLetterCommand(text: string): LetterCommand {
  const raw = text.replace(/^\s+/, "");
  const firstBreak = raw.search(/\r?\n/);
  const first = (firstBreak < 0 ? raw : raw.slice(0, firstBreak)).trim();
  if (!LETTER_PREFIX.test(first)) return { kind: "none" };

  const replace = /^letter\s+replace\s*:\s*/i.exec(first);
  if (replace) {
    const body = stripWrappingFence((first.slice(replace[0].length) + (firstBreak < 0 ? "" : raw.slice(firstBreak))).trim());
    if (body.length < 200) {
      return { kind: "refused", message: ":warning: Nothing saved. `letter replace:` needs the whole letter after it, and that was too short to be one." };
    }
    return { kind: "replace", body };
  }

  const rest = firstBreak < 0 ? "" : raw.slice(firstBreak).trim();
  if (rest) {
    return {
      kind: "refused",
      message: ":warning: Nothing done. This thread takes one command per message, and a letter command is one line. Only `letter replace:` carries a letter under it.",
    };
  }

  const m = /^letter\s+(use|draft|text|approve)\b\s*(.*)$/i.exec(first);
  if (!m) {
    // `letter replace` without its colon. The prefix matched a verb, so this is somebody addressing the
    // machine, and a silent fall-through to the assistant would lose the letter they meant to store.
    return { kind: "refused", message: ":warning: Nothing saved. It is `letter replace:` with a colon, then the letter under it." };
  }
  const verb = m[1].toLowerCase();
  const arg = m[2].trim();
  if (verb === "use") return { kind: "use", url: arg ? slackUrl(arg) : null };
  if (verb === "approve") return { kind: "approve", id: arg ? arg.replace(/[^0-9a-f]/gi, "").slice(0, 8) || null : null };
  if (arg) return { kind: "refused", message: `:warning: \`letter ${verb}\` takes nothing after it.` };
  return { kind: verb as "draft" | "text" };
}

/** A fence around the whole message is Slack formatting, not part of the letter. */
function stripWrappingFence(text: string): string {
  const m = /^```[a-z]*\n?([\s\S]*?)\n?```$/i.exec(text.trim());
  return m ? m[1].trim() : text;
}

/** Slack sends a URL as <https://x|label> or <https://x>. The URL is the value, never the label. */
export function slackUrl(raw: string): string {
  const s = raw.trim();
  const m = /^<([^|>]+)(?:\|[^>]*)?>$/.exec(s);
  return (m ? m[1] : s).replace(/&amp;/g, "&");
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading a page into a letter
// ─────────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", hellip: "...",
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', copy: "(c)", reg: "(R)", trade: "(TM)",
};

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    // ‼️ THE HOUSE RULE HOLDS FOR TEXT WE STORE, even when it is the client's own page.
    .replace(/[—–―]/g, "-");
}

/**
 * A page as a letter: headings kept as `##`, paragraphs and list items on their own lines.
 *
 * ‼️ THE STRUCTURE IS THE POINT. The framework chat is asked to analyse a sales letter, and the site crawls
 * this repo already stores collapse every page to one line of text, which is a paragraph soup no copywriter
 * could comment on. Navigation, headers, footers, scripts and forms are removed first.
 */
export function pageToLetterText(html: string): string {
  const body = html
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, _l, inner) => `\n\n## ${inner.replace(/<[^>]+>/g, " ")}\n\n`)
    // An item opens its own line; closing one adds nothing, or a list comes out double spaced.
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/(p|div|section|article|ul|ol|h[4-6]|blockquote|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return decode(body)
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, all) => l !== "" || (all[i - 1] ?? "") !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 40_000);
}

async function fetchLetterPage(url: string): Promise<{ ok: true; text: string; finalUrl: string } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: `"${url}" is not a web address.` };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "only http and https pages can be read." };
  }
  const { assertPublicHost } = await import("@/lib/scan/public-host");
  if (!(await assertPublicHost(parsed.hostname))) {
    return { ok: false, error: `${parsed.hostname} does not resolve to a public address.` };
  }
  const { fetchPage } = await import("@/lib/medspa-owner-scrape");
  const res = await fetchPage(parsed.toString(), { timeoutMs: 15_000, retries: 1 });
  if (!res.ok) return { ok: false, error: `the page could not be read (${res.reason}${res.status ? `, ${res.status}` : ""}).` };
  const text = pageToLetterText(res.html);
  if (text.length < 800) {
    return { ok: false, error: `that page has only ${text.length} characters of text, which is not a sales letter.` };
  }
  return { ok: true, text, finalUrl: res.finalUrl };
}

/**
 * The page on the client's own site that plainly sells this offer, if one does.
 *
 * Read off the CLIENT_WEBSITE evidence already filed (the audit crawl, the replica crawl). Chosen by how often
 * it names the treatment and the customers' terms, and only proposed when that is unambiguous: a homepage
 * that mentions the offer once is not its sales page.
 */
async function siteSalesPage(clientId: string, offer: StoredOffer): Promise<{ url: string; mentions: number } | null> {
  const { data } = await supabaseAdmin
    .from("page_sources")
    .select("source_url, source_content")
    .eq("client_id", clientId)
    .eq("source_type", "CLIENT_WEBSITE")
    .not("source_url", "is", null);

  const needles = [offer.treatment, ...offer.terms]
    .map((n) => normalizePhrase(n ?? ""))
    .filter((n) => n.length >= 3);
  if (!needles.length) return null;

  const scored = ((data ?? []) as Array<{ source_url: string; source_content: string | null }>)
    .map((r) => {
      const body = normalizePhrase(r.source_content ?? "");
      const mentions = needles.reduce((sum, n) => sum + (body.split(n).length - 1), 0);
      return { url: r.source_url, mentions };
    })
    .filter((r) => r.mentions >= 3)
    .sort((a, b) => b.mentions - a.mentions);

  if (!scored.length) return null;
  // Two pages that name it about as often is not "plainly the sales page". Ask for the URL instead.
  if (scored[1] && scored[1].mentions * 1.5 > scored[0].mentions) return null;
  return scored[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Faults
// ─────────────────────────────────────────────────────────────────────────────

/** Everything a figure or a quotation in a letter may be drawn from. */
export interface LetterEvidence {
  /** Approved numbers, the client's review text, the intake answers. */
  numberHaystack: string;
  /** Real quotations: the client's own reviews and the shared voice-of-customer quotes. */
  quotes: string[];
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * What is wrong with a letter, in words. Pure, so the probe can test it.
 *
 * ‼️ A QUOTATION MUST BE SOMEBODY'S REAL WORDS. Any passage in double quotes of 20 characters or more has to
 * appear in a real review or a research quote. The literal token [PROOF] is the honest placeholder where no
 * real proof exists yet, and it is always allowed.
 */
export async function letterFaults(letter: string, evidence: LetterEvidence): Promise<DocumentFault[]> {
  const { promiseFault, unbackedNumbers } = await import("./client-headlines");
  const faults: DocumentFault[] = [];

  if (hasBannedDash(letter)) faults.push({ rule: "dash", detail: "an em dash, an en dash or a double hyphen" });

  const promise = letter
    .split(/\n+/)
    .map((line) => ({ line, why: promiseFault(line) }))
    .find((x) => x.why);
  if (promise) faults.push({ rule: "guarantee", detail: `"${promise.line.trim().slice(0, 120)}" is ${promise.why}` });

  const figures = unbackedNumbers(letter.replace(/\[PROOF\]/g, ""), evidence.numberHaystack);
  if (figures.length) {
    faults.push({ rule: "unbacked_number", detail: `figures nothing on file supports: ${figures.slice(0, 8).join(", ")}` });
  }

  const corpus = evidence.quotes.map(squash).join(" | ");
  const quoted = [...letter.matchAll(/["“]([^"”\n]{20,400})["”]/g)].map((m) => m[1]);
  const invented = quoted.filter((q) => !corpus.includes(squash(q)));
  if (invented.length) {
    faults.push({
      rule: "invented_quote",
      detail: `quotations that are not in any real review or research quote: ${invented
        .slice(0, 3)
        .map((q) => `"${q.slice(0, 80)}"`)
        .join("; ")}`,
    });
  }
  return faults;
}

// ─────────────────────────────────────────────────────────────────────────────
// Drafting
// ─────────────────────────────────────────────────────────────────────────────

const LETTER_MODEL = "claude-sonnet-4-6" as const;

/**
 * The long-form letter's shape. Its own, because src/data/reel/sales-letter-swipe.ts is a 150 to 220 word
 * caption format and this is the document a copywriter analyses before any research is run.
 */
const LETTER_SHAPE = [
  "HEADLINE: one line, written to this exact buyer.",
  "SUBHEADLINE: one or two lines that make the headline specific.",
  "LEAD: open with the buyer's situation in their own words. Pick one lead type: a confession, a discovery, a proclamation, an underdog, or a multiplier.",
  "THE PROBLEM: what they are stuck with, and why what they already tried did not work.",
  "THE STORY: a short story that moves the reader toward believing this offer can work for them. It is either a real case the business told us or a real review, or it is framed as an example (\"Picture a ...\") and names nobody. Never present an example as a real customer.",
  "THE MECHANISM: why this offer works where the rest did not, in plain words, only as far as the facts below support.",
  "THE OFFER: what they get, exactly as the business describes it.",
  "PROOF: real reviews quoted word for word, or the literal token [PROOF] where there is none yet.",
  "OBJECTIONS: answer the objections the business told us their buyers raise.",
  "CALL TO ACTION: the one next step.",
  "P.S.: one line that restates the core promise without a guarantee.",
];

const LETTER_RULES = [
  "This is an internal working document, not something that gets published. It is still written as the real letter.",
  "Only what you are given. No invented facts about the business: no prices, years, credentials, staff, awards, results or timeframes that are not in the facts below.",
  "No number that is not in the approved numbers, a review or the intake answers. Where specificity would help and no real number exists, be specific in words instead.",
  "No guarantee of any kind, and no 'risk free' or 'money back' unless the facts say the business offers one.",
  "No invented testimonial, review, quote, customer, credential or discovery story. Quote only reviews given below, word for word. Where proof is missing, write the literal token [PROOF].",
  "No competitor named.",
  "No em dashes, no en dashes, no double hyphens. Use commas, periods or colons.",
  "Use ## for each section heading, in the order given. Plain text otherwise.",
];

async function draftLetterText(clientId: string, offer: StoredOffer): Promise<
  { ok: true; text: string; evidence: LetterEvidence } | { ok: false; error: string }
> {
  const { buildContext } = await import("./artifacts/deep-research-run");
  const built = await buildContext(clientId);
  if (!built.ok) return { ok: false, error: built.error };
  const ctx = built.ctx;

  const { clientVocQuotes } = await import("./client-headlines");
  const { audienceFor, sharedBankFor } = await import("./audiences");
  const aud = await audienceFor(clientId);
  const [quotes, bank] = await Promise.all([
    clientVocQuotes(clientId),
    aud.ok ? sharedBankFor(aud.audience) : Promise.resolve({ vocQuotes: [], approvedNumbers: [] }),
  ]);
  const approved = bank.approvedNumbers.map((n) => n.value);
  const vocab = aud.ok ? aud.audience.vocabulary : null;

  const intake = [ctx.objections, ctx.targetPatient, ctx.notWanted, ctx.triedBefore, ...ctx.services]
    .filter(Boolean)
    .join(" ");
  const evidence: LetterEvidence = {
    numberHaystack: [...approved, ...quotes.map((q) => q.text), intake, offer.price ?? ""].join(" "),
    quotes: quotes.map((q) => q.text),
  };

  const { loadDrHeadlineEngine } = await import("@/data/reel/dr-headline-engine");
  const system = [
    `You are a direct-response copywriter writing a long-form sales letter for ${ctx.clinicName}.`,
    "",
    "RULES, checked in code after you write:",
    ...LETTER_RULES.map((r) => `- ${r}`),
    "",
    "THE LETTER, IN THIS ORDER:",
    ...LETTER_SHAPE.map((s) => `- ${s}`),
    "",
    "HEADLINE CRAFT. Use the engine below for the headline and subheadline only. ‼️ Two of its laws are",
    "overridden here: law 4's unusual numbers and law 7's timeframes are allowed ONLY when that exact",
    "figure is in the facts below. Otherwise be specific without a number.",
    "",
    loadDrHeadlineEngine(),
  ].join("\n");

  const user = [
    `Business: ${ctx.clinicName}${ctx.city ? `, ${ctx.city}${ctx.state ? `, ${ctx.state}` : ""}` : ""}.`,
    `What they sell (locked on the prep call): ${offer.treatment}.`,
    offer.positioning ? `How they want to be known for it: ${offer.positioning}.` : "",
    offer.terms.length ? `What their customers call it: ${offer.terms.join(", ")}.` : "",
    offer.outcomePromise ? `The outcome promised: ${offer.outcomePromise}.` : "",
    offer.price ? `The price, as they state it: ${offer.price}.` : "",
    `Written to: ${ctx.avatarLabel}${vocab ? `, called ${vocab.buyerPlural}` : ""}.`,
    ctx.targetPatient ? `Who they want more of, in their words: ${ctx.targetPatient}.` : "",
    ctx.notWanted ? `Who they do not want: ${ctx.notWanted}.` : "",
    ctx.objections ? `The objections their buyers raise, in their words: ${ctx.objections}.` : "",
    ctx.triedBefore ? `What buyers tried before: ${ctx.triedBefore}.` : "",
    ctx.services.length ? `Everything they offer: ${ctx.services.join(", ")}.` : "",
    "",
    approved.length ? `APPROVED NUMBERS (the only figures you may state): ${approved.join("; ")}` : "APPROVED NUMBERS: none. State no statistics.",
    "",
    quotes.length
      ? `REAL REVIEWS AND CUSTOMER QUOTES (quote only these, word for word):\n${quotes.map((q) => `- "${q.text}"`).join("\n")}`
      : "REAL REVIEWS: none on file. Use [PROOF] wherever proof would go.",
  ]
    .filter(Boolean)
    .join("\n");

  const { callClaudeText } = await import("@/lib/claude-calls");
  try {
    // ‼️ ONE CALL, NO CORRECTION RETRY. A long letter plus retries runs into the 8,000 token cap and the
    // 300s route. The faults are stored beside the draft instead, and approval refuses while they remain.
    const res = await callClaudeText({ model: LETTER_MODEL, system, user, maxTokens: 6000, temperature: 0.6, timeoutMs: 200_000 });
    const text = decode(res.text).trim();
    if (text.length < 800) return { ok: false, error: "the draft came back too short to be a letter." };
    return { ok: true, text, evidence };
  } catch (e) {
    return { ok: false, error: `the drafting call failed: ${(e as Error).message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The thread
// ─────────────────────────────────────────────────────────────────────────────

export interface LetterReply {
  message: string;
  /** Work that runs after the reply is posted (the draft's model call), the `run` command's shape. */
  after?: () => Promise<void>;
}

async function letterTarget(clientId: string): Promise<
  { ok: true; offer: StoredOffer; audienceId: string; offerId: string } | { ok: false; message: string }
> {
  const offer = await loadOffer(clientId);
  if (!isLocked(offer)) {
    return { ok: false, message: ":warning: Lock the offer first (`offer: <what they sell>`). A sales letter is written for one offer." };
  }
  if (!offer.id || !offer.audienceId) {
    return {
      ok: false,
      message: ":warning: The offer is not stored under an audience yet (docs/2026-09-15-offers-and-framework.sql has not been run), so a letter has nowhere to live.",
    };
  }
  return { ok: true, offer, audienceId: offer.audienceId, offerId: offer.id };
}

async function fileCopy(clientId: string, doc: AudienceDocument): Promise<void> {
  const { storeGeneratedDoc } = await import("./onboarding-docs");
  await storeGeneratedDoc({
    clientId,
    stepKey: "offer_locked",
    filename: `sales-letter-${shortId(doc.id)}.md`,
    buffer: Buffer.from(doc.content, "utf8"),
    contentType: "text/markdown",
  }).catch((e) => console.error("[sales-letter] file copy not stored:", (e as Error).message));
}

function describe(doc: AudienceDocument): string {
  const from =
    doc.source === "client_site" ? `their own page (${doc.sourceUrl})` : doc.source === "drafted" ? "a draft we wrote" : "a letter pasted here";
  return `version \`${shortId(doc.id)}\`, ${from}, ${doc.content.length.toLocaleString("en-US")} characters`;
}

function faultLines(doc: AudienceDocument): string[] {
  if (!doc.faults.length) return [];
  const blocking = doc.source === "drafted";
  return [
    blocking
      ? `:no_entry: *${doc.faults.length} fault${doc.faults.length === 1 ? "" : "s"}, so this draft cannot be approved as it stands:*`
      : `:warning: *${doc.faults.length} thing${doc.faults.length === 1 ? "" : "s"} to know* (their words, so this does not stop approval):`,
    ...doc.faults.map((f) => `  • ${f.detail}`),
    blocking ? "Fix them with `letter replace:` and the corrected letter." : "",
  ].filter(Boolean);
}

async function store(args: {
  clientId: string;
  target: { audienceId: string; offerId: string; offer: StoredOffer };
  content: string;
  source: "client_site" | "drafted" | "pasted";
  sourceUrl?: string | null;
  evidence?: LetterEvidence;
  by: string;
}): Promise<{ ok: true; doc: AudienceDocument } | { ok: false; error: string }> {
  const evidence = args.evidence ?? (await evidenceFor(args.clientId, args.target.offer));
  const faults = await letterFaults(args.content, evidence);
  const saved = await storeDocument({
    clientId: args.clientId,
    audienceId: args.target.audienceId,
    offerId: args.target.offerId,
    kind: "sales_letter",
    content: args.content,
    faults,
    source: args.source,
    sourceUrl: args.sourceUrl ?? null,
    by: args.by,
  });
  if (saved.ok) await fileCopy(args.clientId, saved.doc);
  return saved;
}

async function evidenceFor(clientId: string, offer: StoredOffer): Promise<LetterEvidence> {
  const { clientVocQuotes } = await import("./client-headlines");
  const { audienceFor, sharedBankFor } = await import("./audiences");
  const aud = await audienceFor(clientId);
  const [quotes, bank] = await Promise.all([
    clientVocQuotes(clientId),
    aud.ok ? sharedBankFor(aud.audience) : Promise.resolve({ vocQuotes: [], approvedNumbers: [] }),
  ]);
  const { data: client } = await supabaseAdmin.from("clients").select("services, ideal_patient").eq("id", clientId).maybeSingle();
  return {
    numberHaystack: [
      ...bank.approvedNumbers.map((n) => n.value),
      ...quotes.map((q) => q.text),
      JSON.stringify(client?.services ?? {}),
      JSON.stringify(client?.ideal_patient ?? {}),
      offer.price ?? "",
    ].join(" "),
    quotes: quotes.map((q) => q.text),
  };
}

/** Is there an approved letter for the offer as it stands now? For step 11's handover and the card. */
export async function approvedLetterFor(clientId: string): Promise<
  | { ok: true; doc: AudienceDocument }
  | { ok: false; reason: "no_offer" | "none" | "not_approved" | "stale" | "unreadable"; message: string }
> {
  const offer = await loadOffer(clientId);
  if (!offer.id || !offer.audienceId) {
    // ‼️ A TREATMENT WITH NO ROW ID IS THE LEGACY FALLBACK: the offer exists, the client_offers table does not.
    // "no offer yet" would send somebody to lock an offer that is already locked.
    return offer.treatment
      ? { ok: false, reason: "unreadable", message: "the offers table is not in the database yet (docs/2026-09-15-offers-and-framework.sql has not run)" }
      : { ok: false, reason: "no_offer", message: "no offer is stored under an audience yet" };
  }
  const cur = await currentDocument({ audienceId: offer.audienceId, offerId: offer.id, kind: "sales_letter" });
  if (!cur.ok) return { ok: false, reason: "unreadable", message: cur.error };
  if (!cur.doc) return { ok: false, reason: "none", message: "there is no sales letter yet" };
  if (cur.doc.status !== "approved") return { ok: false, reason: "not_approved", message: `the sales letter (${shortId(cur.doc.id)}) is not approved yet` };
  if (cur.doc.offerFingerprint !== documentFingerprint(offer)) {
    return { ok: false, reason: "stale", message: "the sales letter was approved for a different treatment or outcome, so it needs approving again" };
  }
  return { ok: true, doc: cur.doc };
}

/** One line for the prep call's card. */
export async function letterStatusLine(clientId: string): Promise<string> {
  const approved = await approvedLetterFor(clientId);
  if (approved.ok) return `:page_facing_up: Sales letter approved: ${describe(approved.doc)}.`;
  // An offer read from the old column (the migration has not run) is "unreadable", not "no_offer", so
  // this line never tells somebody to lock an offer that is already locked.
  if (approved.reason === "no_offer") return ":page_facing_up: Sales letter: lock the offer first.";
  return `:page_facing_up: Sales letter: ${approved.message}. Step 11's script waits for an approved one.`;
}

export async function handleLetterThreadReply(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<LetterReply | null> {
  if (input.stepKey !== "offer_locked") return null;
  const cmd = readLetterCommand(input.text);
  if (cmd.kind === "none") return null;
  if (cmd.kind === "refused") return { message: cmd.message };

  const target = await letterTarget(input.clientId);
  if (!target.ok) return { message: target.message };

  switch (cmd.kind) {
    case "use": {
      let url = cmd.url;
      if (!url) {
        const found = await siteSalesPage(input.clientId, target.offer);
        if (!found) {
          return {
            message:
              ":mag: No page on their site plainly sells this offer. `letter use <url>` takes a page you point at, or `letter draft` writes one.",
          };
        }
        url = found.url;
      }
      const page = await fetchLetterPage(url);
      if (!page.ok) return { message: `:warning: Nothing saved: ${page.error}` };
      const saved = await store({ clientId: input.clientId, target, content: page.text, source: "client_site", sourceUrl: page.finalUrl, by: input.by });
      if (!saved.ok) return { message: `:warning: Not saved: ${saved.error}` };
      return {
        message: [
          `:white_check_mark: Took their page as the sales letter: ${describe(saved.doc)}.`,
          ...faultLines(saved.doc),
          `Read it with \`letter text\`, then \`letter approve ${shortId(saved.doc.id)}\`.`,
        ].join("\n"),
      };
    }

    case "draft": {
      return {
        message: ":writing_hand: Drafting the sales letter. One model call, about a minute. It lands in this thread as a file with anything I could not back listed beside it.",
        after: async () => {
          const { notifyStep } = await import("./step-board");
          const drafted = await draftLetterText(input.clientId, target.offer);
          if (!drafted.ok) {
            await notifyStep(input.clientId, "offer_locked", `:warning: The letter was not drafted: ${drafted.error}`).catch(() => {});
            return;
          }
          const saved = await store({
            clientId: input.clientId,
            target,
            content: drafted.text,
            source: "drafted",
            evidence: drafted.evidence,
            by: input.by,
          });
          if (!saved.ok) {
            await notifyStep(input.clientId, "offer_locked", `:warning: The draft was written but not saved: ${saved.error}`).catch(() => {});
            return;
          }
          await uploadLetter(input.clientId, saved.doc);
          await notifyStep(
            input.clientId,
            "offer_locked",
            [
              `:white_check_mark: Drafted: ${describe(saved.doc)}.`,
              ...faultLines(saved.doc),
              saved.doc.faults.length ? "" : `\`letter approve ${shortId(saved.doc.id)}\` when it reads right, or \`letter replace:\` with your edit.`,
            ]
              .filter(Boolean)
              .join("\n")
          ).catch(() => {});
        },
      };
    }

    case "text": {
      const cur = await currentDocument({ audienceId: target.audienceId, offerId: target.offerId, kind: "sales_letter" });
      if (!cur.ok) return { message: `:warning: ${cur.error}` };
      if (!cur.doc) return { message: ":page_facing_up: No sales letter yet. `letter use`, `letter use <url>` or `letter draft`." };
      const uploaded = await uploadLetter(input.clientId, cur.doc);
      return {
        message: [
          `${uploaded ? ":page_facing_up: Uploaded above" : ":warning: The file could not be uploaded"}: ${describe(cur.doc)}, ${cur.doc.status}.`,
          ...faultLines(cur.doc),
          cur.doc.status === "approved" ? "" : `\`letter approve ${shortId(cur.doc.id)}\` approves exactly this version.`,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    case "replace": {
      const saved = await store({ clientId: input.clientId, target, content: cmd.body, source: "pasted", by: input.by });
      if (!saved.ok) return { message: `:warning: Not saved: ${saved.error}` };
      return {
        message: [
          `:white_check_mark: Replaced. Now ${describe(saved.doc)}. The previous version is kept.`,
          ...faultLines(saved.doc),
          `\`letter approve ${shortId(saved.doc.id)}\` approves this one.`,
        ].join("\n"),
      };
    }

    case "approve": {
      const cur = await currentDocument({ audienceId: target.audienceId, offerId: target.offerId, kind: "sales_letter" });
      if (!cur.ok) return { message: `:warning: ${cur.error}` };
      const doc = cur.doc;
      if (!doc) return { message: ":warning: There is no sales letter to approve yet." };
      if (cmd.id && !doc.id.startsWith(cmd.id.toLowerCase())) {
        return {
          message: `:warning: Not approved. The current letter is \`${shortId(doc.id)}\`, not \`${cmd.id}\`: it was replaced after the version you meant. \`letter text\` shows it.`,
        };
      }
      if (doc.source === "drafted" && doc.faults.length) {
        return { message: [":no_entry: Not approved.", ...faultLines(doc)].join("\n") };
      }
      const fingerprint = documentFingerprint(target.offer);
      if (doc.status === "approved" && doc.offerFingerprint === fingerprint) {
        return { message: `:white_check_mark: ${describe(doc)} is already approved for this offer.` };
      }
      const res = await approveDocument({ id: doc.id, by: input.by, fingerprint });
      if (!res.ok) return { message: `:warning: Not approved: ${res.error}` };
      return {
        message: [
          `:white_check_mark: Sales letter approved: ${describe(doc)}, by ${input.by}.`,
          "It is message 1 of step 11's framework script, for this treatment and outcome. A new treatment or outcome asks for it to be approved again.",
        ].join("\n"),
        // ‼️ STEP 11 USUALLY RAN ALREADY. Its runner fires when the prep call is marked done, typically
        // before any letter exists, and it posted a waiting note. Nothing else would ever post the script,
        // so approving does, when that step has run. No model call.
        after: async () => {
          const { data } = await supabaseAdmin
            .from("client_delivery_steps")
            .select("status")
            .eq("client_id", input.clientId)
            .eq("step_key", "avatar_harvest")
            .maybeSingle();
          const status = (data as { status?: string } | null)?.status;
          if (!status || status === "pending" || status === "blocked") return;
          const { postFrameworkScript } = await import("./framework-thread");
          const res = await postFrameworkScript(input.clientId);
          if (!res.ok) console.error("[sales-letter] framework script not posted after approval:", res.error);
        },
      };
    }
  }
}

async function uploadLetter(clientId: string, doc: AudienceDocument): Promise<boolean> {
  const { channelFor, anchorTsFor } = await import("./step-board");
  const { slack } = await import("@/lib/slack-bot");
  const channel = await channelFor(clientId);
  const thread = channel ? await anchorTsFor(clientId, "offer_locked") : null;
  if (!channel || !thread) return false;
  await slack.joinChannel(channel).catch(() => {});
  const res = (await slack.uploadFile(
    channel,
    `sales-letter-${shortId(doc.id)}.md`,
    Buffer.from(doc.content, "utf8"),
    "text/markdown",
    thread
  )) as { ok?: boolean };
  return res?.ok === true;
}
