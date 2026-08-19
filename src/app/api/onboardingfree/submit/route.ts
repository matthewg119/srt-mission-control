// The /onboardingfree constraint quiz. PUBLIC and unauthenticated.
//
// A PUBLIC ROUTE THAT POSTS TO SLACK needs its guards in the right order, cheapest first,
// exactly as api/clients/start and api/scan/start document: honeypot, then time trap, then
// per-IP ledger, then the real work. Do not reorder them and do not add a path that skips
// them.
//
// The honeypot answers 200. A bot that gets an error learns where the gap is; one that
// gets a cheerful success learns nothing.
//
// NO MIGRATION. The submission lands in `system_logs`, which already exists and already
// carries an `event_type` / `description` / `metadata` shape, and which api/leads/facebook
// already queries with `.eq("metadata->>key", value)`. That one row is three things: the
// durable copy of the answers, the per-IP rate-limit ledger, and the lookup the access
// endpoint reads its Slack thread ts back out of. The destination people actually read is
// the Slack card.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { clean, normalizePhone, validEmail } from "@/lib/medspa/validate";
import { hashIp, clientIpFrom } from "@/lib/scan/session";
import { QUESTIONS, isVisible } from "@/config/onboarding-free";
import { computeVerdict } from "@/lib/onboarding-free/verdict";
import { buildOnboardingFreeCard, describeSubmission } from "@/lib/onboarding-free/card";
import { ONBOARDING_FREE_EVENT } from "@/lib/onboarding-free/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// force-dynamic governs the ROUTE cache and does not cover supabase-js, which calls the
// global fetch that Next patches. Without this the per-IP ledger count can be read from a
// snapshot seconds old, which is the whole gate.
export const fetchCache = "force-no-store";

const RATE_LIMIT = Number(process.env.ONBOARDINGFREE_RATE_LIMIT || 5);
const RATE_WINDOW_HOURS = 24;
const MIN_FILL_SECONDS = 2;

async function countRecentForIp(ipHash: string): Promise<number> {
  const cutoff = new Date(Date.now() - RATE_WINDOW_HOURS * 3_600_000).toISOString();
  const { count } = await supabaseAdmin
    .from("system_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", ONBOARDING_FREE_EVENT)
    .eq("metadata->>ip_hash", ipHash)
    .gte("created_at", cutoff);
  return count ?? 0;
}

/**
 * Read only. This never writes a contact and never creates one.
 *
 * The card says "known lead" or "new name to us" and links the record when there is one.
 * Matching on the phone_last10 / mobile_last10 generated columns rather than an exact
 * string is what makes that work at all: one human types their number three ways.
 */
