// Draft one client-facing message on demand.
//
// AUTHENTICATED: middleware guards /dashboard/*, not /api/*, and this posts into a Slack
// channel. Same pattern as the delivery-step and time-log routes beside it.
//
// It does not send anything, here or anywhere. It posts a draft into the client's ops
// thread for a human to read and tap. See src/lib/clients/client-drafts.ts.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { draftByKey, redraft, type DraftVars } from "@/lib/clients/client-drafts";
import { DRAFT_COPY } from "@/config/client-messages";
import { dayLabel } from "@/lib/clients/report-reminders";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const draftKey = typeof body.draftKey === "string" ? body.draftKey : "";
  const def = draftByKey(draftKey);
  if (!def) {
    return NextResponse.json({ ok: false, error: "Unknown draft." }, { status: 400 });
  }

  // Free-text values the drafter fills in: the headline finding, the page URL. Only the
  // tokens this draft actually DECLARES are read, so a stray key in the request can never
  // reach a substitution the copy did not ask for.
  const declared = new Set(DRAFT_COPY[def.copyKey ?? def.key]?.tokens ?? []);
  const supplied = (body.vars ?? {}) as Record<string, unknown>;
  const vars: DraftVars = {};
  for (const [key, value] of Object.entries(supplied)) {
    if (declared.has(key) && typeof value === "string") vars[key] = value.slice(0, 2000);
  }

  // The report drafts share one piece of copy and differ by {dayLabel}, so the label is
  // derived from the key rather than trusted from the request: a client-supplied "day 30"
  // on the day-90 draft would put the wrong month in a client's hands.
  const milestone = /^report_day_(\d+)$/.exec(draftKey);
  if (milestone) vars.dayLabel = dayLabel(Number(milestone[1]));

  // redraft rather than postDraft: pressing this button means "give me this one now",
  // and the unique constraint would otherwise make the second press silently do nothing.
  // Only unsent drafts are cleared, so a message already marked sent is never reissued.
  const result = await redraft(id, draftKey, vars);

  if (!result.posted) {
    const why =
      result.reason === "no_thread"
        ? "That client has no ops thread yet, so there is nowhere to post it. It appears when they finish intake."
        : result.reason === "no_channel_env"
          ? "SLACK_CLIENT_ONBOARDING_CHANNEL is not set."
          : result.reason === "already_drafted"
            ? "That draft has already been sent, so it was left alone."
            : "That draft could not be posted.";
    return NextResponse.json({ ok: false, error: why }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
