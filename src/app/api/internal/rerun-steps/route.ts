// Re-run one step, then hand the next one to a fresh request.
//
// ‼️ ONE STEP PER REQUEST, BECAUSE A RANGE DOES NOT FIT IN ONE. `rerun 18-21` re-provisions the concierge,
// rebuilds the site replica (a crawl plus a model call per page), regenerates the review card and writes the
// awareness ladder. Run in a single Slack event handler that is minutes of work behind a three second
// acknowledgement, and the 300 second ceiling would cut it off halfway with two cards posted and two not.
// Each hop does ONE step and fires the next, the same shape pre-call-pages.ts uses for its drafting waves.
//
// CRON_SECRET, and a 404 when it is wrong, same as every other internal route.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Not found", { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as
    | { clientId?: unknown; from?: unknown; to?: unknown; by?: unknown }
    | null;

  const clientId = typeof body?.clientId === "string" ? body.clientId : "";
  const from = Number(body?.from);
  const to = Number(body?.to);
  const by = typeof body?.by === "string" ? body.by.slice(0, 80) : "Mission Control";

  if (!UUID.test(clientId)) return NextResponse.json({ ok: false, error: "bad clientId" }, { status: 400 });
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
    return NextResponse.json({ ok: false, error: "bad range" }, { status: 400 });
  }

  // Answer first, work after: the caller is either Slack's three second window or the previous hop.
  waitUntil(
    (async () => {
      const { DELIVERY_STEPS, isStepKey } = await import("@/config/delivery-steps");
      const { rerunStep } = await import("@/lib/clients/step-rerun");
      const key = DELIVERY_STEPS[from - 1]?.key;
      if (!key || !isStepKey(key)) return;

      const res = await rerunStep({ clientId, stepKey: key, fresh: true, by }).catch((e) => ({
        ok: false,
        line: `${from}. ${key}: threw (${(e as Error).message}).`,
      }));
      console.log(`[rerun-steps] ${clientId} ${res.line}`);

      if (from >= to) {
        const { notifyThread } = await import("@/lib/clients/delivery-checklist");
        await notifyThread(clientId, `:repeat: Re-run finished: steps ${body?.from} to ${to} are back on the board.`).catch(() => {});
        return;
      }

      await fetch(`${appUrl()}/api/internal/rerun-steps`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ clientId, from: from + 1, to, by }),
        signal: AbortSignal.timeout(15_000),
      }).catch((e) => console.error("[rerun-steps] next hop failed:", (e as Error).message));
    })()
  );

  return NextResponse.json({ ok: true, accepted: { from, to } }, { status: 202 });
}