async function findExistingContact(email: string, phoneE164: string): Promise<string | null> {
  const filters: string[] = [];
  if (email) filters.push(`email.ilike.${email}`);
  const last10 = phoneE164.replace(/\D/g, "").slice(-10);
  if (last10.length === 10) {
    filters.push(`phone_last10.eq.${last10}`, `mobile_last10.eq.${last10}`);
  }
  if (!filters.length) return null;

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .or(filters.join(","))
    .order("created_at", { ascending: false })
    .limit(1);

  // A lookup failure is cosmetic here, never fatal. The card just says nothing matched.
  if (error) {
    console.error("[onboardingfree] contact lookup failed", error.message);
    return null;
  }
  return (data?.[0]?.id as string) ?? null;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  // 1. Honeypot. Silent success.
  if (clean(body.company_url_hp, 200)) {
    return NextResponse.json({ ok: true, submissionId: null });
  }

  // 2. Time trap. Nobody reads fourteen questions and answers them in under two seconds.
  const renderedAt = Number(body.renderedAt);
  if (Number.isFinite(renderedAt) && Date.now() - renderedAt < MIN_FILL_SECONDS * 1000) {
    return NextResponse.json({ ok: true, submissionId: null });
  }

  // 3. Per-IP ledger. clientIpFrom deliberately does NOT trust x-forwarded-for[0]:
  // Vercel appends the real IP, so index 0 is attacker-controlled. hashIp never stores a
  // raw address; this column is a rate-limit ledger, not a visitor log.
  const ipHash = hashIp(clientIpFrom(req));
  if ((await countRecentForIp(ipHash)) >= RATE_LIMIT) {
    return NextResponse.json(
      { ok: false, error: "That has already come through. Reply to our email instead." },
      { status: 429 }
    );
  }

  // 4. Identity.
  const rawIdentity = (body.identity ?? {}) as Record<string, unknown>;
  const business = clean(rawIdentity.business, 200);
  const name = clean(rawIdentity.name, 120);
  const email = clean(rawIdentity.email, 254).toLowerCase();
  const phoneRaw = clean(rawIdentity.phone, 40);

  if (!business || !name) {
    return NextResponse.json(
      { ok: false, error: "We need a business name and your name." },
      { status: 400 }
    );
  }
  if (!validEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "That email address does not look right." },
      { status: 400 }
    );
  }
  // Store E.164, never the raw typed string. The browser live-formats for display and
  // sends what was typed; this is the only place the stored shape is decided.
  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    return NextResponse.json(
      { ok: false, error: "That phone number does not look right." },
      { status: 400 }
    );
  }

  // 5. Answers, validated against QUESTIONS.
  //
  // Visibility is recomputed HERE from the answers rather than trusted from the client.
  // isVisible() is the same function the browser rendered from, so the two cannot
  // disagree about which questions were asked. /api/onboarding/save has the opposite
  // problem: its showWhen is client-side only, so a hidden required field 400s and the
  // client has no way past it.
  const rawAnswers = (body.answers ?? {}) as Record<string, unknown>;
  const answers: Record<string, unknown> = {};
  for (const q of QUESTIONS) {
    if (!isVisible(q, rawAnswers)) continue;
    const raw = rawAnswers[q.key];

    if (q.kind === "multichoice") {
      const picked = (Array.isArray(raw) ? raw : [])
        .filter((v): v is string => typeof v === "string")
        .filter((v) => q.options?.includes(v))
        .slice(0, 12);
      if (q.required && !picked.length) {
        return NextResponse.json(
          { ok: false, error: `Missing an answer for: ${q.title}` },
          { status: 400 }
        );
      }
      answers[q.key] = picked;
      continue;
    }

    const value = clean(raw, 600);
    // A choice answer must be one we offered. Anything else is a hand-crafted post, and
    // the verdict engine branches on these strings.
    if (q.kind === "choice" && value && !q.options?.includes(value)) {
      return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
    }
    if (q.required && !value) {
      return NextResponse.json(
        { ok: false, error: `Missing an answer for: ${q.title}` },
        { status: 400 }
      );
    }
    answers[q.key] = value;
  }

  const result = computeVerdict(answers);
  const contactId = await findExistingContact(email, phone);

  const card = buildOnboardingFreeCard({
    business,
    name,
    email,
    phone,
    answers,
    result,
    contactId,
  });

  // The row goes in BEFORE Slack, so a Slack outage cannot lose the answers. The thread
  // ts is patched on afterwards.
  const { data: row, error: insertError } = await supabaseAdmin
    .from("system_logs")
    .insert({
      event_type: ONBOARDING_FREE_EVENT,
      description: describeSubmission(business, result),
      metadata: {
        business,
        name,
        email,
        phone,
        answers,
        verdict: result.verdict,
        agrees: result.agrees,
        disagreement: result.disagreement,
        talent_side: result.talentSide,
        attribution_blind: result.attributionBlind,
        contact_id: contactId,
        ip_hash: ipHash,
      },
    })
    .select("id")
    .maybeSingle();

  if (insertError) {
    // Loud, not silent. Without the row there is no ledger, no access-screen anchor and
    // no copy of the answers, so this is worth a 500 and a retry rather than a card that
    // implies everything landed.
    console.error("[onboardingfree] insert failed", insertError.message, card);
    return NextResponse.json(
      { ok: false, error: "That did not save. Try once more." },
      { status: 500 }
    );
  }

  const submissionId = (row?.id as string) ?? null;

  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL || "";
  if (!channel) {
    // Same convention as the rest of the repo: an unset channel logs rather than throws,
    // so a missing env var never costs a submission.
    console.error("[onboardingfree] SLACK_CLIENT_ONBOARDING_CHANNEL unset. Card:\n" + card);
  } else {
    try {
      const posted = await slack.postMessage(channel, card);
      const ts = (posted as { ts?: string })?.ts;
      if (ts && submissionId) {
        // Read-modify-write rather than a jsonb merge, because `metadata` is a plain
        // column and an update with a bare object would drop the answers. Nothing else
        // touches this row between the insert above and here.
        const { data: current } = await supabaseAdmin
          .from("system_logs")
          .select("metadata")
          .eq("id", submissionId)
          .maybeSingle();
        const metadata = (current?.metadata ?? {}) as Record<string, unknown>;
        await supabaseAdmin
          .from("system_logs")
          .update({ metadata: { ...metadata, slack_ts: ts, slack_channel: channel } })
          .eq("id", submissionId);
      }
    } catch (e) {
      console.error("[onboardingfree] Slack post failed", e, "\nCard:\n" + card);
    }
  }

  return NextResponse.json({ ok: true, submissionId });
}
