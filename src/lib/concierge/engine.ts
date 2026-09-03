// One turn of the concierge, and every gate the model is not allowed to argue past.
//
// ‼️ EVERY GATE IN HERE IS AN EXECUTOR REFUSAL, NOT A PROMPT LINE. A refusal is returned as a
// tool_result with a `say` field, so the model reads it as an OUTCOME rather than as guidance it
// can weigh against the visitor's insistence. onboarding2/chat.ts records why: "A gate that lives
// only in a system prompt is a gate the model argues past."
//
// ‼️ THE OPENER IS NOT GENERATED. openingFor() is deterministic, built from a measured row or from
// nothing. Matthew's requirement is that the first line names a real competitor and a real count,
// and the only way to guarantee that rather than hope for it is to leave the model out of the one
// turn where there is no conversation yet to correct a mistake.
//
// ‼️ THE BOOKING GATE COUNTS DELIVERED MAGNETS, AND IT NEVER BLOCKS SOMEBODY TRYING TO BUY. The
// stacking rule exists to make the free thing feel like a gift. Applied to a visitor who has just
// typed "can I book a call", it would turn into the exact gate it was meant to replace.

import { runConversationWithTools } from "@/lib/ai";
import type { ToolExecutionResult } from "@/lib/ai-tools";
import { hasBannedDash } from "@/lib/copy-guard";
import { fromCityState, parseCityCell, type Place } from "@/lib/market/place";
import type { AmmoCandidate } from "@/lib/ammo/supply";
import { conciergeAmmo } from "./ammo";
import type { ConciergeConfig } from "./config";
import {
  assetUrlFor,
  magnetByKey,
  nextInChain,
  resolveMagnet,
  type LeadMagnet,
} from "./magnets";
import {
  captureLead,
  loadMessages,
  markBookingClicked,
  recordDelivered,
  recordSessionAmmo,
  type ConciergeSession,
} from "./session";
import { MAX_REPLY_WORDS, systemPrompt, toolsFor } from "./tools";

/** How many free things before the bot may raise the call. Two, because double the value. */
export const MAGNETS_BEFORE_ASK = 2;

/** How many measured lines one evidence lookup hands over. A shortlist, not a report. */
const MAX_EVIDENCE_LINES = 3;

export interface BookingDecision {
  offered: boolean;
  outstanding: number;
}

/**
 * May the bot raise the call yet?
 *
 * ‼️ PURE, SO THE PROBE PROVES THE GATE WITH NO DATABASE AND NO MODEL. The rule is the whole of
 * Matthew's stacking correction: deliver two free things before asking. The exception is as load
 * bearing as the rule, because a stacking gate applied to somebody who has just typed "can I book
 * a call" becomes the exact obstacle it was meant to replace.
 */
export function bookingGate(delivered: number, visitorAsked: boolean): BookingDecision {
  const outstanding = Math.max(0, MAGNETS_BEFORE_ASK - delivered);
  return { offered: outstanding === 0 || visitorAsked, outstanding };
}

/**
 * Did the visitor ASK to book?
 *
 * ‼️ DECIDED HERE, FROM THEIR TEXT, BEFORE THE MODEL RUNS. The tool takes a requested_by_visitor
 * flag, and a model that wants to ask for the call would eventually set it true itself. This is the
 * fact the executor trusts; the flag on the tool is only a hint.
 */
export function asksToBook(text: string): boolean {
  return /\b(book|booking|schedule|scheduling|call me|a call|the call|speak|talk to|demo|meeting|get started|sign up|sign me up|when can we)\b/i.test(
    text
  );
}

/** Where the owner lane hands off. A link, and nothing more: onboarding2 belongs to another lane. */
function onboardingUrl(session: ConciergeSession, place: Place | null, business: string | null): string {
  const base = (process.env.CONCIERGE_BOOKING_URL ?? "https://srtagency.com/onboarding2").trim();
  const url = new URL(base);
  if (business) url.searchParams.set("business", business);
  if (place?.city) url.searchParams.set("city", place.city);
  url.searchParams.set("utm_source", "concierge");
  url.searchParams.set("utm_campaign", session.id);
  return url.toString();
}

