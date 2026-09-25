// The buttons under "How can we help you today?", one route.
//
// Matthew, 2026-09-15: "It should start with 'how can we help you today?' and as buttons ... Get Free AI
// Visibility audit (3 min) and another button that says the lead magnet ... and a third option where they
// can type for help, always ask for email in case we lose connection ... and name."
//
//   contact       name + email, before anything else is handed over
//   magnet        the page's offer, handed over deterministically (no model decides what is given)
//   audit_start   a website, then the same self-serve scan srtagency.com/scan runs
//   audit_status  where that scan is, claimed with their email the moment its report exists
//   booking       times, a link or a phone number, resolved exactly as the model's tool resolves them
//
// ‼️ PUBLIC, SO THE SESSION IS THE GATE. Every action needs a session token, and a session is minted only
// by /api/concierge/start, which is where `enabled` and the preview grant are checked. The tenant, the
// audience and what has already been handed over are read off the row, never off this request.
//
// ‼️ WHOSE LEAD IT IS DEPENDS ON THE AUDIENCE. On SRT's own widget (owner) the visitor is OUR prospect, so
// the contact goes through ingestLead like every funnel. On a client's widget (patient) the visitor is the
// CLIENT's customer: they are kept on the session row only and never enter SRT's CRM or #hot-leads.

