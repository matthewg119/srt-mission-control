// Direct-response headlines for ONE client, in AEO query shape. The H1 of every page.
//
// ‼️ THIS IS THE CLIENT-SCOPED SIBLING OF `generateDirectResponseHeadlines`, NOT A REPLACEMENT.
// That function is keyed on a `verticals` row and writes 12-45 word advertorial headlines for
// the drop channels and #content-full. Both lanes are live and both must stay. What differs
// here: the subject is a client (their offer, their city, their avatar), and the output is a
// question a buyer would type, because it becomes a page H1 that an engine has to match to her
// wording before it will cite us.
//
// ‼️ THE VALIDATORS ARE NOT OPTIONAL AND THEY ARE NOT PROSE. Precedent is `isDrafted` in
// draft-page.ts and `noDashes` in the email lane: a rule stated only in a prompt is not a rule,
// and the model emits the banned thing anyway. The one that matters most is `unbackedNumbers`,
// because specificity is a LAW here (law 3) and a model told to be specific reaches for a figure
// on almost every line. A rejected batch goes into callClaudeJSON's correction retry with the
// reason quoted back, exactly as the dash rule does.
//
// ‼️ BACKED, NOT BANNED (2026-09-13). Results, numbers and timeframes are all legal when a source
// says so. See PROMISE_SHAPES for what that changed and why.

import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import { stripEmDashes } from "@/lib/reel/text";
import { vocBlock } from "@/lib/reel/voc-quotes";
import { loadAeoHeadlineEngine } from "@/data/reel/aeo-headline-engine";
import { approvedNumbersBlock, repeatedOpenings } from "@/lib/reel/creative-director";
import type { VocQuote } from "@/config/verticals";

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

/** How many a weekly run writes. Matthew: "20 direct response headlines per week". */
export const WEEKLY_HEADLINES = 20;

/**
 * The most quotes worth putting in one prompt.
 *
 * Twenty is already more heat than a model can use in one pass and the bank grows forever,
 * so an uncapped block would quietly push the engine's own rules out of the context window
 * as a client accumulates evidence.
 */
const MAX_QUOTES = 24;

// ─────────────────────────────────────────────────────────────────────────────
// Rule 2, in code
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shapes that are illegal whatever the evidence says.
 *
 * ‼️ THIS LIST SHRANK ON 2026-09-13 AND THE REASON MATTERS. It used to ban numeric results,
 * multipliers and timeframes tied to results outright. Matthew: "you can also remove rule #2
 * with no timeframes tied to results (if the deep research can back the data we can talk about
 * results)". So the test moved from "does this claim a result" to "is this claim BACKED", which
 * is `unbackedNumbers` below. A result claim with a source behind it is now a good headline.
 *
 * What is left is the two things no source can ever back:
 *  - A GUARANTEE. Nothing on file can promise what will happen to HER business, and the page it
 *    opens cannot source it either. The gate would block the body that had to support it.
 *  - THE AD VOICE, caught by `isQueryShaped` rather than here: a headline written AT her instead
 *    of asked BY her does not match what she types, which is the entire point of the lane.
 */
const PROMISE_SHAPES: ReadonlyArray<{ re: RegExp; why: string }> = [
  { re: /\bguarantee(?:d|s|ing)?\b|\bor your money back\b|\brisk[- ]free\b/i, why: "a guarantee" },
];

/** Why this headline is illegal regardless of evidence, or null when it is clean. */
export function promiseFault(headline: string): string | null {
  for (const { re, why } of PROMISE_SHAPES) if (re.test(headline)) return why;
  return null;
}

/**
 * Figures in a headline that nothing on file supports.
 *
 * ‼️ THIS IS THE RULE THAT REPLACED THE PROMISE BAN, AND IT IS THE ONE WITH A LIVE FAILURE
 * BEHIND IT. The ad lane's first run returned "In 2024, 45 Percent of Local Searches Start With
 * an AI Prompt" (the real BrightLocal figure is 45% of consumers USING AI for local
 * recommendations, a different claim about a different thing) plus "within 90 days" and "a full
 * month of chair time every year". Specificity is a law here, so the model reaches for a number
 * on almost every line; handing it the real ones and rejecting the rest is the only fix that
 * does not also cost the specificity.
 *
 * Same shape as `numbersNotIn` in page-plan.ts, which does this for the framing call. Kept
 * separate rather than imported because the haystacks differ: that one allows any number in the
 * keywords, this one allows only the approved list plus the quotes she actually wrote.
 *
 * A bare year ("in 2023 I opened") and a small count ("my 2 med spas") are not statistics, so
 * anything under two digits and any 19xx/20xx is left alone.
 */
