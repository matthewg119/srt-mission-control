export const dynamic = "force-dynamic";

// "Scan the screen" — work out who is on the phone and hand back the brief.
//
// ‼️ THE IMAGE IS NEVER PERSISTED. It arrives in the request body, goes into one Anthropic call,
// and is dropped. Not to Supabase, not to Slack, not to a log line, not to an error report. This
// is a picture of whatever was on Matthew's screen, which includes his inbox and his CRM and
// occasionally his bank. When this misreads something the first instinct will be "save the
// screenshot so I can see what the model saw"; log `bytes` and `displaySurface` instead.
//
// The vision call is also SKIPPED whenever the Chrome tab URL already yields a record id, which is
// the common case because the CRM tab is open. That ordering is what makes wrong-lead risk
// manageable: the cheapest path is also the one that cannot be misread.

import { NextRequest, NextResponse } from "next/server";
import { extractApiKey, validateCallCoachKey } from "@/lib/call-coach-auth";
import { identifyFromScreenshot } from "@/lib/call-coach/identify-lead";
import { resolveCallTarget, attachContactId, autoCommits, whoLine } from "@/lib/call-coach/resolve-target";
import { parseZohoRecordUrl } from "@/lib/call-coach/zoho-url";
import { buildCallBrief } from "@/lib/call-coach/brief";
import { attachIdentityToSession, createPendingSession } from "@/lib/call-coach/session";

/** ~1.5MB of base64 is a 1568px JPEG at q0.7 with room to spare. Anything larger is a bug. */
const MAX_IMAGE_CHARS = 2_000_000;

export async function POST(req: NextRequest) {
  const key = extractApiKey(req);
  const user = key ? await validateCallCoachKey(key) : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    image?: { media_type?: string; data?: string };
    tabUrl?: string;
    displaySurface?: string;
    sessionId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const tabUrl = typeof body.tabUrl === "string" ? body.tabUrl : null;
  const tabRef = parseZohoRecordUrl(tabUrl);

  // Deliberately not `body.image?.data?.length` in a log line either.
  const rawImage = body.image?.data;
  if (rawImage && rawImage.length > MAX_IMAGE_CHARS) {
    return NextResponse.json({ error: "image_too_large" }, { status: 413 });
  }

  console.log(
    `[call-coach/identify] user=${user.name} surface=${body.displaySurface ?? "?"} ` +
      `tabUrlMatched=${Boolean(tabRef)} imageBytes=${rawImage ? Math.round((rawImage.length * 3) / 4) : 0}`
  );

  try {
    // The vision call costs money and can be wrong. Skip it entirely when Chrome already told us.
    const read =
      !tabRef && rawImage
        ? await identifyFromScreenshot({
            media_type: (body.image?.media_type ?? "image/jpeg").split(";")[0],
            data: rawImage,
          })
        : null;

    const resolved = await resolveCallTarget({ read, tabUrl });

    if (!resolved.chosen || !autoCommits(resolved.confidence)) {
      // Nothing loads. The coach shows a confirm strip and one tap fixes it, which is a far better
      // ending than silently coaching him about the wrong company for forty minutes.
      return NextResponse.json({
        ok: true,
        committed: false,
        confidence: resolved.confidence,
        notes: resolved.notes,
        candidates: resolved.candidates.map((c) => ({
          module: c.module,
          recordId: c.recordId,
          label: whoLine(c),
          zohoUrl: c.zohoUrl,
        })),
      });
    }

    const target = await attachContactId(resolved.chosen);
    const brief = await buildCallBrief(target);

    const sessionId =
      typeof body.sessionId === "string" && body.sessionId
        ? (await attachIdentityToSession(body.sessionId, target, brief, resolved.confidence), body.sessionId)
        : await createPendingSession(user.id, target, brief, resolved.confidence);

    return NextResponse.json({
      ok: true,
      committed: true,
      confidence: resolved.confidence,
      notes: resolved.notes,
      sessionId,
      callType: brief.callType,
      hasAudit: brief.hasAudit,
      who: {
        module: target.module,
        recordId: target.recordId,
        label: whoLine(target),
        zohoUrl: target.zohoUrl,
        businessName: target.businessName,
        personName: target.personName,
      },
      briefText: brief.text,
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error("[call-coach/identify] failed:", msg);
    return NextResponse.json({ error: "identify_failed", detail: msg }, { status: 500 });
  }
}