import { NextRequest, NextResponse } from "next/server";
import { loadConciergeConfig } from "@/lib/concierge/config";
import { conciergeAllowed, PREVIEW_TOKEN_PARAM } from "@/lib/concierge/preview-grant";
import { allowedMagnet, onboardingUrl, trackedUrl } from "@/lib/concierge/engine";
import { resolveBooking } from "@/lib/concierge/booking";
import { safeTimeZone } from "@/lib/calendly";
import { deliveryUrlFor } from "@/lib/concierge/magnets";
import { appendMessage, captureLead, loadConciergeSession, loadMessages, recordDelivered } from "@/lib/concierge/session";
import { claimScan, isEmail, startScan } from "@/lib/scan/start-claim";
import { buildStatusPayload, clientIpFrom, getSession, hashIp } from "@/lib/scan/session";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function clean(v: unknown, max: number): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function note(sessionId: string, role: "user" | "assistant", text: string): Promise<void> {
  const history = await loadMessages(sessionId);
  await appendMessage(sessionId, role, text, history.length);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return reply({ error: "Bad request" }, 400);
  }

  const session = await loadConciergeSession(String(body.token ?? ""));
  if (!session) return reply({ error: "Not found" }, 404);

  const { data: client } = await supabaseAdmin.from("clients").select("slug").eq("id", session.clientId).maybeSingle();
  const config = client?.slug ? await loadConciergeConfig(String(client.slug)) : null;
  const previewToken = new URL(req.url).searchParams.get(PREVIEW_TOKEN_PARAM);
  if (!config || !conciergeAllowed(config, previewToken)) return reply({ error: "Not found" }, 404);

  const action = String(body.action ?? "");

  // ── contact ────────────────────────────────────────────────────────────────
  // ‼️ ONE LEAD WRITER, WIDENED, NOT A SECOND ONE. The AI Referral Engine walk asks for a last
  // name and a phone that the two-field door never collected, and the obvious shape was a
  // referral_contact action beside this one. That is how a lane ends up with two paths into #hot-leads
  // that disagree about the owner/patient rule, and this file's header IS that rule. Everything the
  // walk adds is optional here, so the audit door and the magnet door send what they always sent.
  if (action === "contact") {
    const name = clean(body.name, 60);
    const email = clean(body.email, 120).toLowerCase();
    if (name.length < 2 || /[<>{}]|https?:/i.test(name)) return reply({ ok: false, field: "name", message: "What should we call you?" }, 400);
    if (!isEmail(email)) return reply({ ok: false, field: "email", message: "That email does not look right." }, 400);

    // ‼️ THE SURNAME IS ITS OWN FIELD ON THE WALK'S FORM, AND SPLITTING `name` WOULD LOSE IT. The
    // two-field door still sends one `name`, so the split below stays as the fallback for it.
    const lastTyped = clean(body.lastName, 60);
    if (lastTyped && /[<>{}]|https?:/i.test(lastTyped)) {
      return reply({ ok: false, field: "lastName", message: "That surname does not look right." }, 400);
    }

    // ‼️ STRICT, AND THE STRICTNESS IS LOAD BEARING. This route is public and unauthenticated, and
    // a phone that reaches contacts is a number a person or a dialer will ring. normalizePhone is the
    // /aivisibility validator: ten digits, no 0 or 1 area code or exchange, no all-same placeholder. A
    // number that fails is REFUSED rather than stored, because a stored bad number is a call to a
    // stranger. Empty is fine: every door except the referral walk asks for no phone at all.
    const phoneTyped = clean(body.phone, 32);
    let phone: string | null = null;
    if (phoneTyped) {
      const { normalizePhone } = await import("@/lib/medspa/validate");
      phone = normalizePhone(phoneTyped);
      if (!phone) {
        return reply({ ok: false, field: "phone", message: "That phone number does not look right." }, 400);
      }
    }

    // What the walk asked before the form. Recorded as answers, never interpreted.
    const reviews = clean(body.reviews, 60);
    const website = clean(body.website, 200);

    const already = session.email === email;
    await captureLead(session, { firstName: name, email, phone });
    const picked = clean(body.picked, 20);
    await note(
      session.id,
      "user",
      `${name}${lastTyped ? ` ${lastTyped}` : ""} <${email}>${phone ? ` ${phone}` : ""}` +
        `${picked ? ` (picked: ${picked})` : ""}${reviews ? ` reviews: ${reviews}` : ""}${website ? ` site: ${website}` : ""}`
    );

    if (config.audience === "owner" && !already) {
      const { ingestLead } = await import("@/lib/lead-intake");
      const parts = name.split(" ").filter(Boolean);
      const where = [clean(body.host, 200), clean(body.path, 300)].join("");
      const { contactId } = await ingestLead({
        firstName: parts[0] ?? "",
        lastName: lastTyped || parts.slice(1).join(" "),
        email,
        ...(phone ? { phone } : {}),
        ...(website ? { website } : {}),
        source: "concierge",
        // ‼️ STILL FALSE EVEN THOUGH THERE IS NOW A PHONE, AND THAT IS MATTHEW'S CALL (2026-09-25).
        // It was false before because the concierge collected no number, so it cost nothing either way.
        // The referral walk collects one, which turns this from a leftover into a decision: nothing
        // auto-dials somebody who filled in a form on a clinic's website. The number is on the
        // #hot-leads card and the call is a person's to make. One flag to reverse.
        speedToLead: false,
        noteTitle: "AI concierge conversation",
        headline: `:cat: *Started a conversation with the concierge*${where ? ` on ${where}` : ""} and gave their email.`,
        detailLines: [
          picked ? `Picked: ${picked}` : "",
          where ? `Page: ${where}` : "",
          reviews ? `Reviews they say they have: ${reviews}` : "",
          website ? `Website: ${website}` : "",
          phone
            ? "SMS consent: not collected (the phone was given to book the install call)"
            : "SMS consent: not collected (the concierge asks for email only)",
        ],
      }).catch((e) => {
        console.error(`[concierge/action] ingestLead failed: ${(e as Error).message}`);
        return { contactId: null };
      });
      if (contactId) {
        await supabaseAdmin.from("concierge_sessions").update({ contact_id: contactId }).eq("id", session.id);
      }
    } else if (!already) {
      // ‼️ A PATIENT CAPTURE GOES TO THE CLIENT'S OWN CHANNEL AND NOWHERE ELSE (2026-09-16).
      //
      // The rule above stands: a visitor to a client's site is the CLIENT's customer, so nothing about
      // them enters SRT's CRM, Zoho or #hot-leads. But "not ours" was being read as "nobody's": the row
      // was written to concierge_sessions and no human was ever told, so a clinic's widget could capture
      // somebody all afternoon and the clinic would find out never. Their private ops channel is the one
      // place that is theirs and ours at once, which is where the board already talks to them.
      //
      // Failure is swallowed on purpose. A missing channel, a Slack outage or a client provisioned before
      // ops channels existed must not turn into a 500 for the person typing their name into a widget.
      await notifyClientLead({ clientId: session.clientId, name, email, phone, body, picked }).catch((e) =>
        console.error(`[concierge/action] client lead notice failed: ${(e as Error).message}`)
      );
    }
    return reply({ ok: true, firstName: name.split(" ")[0] });
  }

  // Everything below hands something over, and nothing is handed over before a way to reach them.
  if (!session.email) return reply({ ok: false, needContact: true }, 400);

  // ── referral_times ─────────────────────────────────────────────────────────
  //
  // The install-call step of the AI Referral Engine walk. Two real times, in the half of the day they
  // asked for, or an honest answer that there are none.
  //
  // ‼️ resolveBooking() UNCHANGED, AND NO SECOND SLOT SOURCE. It is what offer_booking and the
  // `booking` action already use, and it is the only thing in the lane that knows what is actually
  // open. A scripted walk is exactly where inventing "Tuesday at 10" would be easiest and worst: the
  // model is not in this path, so nothing downstream would catch a made-up time.
  //
  // ‼️ THE OWNER LANE IGNORES THE TENANT'S booking_* COLUMNS, WHICH IS WHY THIS WORKS TODAY. The
  // brief said SRT has no booking destination set so this step had nothing to offer. Not for this
  // audience: booking.ts reaches for SRT's own Calendly for `owner` and never reads
  // concierge_configs.booking_mode. `booking: <link>` in a step thread is for PATIENT tenants.
  if (action === "referral_times") {
    if (config.audience !== "owner") return reply({ ok: false, message: "Not available here." }, 404);

    const daypart = body.daypart === "afternoon" ? "afternoon" : "morning";
    const tz = safeTimeZone(clean(body.tz, 64));
    const offer = await resolveBooking({
      config,
      timeZone: tz,
      // ‼️ WIDENED FROM THE START, UNLIKE THE `booking` ACTION. That one hardcodes today_tomorrow
      // and never widens, which is fine for "here are some times" and wrong here: this walk asks for a
      // half of the day first, so a two-day window that happens to hold only mornings would answer an
      // afternoon request with nothing at all.
      window: "extended",
      fallbackUrl: onboardingUrl(session, null, null),
    });

    if (offer.mode === "slots") {
      const wanted = offer.slots.filter((slot) => partOfDay(slot.startTime, tz) === daypart);
      // Their half of the day first. If it holds none, say so rather than quietly booking the other
      // half: somebody who asked for mornings and is shown 3pm has been ignored, not helped.
      const chosen = wanted.slice(0, 2);
      if (chosen.length > 0) {
        return reply({
          ok: true,
          mode: "slots",
          daypart,
          slots: chosen.map((slot) => ({
            label: slot.label,
            url: trackedUrl(session, slot.url),
            startTime: slot.startTime,
          })),
          // Only used when their half of the day is empty and the other is not.
          otherHalf: wanted.length === 0 && offer.slots.length > 0,
        });
      }
      return reply({
        ok: true,
        mode: "slots",
        daypart,
        slots: offer.slots.slice(0, 2).map((slot) => ({
          label: slot.label,
          url: trackedUrl(session, slot.url),
          startTime: slot.startTime,
        })),
        otherHalf: true,
      });
    }

    if (offer.mode === "link") {
      return reply({
        ok: true,
        mode: "link",
        attachments: [{ kind: "booking", key: "link", title: offer.label, url: trackedUrl(session, offer.url) }],
      });
    }
    if (offer.mode === "phone") return reply({ ok: true, mode: "phone", phone: offer.phone });

    // no_slots and callback both mean there is nothing real to put in front of them. Kept apart from
    // `link` and `phone` so the frame says the callback line rather than drawing an empty row of times.
    return reply({ ok: true, mode: "callback" });
  }

  // ── magnet ─────────────────────────────────────────────────────────────────
  if (action === "magnet") {
    const magnet = await allowedMagnet({ config, session });
    if (!magnet || !magnet.magnetKey) {
      return reply({ ok: true, magnet: null, message: "I have already sent you everything I have for this page. Ask me anything else." });
    }
    const url = await deliveryUrlFor(magnet);
    if (!url) return reply({ ok: true, magnet: null, message: "That one is not ready to send yet. Type your question and I will help directly." });
    await recordDelivered(session, magnet.magnetKey, magnet.id);
    await note(session.id, "assistant", `Sent: ${magnet.title}`);
    return reply({ ok: true, magnet: { title: magnet.title, promise: magnet.promise, url, cta: magnet.ctaLabel || "Open it" } });
  }

  // ── booking ────────────────────────────────────────────────────
  //
  // ‼️ THE KIND EXISTED IN THE TYPE AND NOWHERE ELSE UNTIL NOW. QuickAction.kind has accepted
  // "booking" since the doors were built, readQuickActions validated it, and neither
  // quickActionsFor nor the frame's choose() ever handled one. A tenant who put a booking button
  // in concierge_configs.quick_actions got a button that opened a text box.
  //
  // ‼️ IT RESOLVES THE CALL THE SAME WAY offer_booking DOES, by calling the same function. A
  // second way to work out whether this tenant has a calendar is a second thing to get wrong, and
  // the failure mode is a visitor being offered a time that does not exist.
  //
  // ‼️ NOTHING HERE MARKS THE SESSION BOOKED. Offering a time is not taking one;
  // /api/concierge/booked records the click.
  if (action === "booking") {
    const offer = await resolveBooking({
      config,
      timeZone: safeTimeZone(clean(body.tz, 64)),
      window: "today_tomorrow",
      // The session carries no place or business on this path, and inventing one would put a
      // city into a handoff URL that nobody said out loud.
      fallbackUrl: onboardingUrl(session, null, null),
    });

    if (offer.mode === "slots") {
      return reply({
        ok: true,
        message: "Here are the next times. Pick whichever suits you.",
        attachments: offer.slots.map((slot) => ({
          kind: "slot",
          key: slot.startTime,
          title: slot.label,
          url: trackedUrl(session, slot.url),
        })),
      });
    }
    if (offer.mode === "link") {
      return reply({
        ok: true,
        message: "Here is the calendar. Pick a time that suits you.",
        attachments: [{ kind: "booking", key: "link", title: offer.label, url: trackedUrl(session, offer.url) }],
      });
    }
    if (offer.mode === "phone") {
      return reply({ ok: true, message: `The fastest way is to call ${offer.phone}.`, attachments: [] });
    }
    // no_slots and callback both mean: there is nothing to put in front of them right now. Say
    // so rather than rendering an empty row of buttons.
    return reply({
      ok: true,
      message: "I do not have times to offer this minute. Leave it with me and we will come back to you with some.",
      attachments: [],
    });
  }
  // The audit is SRT's product, offered to a business owner. It is not a button a patient ever sees.
  if ((action === "audit_start" || action === "audit_status") && config.audience !== "owner") {
    return reply({ error: "Not found" }, 404);
  }

  // ── audit_start ────────────────────────────────────────────────────────────
  if (action === "audit_start") {
    const website = clean(body.website, 300);
    const started = await startScan({ url: website, ipHash: hashIp(clientIpFrom(req)) });
    if (!started.ok) return reply({ ok: false, message: started.message ?? "That site could not be scanned." }, started.status);
    await note(session.id, "user", `Audit: ${started.domain}`);
    return reply({ ok: true, scanId: started.id, domain: started.domain, cached: started.cached });
  }

  // ── audit_status ───────────────────────────────────────────────────────────
  if (action === "audit_status") {
    const scanId = clean(body.scanId, 40);
    if (!UUID.test(scanId)) return reply({ error: "Not found" }, 404);
    const scan = await getSession(scanId);
    if (!scan) return reply({ error: "Not found" }, 404);

    // Claimed the moment a report row exists, because finish-report.ts reads requester_email when the run
    // ENDS (see the claim route's header): a claim after that drafts nothing.
    let reportUrl: string | null = null;
    if (scan.report_id || scan.status === "done") {
      const claimed = await claimScan({
        sessionId: scanId,
        email: session.email,
        name: session.firstName ?? "",
        source: "concierge",
        funnel: `concierge (${config.slug})`,
      });
      if (claimed.ok) reportUrl = claimed.reportUrl;
    }
    const payload = await buildStatusPayload(scan);
    // A subset: the stepped page's payload also carries competitor names and prompts, which belong on the
    // report the email unlocks, not in a chat bubble before it.
    return reply({
      ok: true,
      status: payload.status,
      reportUrl,
      step: payload.activeStep,
      engine: payload.engine,
      error: payload.error,
    });
  }

  return reply({ error: "Unknown action" }, 400);
}