/**
 * The first thing the visitor reads. Never a greeting.
 *
 * Three shapes, and which one it is depends entirely on what we actually know:
 *   evidence  we know their market and something is unspent, so it opens on a real name and a
 *             real count, taken straight from the ammo line.
 *   degrade   we know their city and we have NOT measured it, so it says exactly that.
 *   ask       we do not know where they are, so it asks, and it says what the answer buys.
 *
 * ‼️ THE DEGRADE SHAPE EXISTS BECAUSE ASKING FOR A CITY WE WERE JUST GIVEN IS A LIE BY OMISSION.
 * The first live run of this opener passed city=Greensboro, got nothing measured, and fell through
 * to "tell me your city". The visitor had told us. Silently re-asking hides the honest answer,
 * which is that we have not put their market through the engines, and that honest answer is also
 * the only real reason for them to take the scan.
 *
 * The ask form stays the common one, because the widget usually has no city until somebody types
 * one. That is not a degraded opener either. It is still not a greeting.
 */
export function openingFor(args: {
  audience: string;
  magnet: LeadMagnet | null;
  evidence: AmmoCandidate | null;
  degradeLine?: string | null;
  greeting: string | null;
}): string {
  if (args.audience !== "owner") {
    return args.greeting ?? args.magnet?.conciergeEntry ?? "Hi. What brought you in today?";
  }
  if (args.evidence) return args.evidence.detail;
  if (args.degradeLine) return args.degradeLine;
  return "Tell me your city and I will show you which clinics ChatGPT actually names there, or tell you plainly that we have not measured it yet.";
}

// ─────────────────────────────────────────────────────────────────────────────
// The executor
// ─────────────────────────────────────────────────────────────────────────────

export interface TurnAttachment {
  kind: "magnet" | "booking";
  key: string;
  title: string;
  url: string | null;
}

export interface ExecutorContext {
  config: ConciergeConfig;
  session: ConciergeSession;
  /** Computed from the visitor's own words before the model ran. Never set by the model. */
  visitorAskedToBook: boolean;
  /** What the visitor has told us so far this turn. */
  place: Place | null;
  business: string | null;
  /** Filled by the executor, read by the caller. */
  attachments: TurnAttachment[];
  evidenceSpent: AmmoCandidate[];
  degraded: boolean;
}

function ok(data: unknown): ToolExecutionResult {
  return { content: JSON.stringify(data), structuredData: data };
}

