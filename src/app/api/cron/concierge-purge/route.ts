// Hourly: delete concierge photos past their 24 hours, and sweep the debris.
//
// ‼️ THIS CRON IS THE CONSENT COPY. The widget tells a patient their photo is deleted within
// 24 hours; this route is the entire implementation of that sentence. It is not a cleanup job
// and it is not an optimisation. If it stops running, the product is lying to people about
// their faces, silently, and the only evidence is objects accumulating in a bucket nobody
// opens.
//
// ‼️ IT MUST BE IN vercel.json. A route with no schedule never runs and looks exactly like a
// route that does. See the entry added alongside this file.
//
// It runs hourly rather than daily on purpose: the promise is "within 24 hours", and a daily
// tick means a photo uploaded five minutes after the run waits nearly 48. Hourly makes the
// worst case 25.
//
// `?dry=1` reports what it would delete without deleting it, the same affordance
// followup-digest and medspa-credit-reminder have.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { purgeConciergePhotos } from "@/lib/concierge/purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;

/** House pattern: fails OPEN when CRON_SECRET is unset, so local dev works. */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const dry = new URL(req.url).searchParams.get("dry") === "1";

  try {
    const result = await purgeConciergePhotos(dry);

    // ‼️ LOGGED EVERY RUN, INCLUDING THE QUIET ONES. "Zero photos were due" and "the cron has
    // not executed since Tuesday" are indistinguishable from the outside, and this is the one
    // job where that difference is a legal question rather than an operational one. A row per
    // tick is what makes the difference readable after the fact.
    await supabaseAdmin
      .from("system_logs")
      .insert({
        event_type: "cron_concierge_purge",
        description: result.errors.length
          ? `purge completed with ${result.errors.length} error(s)`
          : `purged ${result.deleted} photo(s), ${result.orphansDeleted} orphan(s)`,
        metadata: { ...result },
      })
      .then(
        () => undefined,
        () => undefined
      );

    // Errors are reported in the body but the response stays 200: a partial sweep is a real
    // result, and the next tick retries whatever did not clear. A 500 here would make the
    // Vercel cron log red for a condition that heals itself in an hour.
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron/concierge-purge] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
