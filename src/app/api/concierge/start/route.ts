// Open a concierge conversation. Public by design, so every bound is here.
//
// ‼️ PUBLIC AND UNAUTHENTICATED, WHICH IS WHY THE LIMITS ARE NOT OPTIONAL. This route is published
// on concierge.srtagency.com, a hostname whose whole job is to be pasted into third-party pages, so
// it is reachable by anybody who can read a page's HTML. It mints a row and it will later spend
// model tokens, which makes it both a lead-injection surface and a spend faucet.
//
// ‼️ A DISABLED CONFIG IS A 404, NOT A 403. Same call middleware.ts makes everywhere: a 403 confirms
// the tenant exists. There is nothing to gain from telling a scanner which slugs are real.

import { NextRequest, NextResponse } from "next/server";
import { conciergeAllowed, PREVIEW_TOKEN_PARAM } from "@/lib/concierge/preview-grant";
import { openingFor } from "@/lib/concierge/engine";
import { conciergeAmmo } from "@/lib/concierge/ammo";
import { magnetByKey, pillLabel, resolveMagnet } from "@/lib/concierge/magnets";
import { loadConciergeConfig, quickActionsFor } from "@/lib/concierge/config";

/** The audit button already offers the visibility scan, so a magnet that IS the scan is not offered twice. */
function isAuditMagnet(key: string | null): boolean {
  return key === "visibility_scan";
}
import { appendMessage, startConciergeSession } from "@/lib/concierge/session";
import { clientIpFrom, hashIp } from "@/lib/scan/session";
import { supabaseAdmin } from "@/lib/db";
import { parseCityCell, fromCityState } from "@/lib/market/place";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Conversations one address may open in a day. High enough for a real office, low enough to bore a script. */
const SESSIONS_PER_IP_PER_DAY = 12;

function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "cache-control": "no-store" } });
}