export function makeExecutor(ctx: ExecutorContext) {
  return async function execute(
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    // ── market_evidence ──────────────────────────────────────────────────────
    if (name === "market_evidence") {
      if (ctx.config.audience !== "owner") {
        return ok({ ok: false, say: "You do not have market evidence in this conversation." });
      }

      const cityText = String(input.city ?? "").slice(0, 120).trim();
      // Audit-shaped "City, ST" first, then the bare city. Same two readers for the same reason
      // ammo/for-prospect.ts uses both: one parser for both shapes returns nothing.
      const place = parseCityCell(cityText) ?? fromCityState(cityText, null);
      if (!place) {
        return ok({ ok: false, say: "That did not read as a city. Ask them for the city and state." });
      }
      ctx.place = place;

      // ‼️ THE SERVICE DEFAULTS, IT IS NEVER INFERRED FROM THEIR WEBSITE. This lane is published to
      // med spa owners, so medspa is the honest default. Guessing a vertical from a domain is the
      // inference for-prospect.ts calls out as the one that puts a med spa's rivals in a plumber's
      // inbox.
      const service = String(input.service ?? "").slice(0, 60).trim() || "medspa";

      const ammo = await conciergeAmmo({
        audience: "owner",
        place,
        service,
        spent: ctx.session.ammoUsed,
        excludeNames: [ctx.business],
      });

      if (!ammo.candidates.length) {
        ctx.degraded = true;
        return ok({
          measured: false,
          reason: ammo.reason,
          // The model says THIS, verbatim in substance. It is the only honest thing available and
          // it is not a failure message.
          say: ammo.degradeLine,
        });
      }

      const lines = ammo.candidates.slice(0, MAX_EVIDENCE_LINES);
      // Spent the moment they are handed over, not when they are said. A turn that errors after
      // this point costs one unused line; a turn that spends on success repeats on every retry.
      for (const line of lines) {
        await recordSessionAmmo(ctx.session, line, ctx.session.turns);
        ctx.evidenceSpent.push(line);
      }

      return ok({
        measured: true,
        lines: lines.map((l) => l.detail),
        say: "State these as measured facts, in your own sentence. Do not add a number of your own.",
      });
    }

    // ── offer_magnet ─────────────────────────────────────────────────────────
    if (name === "offer_magnet") {
      const magnet = await allowedMagnet(ctx);
      if (!magnet) {
        return ok({
          offered: false,
          reason: "There is nothing left to give that has not already been given.",
          say: "Do not offer anything else. Move to the call.",
        });
      }

      // ‼️ THE MODEL'S magnet_key IS READ AND THEN IGNORED IF IT DISAGREES. The chain lives on the
      // row. A model choosing the next magnet will eventually choose one that does not exist for
      // this audience, and a dead offer is the failure this whole catalogue exists to prevent.
      const asked = String(input.magnet_key ?? "");
      const overridden = asked.length > 0 && asked !== magnet.magnetKey;

      const url = assetUrlFor(magnet);
      if (magnet.magnetKey) {
        await recordDelivered(ctx.session, magnet.magnetKey, magnet.id);
        ctx.attachments.push({ kind: "magnet", key: magnet.magnetKey, title: magnet.title, url });
      }

      return ok({
        offered: true,
        title: magnet.title,
        promise: magnet.promise,
        entry: magnet.conciergeEntry,
        overridden,
        delivered_count: ctx.session.magnetsDelivered.length,
        say:
          `Offer this in your own words, using its entry line as the shape: ${magnet.conciergeEntry} ` +
          `Do not paste a URL, the system attaches it.`,
      });
    }

    // ── capture_contact ──────────────────────────────────────────────────────
    if (name === "capture_contact") {
      const clean = (v: unknown, max: number): string | null => {
        const s = String(v ?? "").trim().slice(0, max);
        return s.length > 0 ? s : null;
      };
      const email = clean(input.email, 200);
      const phone = clean(input.phone, 40);
      const firstName = clean(input.first_name, 80);

      // A shape check, not a validation service. A rejected address is a person retyping it, and a
      // stored one that is wrong is a lead nobody can reach.
      if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
        return ok({ saved: false, say: "That address did not look complete. Ask them to check it." });
      }

      if (!email && !phone && !firstName) {
        return ok({ saved: false, say: "Nothing to save. Do not ask twice for the same thing." });
      }

      await captureLead(ctx.session, { email, phone, firstName });
      return ok({ saved: true, say: "Say thanks briefly and carry on. Do not read it back to them." });
    }

    // ── offer_booking ────────────────────────────────────────────────────────
    if (name === "offer_booking") {
      const delivered = ctx.session.magnetsDelivered.length;

      // ‼️ THE DECISION IS bookingGate's, AND ctx.visitorAskedToBook WAS COMPUTED FROM THE
      // VISITOR'S OWN WORDS BEFORE THE MODEL RAN. The tool takes a requested_by_visitor argument
      // and it is deliberately NOT read here: a model that would rather ask early would set it.
      const { offered, outstanding } = bookingGate(delivered, ctx.visitorAskedToBook);
      if (!offered) {
        return ok({
          offered: false,
          delivered,
          outstanding,
          reason: `Only ${delivered} of ${MAGNETS_BEFORE_ASK} free things have been given.`,
          say: `Do not raise the call yet. Offer the next free thing instead by calling offer_magnet.`,
        });
      }

      if (ctx.config.audience === "owner") {
        const url = onboardingUrl(ctx.session, ctx.place, ctx.business);
        await markBookingClicked(ctx.session);
        ctx.attachments.push({ kind: "booking", key: "onboarding2", title: "Start here", url });
        return ok({
          offered: true,
          say: "Offer the call in one sentence. The link is attached by the system, do not write it.",
        });
      }

      // Patient lane. bookingMode is tri-state and 'none' means a human calls back, so there is a
      // real answer for a clinic that has not given us a booking URL rather than a dead button.
      if (ctx.config.bookingMode === "link" && ctx.config.bookingUrl) {
        await markBookingClicked(ctx.session);
        ctx.attachments.push({
          kind: "booking",
          key: "clinic",
          title: "Book a consultation",
          url: ctx.config.bookingUrl,
        });
        return ok({ offered: true, say: "Offer the consultation in one sentence. Do not write the link." });
      }

      if (ctx.config.bookingPhone) {
        return ok({
          offered: true,
          phone: ctx.config.bookingPhone,
          say: `Tell them the clinic books by phone on ${ctx.config.bookingPhone}.`,
        });
      }

      return ok({
        offered: true,
        say: "Ask for their name and the best number, and tell them the clinic will call them back.",
      });
    }

    return ok({ error: `Unknown tool ${name}` });
  };
}

