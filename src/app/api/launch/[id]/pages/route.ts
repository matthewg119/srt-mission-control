// The page run for a Launch Lane client: plan, approve, headlines, skeletons, research, draft,
// publish. One GET for the state and one POST per decision.
//
// ‼️ THIS IS THE DOOR THAT REPLACES A SLACK THREAD, which is the whole reason it exists. Everything
// it calls lives in src/lib/launch/pages.ts and posts nothing anywhere.
//
// ‼️ maxDuration = 300 AND THAT IS LOAD-BEARING. One drafting wave budgets 240 seconds
// (WAVE_BUDGET_MS in pre-call-pages.ts) and the headline pass is one model call per page. The
// precedent is api/clients/[id]/delivery-step, which awaits the deepest cascade in the app at 300.
//
// ‼️ THE REFUSALS ARE PASSED THROUGH WHOLE AND THE STATUS CODES ARE NOT INTERCHANGEABLE, the same
// way api/clients/[id]/hub does it: a destination refusal is a QUESTION (400, with the choices
// attached) while Day 0 and the quality gate are RAILS (409). A 409 tells the surface something is
// wrong and the page must not go live; a 400 tells it to ask which domain.
//
// ‼️ NO WAIVE ACTION ON THIS ROUTE. The Day-0 wall's rule is that the waiver is offered only after a
// publish has been refused and needs a reason a button cannot carry. It stays on the client page.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import {
  isLaunchPageAction,
  launchPagesState,
  runLaunchPagesAction,
} from "@/lib/launch/pages";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;

/**
 * Middleware guards /dashboard/*, not /api/*, so every route in this lane re-checks. The lane check
 * is here as well as the auth one: this writes pages under a client's own name, and a Slack-lane
 * client reaching it would be driven by a board whose verifiers know nothing about these steps.
 */
async function guard(
  id: string
): Promise<{ ok: true; actor: string } | { ok: false; res: NextResponse }> {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return {
      ok: false,
      res: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, onboarding_lane")
    .eq("id", id)
    .maybeSingle();

  if (!client) {
    return { ok: false, res: NextResponse.json({ ok: false, error: "No such client." }, { status: 404 }) };
  }
  if (client.onboarding_lane !== "launch") {
    return {
      ok: false,
      res: NextResponse.json(
        { ok: false, error: "That client is on the Slack delivery lane, not the Launch Lane." },
        { status: 400 }
      ),
    };
  }

  return { ok: true, actor: session.user.name ?? session.user.email ?? "the dashboard" };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if (!g.ok) return g.res;

  const state = await launchPagesState(id);
  if ("error" in state) return NextResponse.json({ ok: false, error: state.error }, { status: 500 });
  return NextResponse.json({ ok: true, state });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if (!g.ok) return g.res;

  let body: {
    action?: unknown;
    rank?: unknown;
    pick?: unknown;
    stage?: unknown;
    text?: unknown;
    pageId?: unknown;
    destinationId?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (!isLaunchPageAction(action)) {
    return NextResponse.json({ ok: false, error: `"${action}" is not a page action.` }, { status: 400 });
  }

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;

  const result = await runLaunchPagesAction({
    clientId: id,
    action,
    actor: g.actor,
    rank: num(body.rank),
    pick: num(body.pick),
    stage: num(body.stage),
    // The research paste is the long one; everything else here is a title or a sentence. Capped so
    // a runaway paste cannot become a row nothing can read back.
    text: typeof body.text === "string" ? body.text.slice(0, 200_000) : null,
    pageId: typeof body.pageId === "string" ? body.pageId : null,
    destinationId: typeof body.destinationId === "string" ? body.destinationId : null,
  });

  if (!result.ok) {
    const refusal = result.refusal;
    if (refusal?.blockedBy === "destination") {
      return NextResponse.json(
        { ok: false, error: refusal.error, blockedBy: "destination", choices: refusal.choices },
        { status: 400 }
      );
    }
    if (refusal?.blockedBy === "day_0") {
      return NextResponse.json(
        { ok: false, error: refusal.error, blockedBy: "day_0", stepKey: refusal.stepKey },
        { status: 409 }
      );
    }
    if (refusal?.blockedBy === "quality_gate") {
      return NextResponse.json(
        {
          ok: false,
          error: refusal.error,
          blockedBy: "quality_gate",
          gateReason: refusal.gateReason,
          checks: refusal.checks,
        },
        { status: 409 }
      );
    }
    // Everything else is a stage refusal: work that is owed, in the words the engine used.
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  // The fresh state rides back with the result so the panel never renders a message against a board
  // it has not re-read. Same reason the hub route returns `pages` from a publish.
  const state = await launchPagesState(id);
  return NextResponse.json({
    ok: true,
    message: result.message,
    prompt: result.prompt ?? null,
    pageUrl: result.pageUrl ?? null,
    remaining: result.remaining ?? null,
    state: "error" in state ? null : state,
  });
}
