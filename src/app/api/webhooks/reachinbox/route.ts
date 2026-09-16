export const dynamic = "force-dynamic";
// ReachInbox events land here. Every one of them is stored raw; only a REPLY reaches Slack.
//
// WHY NOT POINT THE WEBHOOK STRAIGHT AT SLACK, WHICH IS WHAT THE INTEGRATION IS CALLED
// Two reasons, and the second is the real one. `All Events` includes Email Sent and Email Opened,
// so at campaign volume a Slack-bound webhook buries #vektor-email-director, whose whole invariant
// is that nothing posts there unless a real prospect did something. And Slack cannot aggregate: a
// reply rate needs a store to divide in. The daily card is built from this table by
// campaign-digest.ts instead.
//
// ‼️ THAT IS AN ARGUMENT AGAINST SLACK-BOUND *VOLUME*, NOT AGAINST REPLIES (changed 2026-09-16).
// A `replied` event is precisely the channel's invariant, so it is announced here, through
// reachinbox/announce.ts, which is also where the gate lives. Sent, opened, clicked, bounced and
// completed still land in the table and say nothing. Registering this URL with `All Events`
// therefore remains correct and is still the recommended setting.
//
// ‼️ THE SECRET IS REQUIRED AND THIS ROUTE FAILS CLOSED WITHOUT IT. It is an unauthenticated
// public URL that writes to the database, so an unset secret would be an open insert endpoint.
// That is the one difference from webhooks/outscraper-medspa, which fails open on an unset secret.
//
// Register in ReachInbox as:
//   https://mission.srtagency.com/api/webhooks/reachinbox?token=<REACHINBOX_WEBHOOK_SECRET>
// with All Campaigns + All Events.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { parseReachInboxEvent } from "@/lib/reachinbox/parse";
import { announceWebhookReply, shouldAnnounceReply } from "@/lib/reachinbox/announce";

export const runtime = "nodejs";
export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const expected = (process.env.REACHINBOX_WEBHOOK_SECRET || "").trim();
  if (!expected) return false;
  const url = new URL(req.url);
  const token =
    url.searchParams.get("token") ||
    req.headers.get("x-webhook-token") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return token === expected;
}

/**
 * Some providers verify a webhook URL with a GET before they will save it, so this answers one
 * without touching the database. It reports only that the endpoint is alive and configured.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ ok: true, endpoint: "reachinbox", ready: true });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    // Named separately in the log so "I registered it and nothing arrives" is one grep away from
    // its cause, rather than looking identical to a provider that never fired.
    console.error("[reachinbox] webhook rejected: bad or missing token");
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rawText = await req.text();
  let body: unknown = null;
  try {
    body = JSON.parse(rawText);
  } catch {
    // Form-encoded or plain text. The parser reads prose, and the raw bytes are stored either way.
    body = null;
  }

  const parsed = parseReachInboxEvent(body, rawText);

  // ‼️ LOGGED ONLY FOR A REPLY, AND ONLY THE KEY NAMES. The payload shape is still a guess, so the
  // first real reply is the one chance to see whether the body arrived under a key the parser
  // reads. Values are not logged: a reply body is the lead's own words and does not belong in a
  // platform log.
  if (shouldAnnounceReply(parsed) && body && typeof body === "object") {
    console.log(
      "[reachinbox] reply payload keys:",
      Object.keys(body as Record<string, unknown>).join(","),
      "| text parsed:",
      parsed.replyText ? "yes" : "no"
    );
  }

  const { data: inserted, error } = await supabaseAdmin.from("reachinbox_events").insert({
    provider_event_id: parsed.providerEventId,
    event_type: parsed.eventType,
    campaign_name: parsed.campaignName,
    campaign_id: parsed.campaignId,
    lead_email: parsed.leadEmail,
    occurred_at: parsed.occurredAt,
    // Never the parsed view. See the migration: the mapping above is a guess against one observed
    // payload, and the original is what makes a wrong guess repairable.
    payload: body ?? { raw: rawText.slice(0, 20000) },
  })
    .select("id")
    .maybeSingle();

  let eventId = (inserted as { id?: string } | null)?.id ?? null;

  if (error) {
    // 23505 is the unique index on provider_event_id doing its job on a provider retry. That is a
    // success from the provider's point of view and must return 200, or it will keep retrying.
    if (error.code === "23505") {
      // ‼️ A RETRY STILL GETS THE CHANCE TO ANNOUNCE. The first attempt may have inserted the row
      // and then died before it reached Slack -- a timeout, a cold start, a Slack blip -- and
      // returning early here is what would turn that into a reply nobody ever saw. announce is
      // idempotent through announced_at, so asking twice is free.
      const { data: existing } = await supabaseAdmin
        .from("reachinbox_events")
        .select("id")
        .eq("provider_event_id", parsed.providerEventId)
        .maybeSingle();
      eventId = (existing as { id?: string } | null)?.id ?? null;
      if (eventId) await announceWebhookReply({ eventId, parsed }).catch(() => {});
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("[reachinbox] insert failed:", error.message);
    // 500 asks the provider to retry, which is what we want: the unique index makes that safe.
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  let announced: string = "not_a_reply";
  if (eventId) {
    // ‼️ THE EVENT IS ALREADY SAVED, SO A SLACK FAILURE MUST NOT COST US THE ROW. Throwing here
    // would answer 500, ReachInbox would retry, and the retry path above would handle it -- but
    // the funnel count is the durable half and it is already banked either way.
    announced = await announceWebhookReply({ eventId, parsed }).catch((err) => {
      console.error("[reachinbox] announce failed:", err);
      return "no_thread" as const;
    });
  }

  return NextResponse.json({
    ok: true,
    event: parsed.eventType,
    campaign: parsed.campaignName,
    email: parsed.leadEmail,
    announced,
  });
}