/**
 * The one magnet the executor will hand over next.
 *
 * Nothing delivered yet, so resolve for where they are standing. Something delivered, so follow
 * that magnet's own chain. Either way the answer comes off a row and never off the model.
 */
async function allowedMagnet(ctx: ExecutorContext): Promise<LeadMagnet | null> {
  const delivered = ctx.session.magnetsDelivered;

  if (delivered.length === 0) {
    return resolveMagnet(
      {
        audience: ctx.config.audience,
        clientId: ctx.config.clientId,
        vertical: ctx.config.vertical,
        treatment: null,
        category: ctx.session.pageCategory,
      },
      { exclude: delivered }
    );
  }

  const last = await magnetByKey(delivered[delivered.length - 1], ctx.config.audience);
  const chained = last ? await nextInChain(last, { exclude: delivered }) : null;
  if (chained) return chained;

  // The chain ended or its target was already given. Fall back to the ladder, still excluding
  // everything delivered, so a two-magnet chain in a long conversation does not dead-end.
  return resolveMagnet(
    {
      audience: ctx.config.audience,
      clientId: ctx.config.clientId,
      vertical: ctx.config.vertical,
      treatment: null,
      category: ctx.session.pageCategory,
    },
    { exclude: delivered }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The turn
// ─────────────────────────────────────────────────────────────────────────────

export interface TurnResult {
  reply: string;
  attachments: TurnAttachment[];
  /** The measured lines spent this turn, so the widget can show them as citations. */
  evidence: string[];
  /** True when we told them we have not measured their market. */
  degraded: boolean;
}

export interface RunTurnArgs {
  config: ConciergeConfig;
  session: ConciergeSession;
  message: string;
  /** The business name the visitor gave, when they gave one. Never inferred. */
  business?: string | null;
}

/**
 * Run one turn.
 *
 * ‼️ THE HISTORY IS REBUILT SERVER SIDE. Anything the client sent as a message list is ignored,
 * including any system role it tries to smuggle in. The browser holds a token, not a transcript.
 */
export async function runConciergeTurn(args: RunTurnArgs): Promise<TurnResult> {
  const history = await loadMessages(args.session.id);

  const ctx: ExecutorContext = {
    config: args.config,
    session: args.session,
    visitorAskedToBook: asksToBook(args.message),
    place: null,
    business: args.business ?? null,
    attachments: [],
    evidenceSpent: [],
    degraded: false,
  };

  const prompt = systemPrompt({
    audience: args.config.audience,
    tenantName: args.config.clientName,
    delivered: args.session.magnetsDelivered,
    spentDetails: args.session.ammoUsed.map((a) => a.detail),
    magnetsStillNeeded: Math.max(0, MAGNETS_BEFORE_ASK - args.session.magnetsDelivered.length),
  });

  const { response } = await runConversationWithTools(
    [...history.map((m) => ({ role: m.role, content: m.content })), { role: "user" as const, content: args.message }],
    prompt,
    undefined,
    {
      tools: toolsFor(args.config.audience),
      executor: makeExecutor(ctx),
      maxTokens: 600,
      // Enough for a lookup, an offer and the sentence that carries them. More rounds on a widget
      // turn is a visitor watching a spinner.
      maxIterations: 4,
    }
  );

  return {
    reply: tidy(response),
    attachments: ctx.attachments,
    evidence: ctx.evidenceSpent.map((a) => a.detail),
    degraded: ctx.degraded,
  };
}

/**
 * Last pass over what the model wrote.
 *
 * ‼️ THE DASH STRIP IS A REPAIR, NOT A REJECTION. Everything else in this repo that meets an em
 * dash at runtime drops the line, because there are four more behind it. Here there is exactly one
 * reply and dropping it leaves an empty bubble, so the character is replaced and the sentence
 * survives. hasBannedDash is still the detector, so there is one definition of the rule.
 */
function tidy(text: string): string {
  let out = text.trim();
  if (hasBannedDash(out)) out = out.replace(/\s*[—–―]\s*/g, ", ").replace(/\s*--\s*/g, ", ");

  // A model that ignored the no-URL rule would put a link in front of a visitor that no tool
  // returned. Stripping is safe: every real link travels as an attachment.
  out = out.replace(/https?:\/\/\S+/gi, "").replace(/[ \t]{2,}/g, " ").trim();

  const words = out.split(/\s+/);
  if (words.length > MAX_REPLY_WORDS * 2) out = `${words.slice(0, MAX_REPLY_WORDS * 2).join(" ")}...`;
  return out;
}
