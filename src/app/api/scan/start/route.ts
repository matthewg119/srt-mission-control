// POST /api/scan/start — the public entry point for srtagency.com/scan.
//
// This is the ONLY unauthenticated, un-secret-gated route in the app that spends
// money: one Claude classify plus one engine call per prompt per accepted
// request. Four things stand between it and a bill, in this order, cheapest
// first:
//   1. normalizeTarget()    — junk and private hosts, no DB, no network
//   2. assertPublicHost()   — resolves DNS, because the blocklist above only
//                             sees literals and 169.254.169.254.nip.io is not one
//   3. findCachedSession()  — a domain scanned this week returns the old session
//   4. countRecentScansForIp() — hard per-IP cap
// Do not reorder them, and do not add a path that skips them.
//
// It returns a session id in ~200ms and does the slow work in waitUntil.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { runAuditPipeline } from "@/lib/audit-engine/run-audit-pipeline";
import { normalizeTarget, normalizeErrorMessage } from "@/lib/scan/normalize";
import { assertPublicHost } from "@/lib/scan/public-host";
import { supabaseAdmin } from "@/lib/db";
import {
  clientIpFrom,
  countRecentScansForIp,
  createSession,
  findCachedSession,
  hashIp,
  updateSession,
  RATE_LIMIT_PER_IP,
} from "@/lib/scan/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The cache and rate-limit reads decide whether to spend money. A cached miss spends it twice.
// See the note in status/route.ts: force-dynamic does not cover supabase-js's fetches.
export const fetchCache = "force-no-store";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: { url?: string } & Partial<Record<string, unknown>>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const normalized = normalizeTarget(body.url ?? "");
  if (!normalized.ok) {
    return NextResponse.json(
      { ok: false, error: normalized.error, message: normalizeErrorMessage(normalized.error) },
      { status: 400 }
    );
  }
  const { website, domain } = normalized.target;

  // 2. What does that name actually resolve to?
  if (!(await assertPublicHost(domain))) {
    return NextResponse.json(
      { ok: false, error: "not_public", message: normalizeErrorMessage("not_public") },
      { status: 400 }
    );
  }

  // ‼️ THE CAMPAIGN, IF THIS VISIT CARRIED ONE. Read off the body rather than the referer,
  // because the referer is the page they were on and this is about the link they clicked.
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const) {
    const v = body?.[k];
    if (typeof v === "string" && v.trim()) utm[k] = v.trim().slice(0, 120);
  }

  // 3. Already scanned recently? Hand back that run rather than paying again.
  //
  // ‼️ A CACHED HIT KEEPS THE FIRST VISIT'S CAMPAIGN AND DOES NOT TAKE THIS ONE. The report
  // already exists and already carries whoever brought it into being. Overwriting would mean the
  // last person to scan a domain claims a report somebody else's campaign produced, which is a
  // worse lie than an unattributed one. Two campaigns reaching one clinic is a real thing and
  // the honest answer is that the first one found them.
  const cached = await findCachedSession(domain);
  if (cached) {
    return NextResponse.json({ ok: true, id: cached.id, domain, cached: true });
  }

  // 4. Per-IP cap.
  const ipHash = hashIp(clientIpFrom(req));
  const recent = await countRecentScansForIp(ipHash);
  if (recent >= RATE_LIMIT_PER_IP) {
    return NextResponse.json(
      {
        ok: false,
        error: "rate_limited",
        message: `That is ${RATE_LIMIT_PER_IP} scans from this connection today. Email info@srtagency.com and we will run more by hand.`,
      },
      { status: 429 }
    );
  }

  const session = await createSession({ domain, website, ipHash });
  if (!session) {
    // The partial unique index on domain (docs/2026-08-05-scan-sessions.sql) makes a
    // concurrent duplicate fail here rather than run a second audit. Re-read: the row the
    // other request just wrote is the one this visitor wants.
    const raced = await findCachedSession(domain);
    if (raced) {
      return NextResponse.json({ ok: true, id: raced.id, domain, cached: true });
    }
    return NextResponse.json({ ok: false, error: "could_not_start" }, { status: 500 });
  }

  waitUntil(
    (async () => {
      // onError writes the SPECIFIC reason; keep it here too, because the `session`
      // object in this closure is the pre-update in-memory row whose error is always null.
      let failure: string | null = null;
      try {
        const result = await runAuditPipeline({
          website,
          leadSource: "scan",
          // Nobody is on the other end to answer a city question — proceed on
          // the best guess, same as the /audit public intake.
          allowLowConfidenceCity: true,
          // The whole stepped UI depends on this firing early. See its doc comment.
          onReportCreated: async (reportId) => {
            await updateSession(session.id, { status: "running", report_id: reportId });
            // ‼️ STAMPED HERE BECAUSE THIS IS THE FIRST MOMENT THE ROW EXISTS. The pipeline
            // owns the insert; this is the earliest hook after it. A failure is logged and
            // swallowed: an unattributed report is a reporting gap, and killing a running audit
            // over one would cost the prospect the thing they actually came for.
            if (Object.keys(utm).length) {
              const { error } = await supabaseAdmin
                .from("audit_reports")
                .update(utm)
                .eq("id", reportId);
              if (error) console.error("[scan/start] utm stamp failed:", error.message);
            }
          },
          onError: async (message) => {
            console.error("[scan/start] pipeline error:", message);
            failure = message;
            await updateSession(session.id, { status: "failed", error: message });
          },
        });

        if (!result.ok && !failure) {
          await updateSession(session.id, {
            status: "failed",
            error: "We could not read that site.",
          });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "unknown error";
        console.error("[scan/start] unhandled:", message);
        await updateSession(session.id, { status: "failed", error: message });
      }
    })()
  );

  return NextResponse.json({ ok: true, id: session.id, domain, cached: false });
}