/**
 * Tell the client, in their own private channel, that somebody left their details on their site.
 *
 * ‼️ THEIR CHANNEL, NEVER #hot-leads, AND NEVER A contacts ROW. This is the client's customer. The file
 * header states the rule; this function is the half of it that stops "not SRT's lead" meaning "nobody's
 * lead". Nothing here writes to contacts, Zoho or the lead thread: it is a message, and the durable
 * record stays on concierge_sessions where the 24 hour purge can reach it.
 */
/**
 * Which half of the day a slot falls in, in the VISITOR'S timezone.
 *
 * ‼️ THE TIMEZONE IS THE WHOLE FUNCTION. Calendly returns an instant, and "mornings" is a fact
 * about where the person asking is standing, not about where our calendar lives. Reading the UTC hour
 * would offer a 9am Pacific install to somebody in New York as an afternoon.
 *
 * ‼️ AND AN UNREADABLE INSTANT IS "afternoon" RATHER THAN A THROW. This runs inside a scheduling
 * step where the alternative to a bucket is no times at all; the slot's own label is what the visitor
 * actually reads, and that label came from Calendly, so a mis-bucketed slot shows the right time in the
 * wrong half rather than a wrong time. safeTimeZone has already rejected a junk zone by this point.
 */
function partOfDay(startTime: string, timeZone: string): "morning" | "afternoon" {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone }).format(
        new Date(startTime)
      )
    );
    return Number.isFinite(hour) && hour < 12 ? "morning" : "afternoon";
  } catch {
    return "afternoon";
  }
}