export function unbackedNumbers(headline: string, haystack: string): string[] {
  const hay = haystack.replace(/[,$]/g, "");
  const out: string[] = [];
  for (const m of headline.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    const bare = m[0].replace(/[,$%]/g, "");
    if (bare.length < 2) continue;
    if (/^(?:19|20)\d{2}$/.test(bare)) continue;
    if (!hay.includes(bare)) out.push(m[0]);
  }
  return [...new Set(out)];
}

/**
 * An em dash, en dash or double hyphen. Same house rule the drafter and the framer enforce,
 * restated here rather than imported so this file stands alone in the probe.
 */
function hasBannedDash(text: string): boolean {
  return /[—–]|--/.test(text);
}

/** Roughly "does this read like something a person would type into a search box?" */
export function isQueryShaped(headline: string): boolean {
  const t = headline.trim();
  if (!t) return false;
  // A question is always query-shaped. A statement is allowed only as a first-person
  // confession, which is rule 1's one non-question door ("My med spa is invisible in ChatGPT.").
  if (t.endsWith("?")) return true;
  return /^(?:i|i'm|im|my|we|our|am i|does anyone|is anyone|nobody|no one)\b/i.test(t);
}

export interface HeadlineFault {
  headline: string;
  why: string;
}

/**
 * Everything wrong with a batch, in words. Exported for the probe and for the correction retry.
 *
 * Rule 5 (no shape repeated more than twice) REJECTS here, unlike `repeatedOpenings`'s own
 * warn-only contract in the reel lane. The difference is what the output is for: twenty ad
 * headlines are a menu a person picks one from, so three lookalikes cost nothing, while these
 * become nine page H1s that all have to be different searches.
 */
export function headlineFaults(
  headlines: readonly string[],
  count: number,
  /**
   * Everything a figure may be drawn from: the approved numbers and the customer quotes. Pass ""
   * to allow NO figure at all, which is what an avatar with an empty approved list means.
   * Omit it only in a test that is asserting some other rule.
   */
  numberHaystack = ""
): HeadlineFault[] {
  const out: HeadlineFault[] = [];
  if (headlines.length !== count) {
    out.push({ headline: "", why: `expected ${count} headlines and got ${headlines.length}` });
  }
  for (const h of headlines) {
    const promise = promiseFault(h);
    if (promise) out.push({ headline: h, why: `${promise}, which nothing on file can back` });
    else if (hasBannedDash(h)) out.push({ headline: h, why: "an em dash, en dash or double hyphen" });
    else if (!isQueryShaped(h)) {
      out.push({
        headline: h,
        why: "not query shaped: it is neither a question nor a first-person confession",
      });
    } else {
      const bad = unbackedNumbers(h, numberHaystack);
      if (bad.length) {
        out.push({
          headline: h,
          why:
            `the figure${bad.length === 1 ? "" : "s"} ${bad.join(", ")}, which nothing you were ` +
            "given says. Use only the approved numbers and the amounts in the quotes, or drop the figure",
        });
      }
    }
  }
  for (const opening of repeatedOpenings([...headlines])) {
    out.push({ headline: "", why: `"${opening}" opens more than two headlines, which rule 5 forbids` });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// What the headlines are written from
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The pain bank for this client's avatar.
 *
 * The client's own customer reviews come FIRST because they are this business's actual
 * customers, then the avatar's shared bank fills the rest. A client with no reviews on file
 * still gets the vertical's Reddit confessions; a client with plenty leads with their own.
 *
 * ‼️ NEVER ANOTHER CLIENT'S QUOTES. Same rule `vocBlock` and `salesLetterExamplesFor` already
 * enforce one lane over: "Pest control owners and med spa owners are not interchangeable
 * sources of pain." The shared bank is keyed on the AVATAR, which is the thing two clients can
 * legitimately have in common; `page_sources` is keyed on the client and never crosses.
 */
export async function clientVocQuotes(clientId: string): Promise<VocQuote[]> {
  const own: VocQuote[] = [];
  const { data } = await supabaseAdmin
    .from("page_sources")
    .select("content, label")
    .eq("client_id", clientId)
    .eq("source_type", "CUSTOMER_REVIEW")
    .order("created_at", { ascending: false })
    .limit(MAX_QUOTES);

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const text = String(row.content ?? "").trim();
    if (text) own.push({ text, source: String(row.label ?? "their own customer") });
  }

  if (own.length >= MAX_QUOTES) return own.slice(0, MAX_QUOTES);

  const { verticalFor } = await import("./harvest");
  const v = await verticalFor(clientId);
  if (!v.ok) return own;

  // ‼️ RESOLVE, NEVER loadVertical(v.vertical) DIRECTLY. `verticalFor` returns a CLIENT slug
  // (`aeo-agency-med-spa`); `loadVertical` wants an avatar id (`medspa_owner_ai`) and silently
  // returns PEST CONTROL for anything else. That is how this client read 0 quotes on 2026-09-13
  // while 20 sat in the row next to it. An unmapped vertical gets the client's own reviews and
  // nothing else, which the prompt already reports out loud.
  const { clientAvatarVerticalId, loadVertical } = await import("@/config/verticals");
  const avatarId = clientAvatarVerticalId(v.vertical);
  if (!avatarId) return own;

  const vertical = await loadVertical(avatarId);
  const shared = (vertical.voc_quotes ?? []).filter((q) => q?.text?.trim());
  return [...own, ...shared].slice(0, MAX_QUOTES);
}

interface HeadlineContext {
  clientName: string;
  city: string | null;
  businessType: string | null;
  avatarLabel: string;
  treatment: string | null;
  positioning: string | null;
  framework: string | null;
  approvedNumbers: string[];
  quotes: VocQuote[];
}

/**
 * The client row, with `headline_framework` when the column exists and without it when it does
 * not.
 *
 * ‼️ TWO SELECTS ON PURPOSE, SAME REASON `planLinkRows` CATCHES. `headline_framework` arrives
 * with docs/2026-09-12-headline-framework.sql, and PostgREST fails a WHOLE select on one unknown
 * column. A single wide select would mean that until that migration runs, this lane does not
 * degrade to "no attached framework", it dies with "client not found" and says nothing true.
 */
async function loadClientRow(clientId: string): Promise<Record<string, unknown> | null> {
  const BASE = "legal_name, dba_name, city, business_type";
  const wide = await supabaseAdmin
    .from("clients")
    .select(`${BASE}, headline_framework`)
    .eq("id", clientId)
    .maybeSingle();
  if (!wide.error) return (wide.data as Record<string, unknown> | null) ?? null;

  console.error(
    `[client-headlines] headline_framework unavailable for ${clientId} (${wide.error.message}). ` +
      "If this names headline_framework, docs/2026-09-12-headline-framework.sql has not been run. " +
      "Generating from the AEO engine alone."
  );
  const base = await supabaseAdmin.from("clients").select(BASE).eq("id", clientId).maybeSingle();
  return (base.data as Record<string, unknown> | null) ?? null;
}

async function headlineContext(
  clientId: string
): Promise<{ ok: true; ctx: HeadlineContext } | { ok: false; error: string }> {
  const { loadOffer } = await import("./offers");
  const { confirmedAvatarFor } = await import("./avatars");

  const [client, offer, avatar, quotes] = await Promise.all([
    loadClientRow(clientId),
    loadOffer(clientId),
    confirmedAvatarFor(clientId),
    clientVocQuotes(clientId),
  ]);

  const row = client;
  if (!row) return { ok: false, error: "client not found" };
  if (!avatar) return { ok: false, error: "no confirmed avatar: headlines are written to one buyer, not to a market" };

  // The approved-number list is per avatar, and an absent one means NO figure is allowed,
  // which is exactly the rule this lane wants anyway.
  let approvedNumbers: string[] = [];
  const { verticalFor } = await import("./harvest");
  const v = await verticalFor(clientId);
  if (v.ok) {
    // Same two-namespace trap as clientVocQuotes above: the client slug must be resolved to an
    // avatar id first, or this reads pest control's list and an absent entry bans every figure.
    const { clientAvatarVerticalId, loadVertical } = await import("@/config/verticals");
    const avatarId = clientAvatarVerticalId(v.vertical);
    if (avatarId) approvedNumbers = (await loadVertical(avatarId)).approved_numbers ?? [];
  }

  return {
    ok: true,
    ctx: {
      clientName: ((row.dba_name as string | null) || (row.legal_name as string | null)) ?? "this business",
      city: (row.city as string | null) || null,
      businessType: (row.business_type as string | null) || null,
      avatarLabel: avatar.label,
      treatment: offer.treatment,
      positioning: offer.positioning,
      framework: ((row.headline_framework as string | null) ?? "").trim() || null,
      approvedNumbers,
      quotes,
    },
  };
}

/**
 * The prompt. Exported so the probe can assert what reaches the model without a network call.
 *
 * ‼️ THE ATTACHED FRAMEWORK GOES ABOVE THE ENGINE, NOT INSTEAD OF IT. Matthew attaches a
 * generator per client and per avatar, and it is the more specific document, so it wins on any
 * point the two disagree. But it is written for one avatar and says nothing about the parts
 * that never change (query shape, rule 2), so dropping the engine when a framework exists would
 * quietly drop the only rules the page gate depends on.
 */
export function headlinePrompt(ctx: HeadlineContext, count: number): string {
  const who = [ctx.businessType, ctx.city ? `in ${ctx.city}` : null].filter(Boolean).join(" ");
  const quotes = vocBlock({ voc_quotes: ctx.quotes });

  return [
    `You are an elite direct-response copywriter who specialises in AEO headlines for ${who || "a local business"}.`,
    `Write exactly ${count} AEO direct-response headlines for the buyer below.`,
    "",
    "THE BUSINESS AND THE BUYER:",
    `- The business: ${ctx.clientName}${who ? `, ${who}` : ""}`,
    `- The buyer, and every headline is addressed to her: ${ctx.avatarLabel}`,
    ctx.treatment ? `- What they sell, and what the pages are aimed at: ${ctx.treatment}` : "",
    ctx.positioning ? `- How they position it: ${ctx.positioning}` : "",
    "",
    quotes || "NO CUSTOMER QUOTES ARE ON FILE. Write from the buyer and the offer alone, and keep every headline in her plain spoken words rather than the industry's.",
    "",
    approvedNumbersBlock({ approved_numbers: ctx.approvedNumbers }),
    "",
    ctx.framework
      ? [
          "THE CLIENT'S OWN HEADLINE FRAMEWORK. This was written for this exact avatar, so where",
          "it is more specific than the engine below, it wins. It does not override the query",
          "shape or the ban on outcome promises, which apply to every page on every client.",
          "",
          ctx.framework,
          "",
        ].join("\n")
      : "",
    loadAeoHeadlineEngine(),
  ]
    .filter(Boolean)
    .join("\n");
}

interface HeadlinesResult {
  headlines: string[];
}

function isHeadlines(v: unknown, count: number, numberHaystack: string): v is HeadlinesResult {
  const d = v as HeadlinesResult;
  if (!d || !Array.isArray(d.headlines)) return false;
  if (!d.headlines.every((h) => typeof h === "string" && h.trim().length > 0)) return false;
  return headlineFaults(d.headlines.map((h) => h.trim()), count, numberHaystack).length === 0;
}

/**
 * Write `count` AEO direct-response headlines for one client.
 *
 * Returns an error rather than throwing, because every caller is a Slack lane or a cron
 * passenger where a thrown error is a silent nothing and a returned one becomes a line a
 * person can read in the thread.
 */
export async function generateClientHeadlines(args: {
  clientId: string;
  count?: number;
}): Promise<{ ok: true; headlines: string[]; usedFramework: boolean; quoteCount: number } | { ok: false; error: string }> {
  const count = args.count ?? WEEKLY_HEADLINES;
  const got = await headlineContext(args.clientId);
  if (!got.ok) return got;
  const ctx = got.ctx;

  // Everything a figure may be drawn from. The quotes count because the amounts in them are
  // real: "$150,000 through loans" and "$1500 last month on FB/IG ads" are hers, and a headline
  // built on one is the most credible kind there is.
  const numberHaystack = [...ctx.approvedNumbers, ...ctx.quotes.map((q) => q.text)].join(" ");

  try {
    const { data } = await callClaudeJSON<HeadlinesResult>({
      model: model(),
      system: headlinePrompt(ctx, count),
      user: `Return JSON with exactly ${count} AEO direct-response headlines, in English.`,
      // Twenty short questions is well under a thousand tokens, but the correction retry
      // re-sends the whole batch with its faults, so this has to leave room for that and stay
      // under MAX_RETRY_TOKENS (8000) in claude-calls.ts.
      maxTokens: 3000,
      temperature: 0.9,
      schemaHint: '{ "headlines": [string] }',
      validate: (v): v is HeadlinesResult => isHeadlines(v, count, numberHaystack),
      describeInvalid: (v) => {
        const p = v as HeadlinesResult;
        if (typeof v !== "object" || v === null) return "the response was not a JSON object";
        if (!Array.isArray(p.headlines)) return 'the "headlines" key was missing or was not an array';
        const bad = p.headlines.findIndex((h) => typeof h !== "string" || !h.trim());
        if (bad >= 0) return `headlines[${bad}] was not a non-empty string`;
        const faults = headlineFaults(p.headlines.map((h) => h.trim()), count, numberHaystack);
        return faults
          .slice(0, 6)
          .map((f) => (f.headline ? `"${f.headline}" has ${f.why}` : f.why))
          .join("; ");
      },
    });

    const seen = new Set<string>();
    const headlines = data.headlines
      .map((h) => stripEmDashes(h).trim())
      .filter((h) => h && !seen.has(h.toLowerCase()) && seen.add(h.toLowerCase()))
      .slice(0, count);

    return { ok: true, headlines, usedFramework: Boolean(ctx.framework), quoteCount: ctx.quotes.length };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
