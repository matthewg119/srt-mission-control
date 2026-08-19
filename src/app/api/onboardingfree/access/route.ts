// The second half of /onboardingfree: where things live and who has the keys.
//
// PUBLIC, and authorized by holding a submission id that this server issued minutes ago.
//
// ‼️ THE SUBMIT ROUTE RETURNS THE ROW ID, NEVER THE SLACK ts, AND THAT IS THE WHOLE
// SECURITY MODEL HERE. Handing a browser a real message timestamp would turn this
// endpoint into a way to post arbitrary replies into #onboarding-srt-aeo from anywhere on
// the internet. The id is an opaque uuid and the server looks the ts up itself.
//
// Answering twice is refused rather than appended, so a double tap on a slow connection
// cannot post the same block into the thread again.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { clean } from "@/lib/medspa/validate";
import { ACCESS_FIELDS } from "@/config/onboarding-free";
import { buildAccessReply } from "@/lib/onboarding-free/card";
import { ONBOARDING_FREE_EVENT } from "@/lib/onboarding-free/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A stale read of `metadata` here would look like "access already submitted" and refuse a
// legitimate first answer.
export const fetchCache = "force-no-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const submissionId = clean(body.submissionId, 64);
  // Shape-checked before it reaches the database, so a junk id costs no query.
  if (!UUID.test(submissionId)) {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const { data: row } = await supabaseAdmin
    .from("system_logs")
    .select("id, metadata")
    .eq("id", submissionId)
    .eq("event_type", ONBOARDING_FREE_EVENT)
    .maybeSingle();

  // Deliberately the same message for "no such row" and "wrong event type". Neither tells
  // a caller anything about what else is in this table.
  if (!row) {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  if (metadata.access) {
    return NextResponse.json({ ok: true, alreadySubmitted: true });
  }

  // Only the fields we asked for, at the length we asked for them.
  const rawValues = (body.values ?? {}) as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const field of ACCESS_FIELDS) {
    const value = clean(rawValues[field.key], 2000);
    if (value) values[field.key] = value;
  }

  const { error: updateError } = await supabaseAdmin
    .from("system_logs")
    .update({ metadata: { ...metadata, access: values } })
    .eq("id", submissionId);

  if (updateError) {
    console.error("[onboardingfree] access update failed", updateError.message);
    return NextResponse.json(
      { ok: false, error: "That did not save. Try once more." },
      { status: 500 }
    );
  }

  const channel = (metadata.slack_channel as string) || "";
  const threadTs = (metadata.slack_ts as string) || "";
  const reply = buildAccessReply(values);

  if (channel && threadTs) {
    try {
      await slack.postThreadReply(channel, threadTs, reply);
    } catch (e) {
      // The answers are already stored, so this is a delivery failure and not a data
      // loss. Never fail the request over it: the person filling this in can do nothing
      // useful with the error.
      console.error("[onboardingfree] access thread reply failed", e, "\n" + reply);
    }
  } else {
    console.error(
      "[onboardingfree] no Slack anchor for " + submissionId + ". Access answers:\n" + reply
    );
  }

  return NextResponse.json({ ok: true });
}