async function notifyClientLead(args: {
  clientId: string;
  name: string;
  email: string;
  /** Null on every door but the referral walk, which is owner-only today. Here so that if a patient
   *  lane ever collects one, the clinic is told the number rather than only that somebody called. */
  phone: string | null;
  body: { host?: unknown; path?: unknown };
  picked: string;
}): Promise<void> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("ops_channel_id, dba_name, legal_name")
    .eq("id", args.clientId)
    .maybeSingle();
  const channel = typeof data?.ops_channel_id === "string" ? data.ops_channel_id.trim() : "";
  if (!channel) return;

  const where = [clean(args.body.host, 200), clean(args.body.path, 300)].join("");
  const { slack } = await import("@/lib/slack-bot");
  await slack.postMessage(
    channel,
    [
      `:wave: *Somebody left their details with the assistant* on ${(data?.dba_name as string) || (data?.legal_name as string) || "the site"}.`,
      `Name: ${args.name}`,
      `Email: ${args.email}`,
      args.phone ? `Phone: ${args.phone}` : "",
      args.picked ? `Asked for: ${args.picked}` : "",
      where ? `Page: ${where}` : "",
      "This is the clinic's own enquiry. It is not in our CRM and it has not been contacted.",
    ]
      .filter(Boolean)
      .join("\n")
  );
}