async function overLimit(ipHash: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabaseAdmin
    .from("concierge_sessions")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  // ‼️ FAIL OPEN ON A BROKEN COUNT, NOT CLOSED. A failed limit read is our outage, and refusing
  // every visitor on a client's live site to avoid an unmeasured abuse case is the worse trade.
  if (error) {
    console.error(`[concierge] rate check failed, allowing: ${error.message}`);
    return false;
  }
  return (count ?? 0) >= SESSIONS_PER_IP_PER_DAY;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const slug = String(body.slug ?? "").trim().toLowerCase();
  const config = await loadConciergeConfig(slug);
  if (!config) return notFound();

  // The one thing that puts this on a real site. A row existing is not consent.
  //
  // ‼️ THE ONE EXCEPTION IS A SIGNED PREVIEW TOKEN FOR THIS EXACT CLIENT, and it is what makes
  // the demo link concierge_preview posts before the call actually work. It is not a relaxation
  // of `enabled`: nothing on the open internet can hold one. See lib/concierge/preview-grant.ts.
  //
  // ‼️ THIS IS ALSO THE GATE THAT COVERS /turn AND /booked. A session is minted here and nowhere
  // else, so a session token is proof that a grant was spent, which is why those two routes trust
  // the session rather than asking for the token again.
  const token = new URL(req.url).searchParams.get(PREVIEW_TOKEN_PARAM);
  if (!conciergeAllowed(config, token)) return notFound();

  const ipHash = hashIp(clientIpFrom(req));
  if (await overLimit(ipHash)) {
    return NextResponse.json(
      { error: "Too many conversations from this address today." },
      { status: 429, headers: { "cache-control": "no-store" } }
    );
  }

  const str = (v: unknown, max: number): string | null => {
    const s = String(v ?? "").trim().slice(0, max);
    return s.length > 0 ? s : null;
  };

  const session = await startConciergeSession({
    clientId: config.clientId,
    entryHost: str(body.host, 200),
    entryPath: str(body.path, 500),
    entryPageId: null,
    pageCategory: str(body.category, 40),
    pageMagnetKey: str(body.magnet, 60)?.toLowerCase() ?? null,
    embedOrigin: req.headers.get("origin"),
    ipHash,
    userAgent: str(req.headers.get("user-agent"), 400),
  });
  if (!session) return NextResponse.json({ error: "Could not start" }, { status: 500 });

  // ‼️ THE OPENER IS BUILT HERE AND NO MODEL IS INVOLVED. Matthew's requirement is that the first
  // line names a real competitor and a real count. A generated opener could only be hoped to; this
  // one either carries a measured row or honestly asks for the city.
  const cityHint = str(body.city, 120);
  const place = cityHint ? (parseCityCell(cityHint) ?? fromCityState(cityHint, null)) : null;

  // ‼️ THE FIFTH ROUTE TO "THIS CLIENT IS A MED SPA", AND THE LAST LIVE ONE. This read
  // `?? "medspa"`, so the opener of a non-clinical client's widget, the very first line a visitor
  // ever sees, looked up med spa competitors in their city. engine.ts:242 closed the same default
  // on the turn path by reading config.buyerMarket; this is the same lookup on the OPENER path and
  // it was missed. The other four were closed on 2026-09-14: the column default, the read-time
  // coalesce in config.ts, the provisioning seed in concierge-setup.ts, and engine.ts's ammo
  // lookup. Whenever a non-clinical client reads as a med spa, look for a NEW default rather than
  // assuming it is one of these; concierge-setup.ts's own header records removing such a literal
  // once and finding it back twelve lines below.
  //
  // No fallback. buyerMarket null means nobody has said what market this buyer competes in, and
  // conciergeAmmo with an empty service returns nothing, which is what marketKeys() already does
  // for a blank. The opener then degrades to asking for the city, which openingFor handles, rather
  // than naming a rival from the wrong industry as measured fact.
  const buyerMarket = str(body.service, 60) ?? config.buyerMarket ?? "";

  const ammo =
    config.audience === "owner" && place && buyerMarket
      ? await conciergeAmmo({
          audience: "owner",
          place,
          service: buyerMarket,
          spent: session.ammoUsed,
        })
      : null;

  const evidence = ammo?.candidates[0] ?? null;

  // ‼️ THE PAGE'S OWN CHOICE WINS, AND IT DOES NOT FALL BACK WHEN IT FAILS. Same rule as
  // offerForPage() in concierge/for-client.ts: a named key that no longer resolves means the
  // decision somebody made no longer holds, and quietly opening on a different offer under it
  // would hide that. The opener degrades to its no-magnet shape, which openingFor already has.
  const magnet = session.pageMagnetKey
    ? await magnetByKey(session.pageMagnetKey, config.audience)
    : await resolveMagnet({
        audience: config.audience,
        clientId: config.clientId,
        vertical: config.vertical,
        treatment: null,
        category: session.pageCategory,
      });

  const opening = openingFor({
    audience: config.audience,
    magnet,
    evidence,
    // Only when they actually gave us a city. With no city there is nothing honest to degrade
    // about, and the opener asks instead.
    degradeLine: place ? ammo?.degradeLine ?? null : null,
    greeting: config.greeting,
  });

  // Spent immediately, so a reload cannot open on the same line twice.
  if (evidence) {
    const { recordSessionAmmo } = await import("@/lib/concierge/session");
    await recordSessionAmmo(session, evidence, 0);
  }

  await appendMessage(session.id, "assistant", opening, 0);

  return NextResponse.json(
    {
      token: session.sessionToken,
      opening,
      audience: config.audience,
      // The header CTA reads these, so a magnet edited in the database changes the page.
      magnet: magnet ? { key: magnet.magnetKey, title: magnet.title, promise: magnet.promise } : null,
      measured: Boolean(evidence),
      // ‼️ THE GREETING AND THE BUTTONS ARE FIXED, AND THE MEASURED OPENER WAITS FOR "Type for help" (2026-09-16).
      // Matthew asked for "How can we help you today?" and three choices. The opener above is still built and
      // still written to the transcript, so the conversation a visitor types into starts where it always did.
      greeting: "How can we help you today?",
      actions: quickActionsFor(config)
        .map((a) =>
          a.kind === "magnet"
            ? magnet && !isAuditMagnet(magnet.magnetKey)
              ? { kind: "magnet", label: a.label || pillLabel(magnet) }
              : null
            : a
        )
        .filter(Boolean),
    },
    { headers: { "cache-control": "no-store" } }
  );
}
