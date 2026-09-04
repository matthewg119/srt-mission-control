// The click-through. Records that they actually went, then sends them on.
//
// ‼️ THIS EXISTS BECAUSE OFFERING A TIME IS NOT BOOKING ONE, AND WE COULD NOT TELL THEM APART.
// A slot button is an outbound link to Calendly, so nothing server side ever learned whether the
// visitor pressed it. Every session that reached the close looked identical to every session that
// took a time. One hop through here is the difference between "the bot offered times" and "somebody
// went to book", which is the only number that says whether this lane works.
//
// ‼️ AND IT IS STILL NOT A BOOKING. Calendly confirms bookings, via the event_scheduled listener
// the funnel already has. This route records an INTENT and says so in the column it writes.
//
// ‼️ THE HOST ALLOWLIST IS AN OPEN REDIRECT GUARD, NOT TIDINESS. This is a public GET on a hostname
// pasted into third-party pages, and it takes a URL and sends a browser to it. Without the check it
// is a redirector on our own domain that anybody can point anywhere, which is a phishing primitive
// that borrows our reputation. Allowlist, never a denylist, and never a substring test.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { loadConciergeConfig } from "@/lib/concierge/config";
import { loadConciergeSession } from "@/lib/concierge/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Calendly and nothing else that is not ours. Exact host, or a subdomain of it. */
const CALENDLY = "calendly.com";

function hostAllowed(target: URL, extra: Array<string | null>): boolean {
  // https only. A downgrade to http on a link we hand out is not something to be relaxed about.
  if (target.protocol !== "https:") return false;

  const host = target.hostname.toLowerCase();
  if (host === CALENDLY || host.endsWith(`.${CALENDLY}`)) return true;

  for (const candidate of extra) {
    if (!candidate) continue;
    try {
      const allowed = new URL(candidate).hostname.toLowerCase();
      // Exact match only. endsWith on a configured host would let evil-srtagency.com through.
      if (host === allowed) return true;
    } catch {
      // A malformed configured URL allows nothing, which is the safe direction.
    }
  }
  return false;
}

function reject(): NextResponse {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "content-type": "text/plain", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const raw = (params.get("u") ?? "").slice(0, 2000);
  const token = params.get("t") ?? "";

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return reject();
  }

  const session = await loadConciergeSession(token);
  if (!session) return reject();

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("slug")
    .eq("id", session.clientId)
    .maybeSingle();
  const slug = typeof client?.slug === "string" ? client.slug : null;
  const config = slug ? await loadConciergeConfig(slug) : null;
  if (!config) return reject();

  // ‼️ NO `enabled` CHECK HERE, AND IT IS THE SESSION THAT REPLACES IT. This URL is built server
  // side by engine.ts and carries a session token, and a session is minted only by
  // /api/concierge/start, which does check. So reaching this line already proves the tenant was
  // open to this visitor when the conversation began. Re-checking would break the one thing a
  // preview demo is for: pressing the slot button in front of the client and seeing the hop
  // recorded. The open-redirect guard below is what actually protects this route, and it is
  // untouched.

  if (!hostAllowed(target, [process.env.CONCIERGE_BOOKING_URL ?? null, config.bookingUrl])) {
    console.error(`[concierge] refused a redirect to ${target.hostname}`);
    return reject();
  }

  // Best effort. A failed write must not cost the visitor the booking they were about to make,
  // which is the whole point of ordering the update before the redirect but not awaiting a result
  // we would do nothing with.
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("concierge_sessions")
    .update({ booking_clicked_at: now, outcome: "booked", updated_at: now })
    .eq("id", session.id);
  if (error) console.error(`[concierge] booked click not recorded: ${error.message}`);

  return NextResponse.redirect(target.toString(), {
    status: 302,
    headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
