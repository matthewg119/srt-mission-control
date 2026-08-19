// One request against a client hub host, recorded.
//
// ‼️ NOT UNDER /api/hub/, AND THAT IS DELIBERATE. src/middleware.ts allows exactly one API
// path on a client-controlled hostname, HUB_API, and it is a NAME rather than a prefix.
// Putting this route beside it would mean that the day somebody "tidies" that check into a
// startsWith("/api/hub/"), a database write endpoint appears on every domain a client's
// registrar points at us. Living under /api/internal/ means the tidy-up cannot reach it.
//
// It is refused on external hosts BY THE EXISTING ALLOWLIST WITH NO NEW RULE: it is not
// "/", not in HUB_FILES, and HUB_SLUG forbids slashes, so a two-segment path can never
// match. It falls through to notFound(true). That is the deny-by-default asymmetry the
// middleware header describes, working without anyone having to remember it.
//
// Middleware reaches it by calling it directly, server side, on the internal host, with a
// shared secret. Two independent gates, neither load-bearing alone.
//
// WHY A SECOND HOP AT ALL. Middleware runs on the Edge and this repo's rule is that it does
// no database work. Resolution belongs on Node behind resolveHost()'s cache, and
// node:crypto -- which the visitor hash needs -- does not exist at the Edge.

import { NextRequest, NextResponse } from "next/server";
import { resolveHost } from "@/lib/hub/resolve";
import { listPublished } from "@/lib/hub/pages";
import { recordHit, slugFromPath } from "@/lib/hub/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// supabase-js calls the patched global fetch, so a read here lands in the DATA cache unless
// this is set. dynamic covers the ROUTE cache and does not cover it. Same trap the /scan
// routes document at length.
export const fetchCache = "force-no-store";

/** The per-host generated files. Real fetches, worth counting, and they have no page row. */
const HUB_FILES = new Set(["/robots.txt", "/sitemap.xml", "/llms.txt"]);

/**
 * CRON_SECRET rather than a new variable, deliberately.
 *
 * A dedicated secret would fail closed when unset, which sounds safer and is the wrong
 * trade: the failure is silent and the symptom is an empty chart weeks later with nothing
 * in any log saying why. CRON_SECRET is already required by fourteen cron routes, so it is
 * guaranteed present in any environment that can serve a hub host at all.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("x-hub-hit-secret") === secret;
}

/**
 * ‼️ THE AMPLIFICATION GATE, and it is the reason this route is not a liability.
 *
 * HUB_SLUG in middleware matches ANY dotless lowercase segment, so /a, /b, /c ... all pass
 * the allowlist. Without this check every one of them would become an invocation plus an
 * INSERT, which turns a client's hub into a metered request amplifier and fills the
 * per-page breakdown with paths that do not exist.
 *
 * The set of paths this table can contain is therefore CLOSED BY CONSTRUCTION: the index,
 * the three generated files, and slugs that are published right now. listPublished is
 * already unstable_cache'd at 300s and tagged per client, so this costs nothing and a newly
 * published page starts counting within one publish rather than one TTL.
 */
async function isRealPath(clientId: string, kind: string, path: string): Promise<boolean> {
  if (path === "/") return true;
  // The review tool is one tool on one URL. It has no slugs at all.
  if (kind === "reviews") return false;
  if (HUB_FILES.has(path)) return true;

  const slug = slugFromPath(path);
  if (!slug) return false;

  const pages = await listPublished(clientId);
  return pages.some((p) => p.slug === slug);
}

export async function POST(req: NextRequest) {
  // 404, not 401. Same reasoning as middleware: a 403 confirms the route exists.
  if (!authorized(req)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: {
    host?: string;
    path?: string;
    ua?: string | null;
    ip?: string | null;
    referrer?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const host = (body.host ?? "").trim().toLowerCase();
  const path = (body.path ?? "").trim();
  if (!host || !path) return NextResponse.json({ ok: false }, { status: 400 });

  try {
    // The client is DERIVED from the hostname, never read off the body. Same refusal to
    // trust the caller as api/hub/reviews/submit.
    const resolved = await resolveHost(host);
    // A miss is normal: a hostname can be attached at Vercel before its client_hosts row
    // exists, and anyone may point a CNAME at us. Nothing to record.
    if (resolved.status !== "ok") return NextResponse.json({ ok: true, recorded: false });

    if (!(await isRealPath(resolved.client.id, resolved.kind, path))) {
      return NextResponse.json({ ok: true, recorded: false });
    }

    await recordHit({
      clientId: resolved.client.id,
      host: resolved.host,
      kind: resolved.kind,
      path,
      userAgent: body.ua ?? null,
      ip: body.ip ?? null,
      referrer: body.referrer ?? null,
    });

    return NextResponse.json({ ok: true, recorded: true });
  } catch (e) {
    // ‼️ SWALLOW. resolveHost() THROWS on a Supabase failure on purpose, so that a hub PAGE
    // serves a 5xx rather than a 404 that would deindex a client. That reasoning belongs to
    // the page, not to an analytics row: here the right outcome of a database blip is one
    // lost hit, quietly. The caller is a waitUntil on a response that already went out.
    console.error("[hub-hit] failed:", (e as Error).message);
    return NextResponse.json({ ok: true, recorded: false });
  }
}
