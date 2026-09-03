// Writes for the attribution stack. supabaseAdmin, server side, behind an API route.
//
// ‼️ THE RANKING IS ENFORCED BY THE SCHEMA AND BY THE SHAPE OF THESE FUNCTIONS, NOT BY CARE.
// `recordPixelBooking` takes no basis argument and hardcodes 'pixel_only'; `recordCountedBooking`
// takes only the two bases that may count. There is deliberately no single function with a
// `basis` parameter, because the moment one exists the public collector can pass 'assistant'.
// docs/2026-09-03-attribution.sql carries the other half.

import { supabaseAdmin } from "@/lib/db";
import {
  classifyReferrer,
  isAiSelfReport,
  readSelfReport,
  readUtm,
  splitLanding,
  type SelfReportSlug,
} from "./ai-domains";

/** Long enough for any real value, short enough that nobody stores a document in a column. */
const MAX_TEXT = 500;
const MAX_UA = 300;

function clip(v: string | null | undefined, max = MAX_TEXT): string | null {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

export interface ClientRef {
  id: string;
  pixel_key: string | null;
}

/**
 * Resolve the public site key to a client.
 *
 * ‼️ A MISS RETURNS null AND A DATABASE FAILURE THROWS, AND COLLAPSING THEM IS THE EXPENSIVE
 * MISTAKE. Same doctrine as resolveHost() in src/lib/hub/resolve.ts. A miss is a stale snippet
 * on some ex-client's site and deserves a quiet 204; a throw is our outage and must not be
 * recorded as "this key does not exist", because the fix for the two is not the same.
 */
export async function clientForPixelKey(key: string): Promise<ClientRef | null> {
  const k = (key ?? "").trim();
  if (!k) return null;
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("id, pixel_key")
    .eq("pixel_key", k)
    .maybeSingle();
  if (error) throw new Error(`[attribution] client lookup failed: ${error.message}`);
  return data ? (data as ClientRef) : null;
}

export interface SessionInput {
  clientId: string;
  sessionKey: string;
  href: string | null;
  referrer: string | null;
  search: string | null;
  ipHash: string | null;
  userAgent: string | null;
  testCode: string | null;
}

/**
 * Open a session, or touch the one that already exists.
 *
 * ‼️ THE FIRST TOUCH WINS AND IS NEVER OVERWRITTEN. Attribution is a statement about how a visit
 * STARTED. The second beacon of a session carries the referrer of the page they were on a moment
 * ago, which for any internal navigation is the client's own site, so an upsert that refreshed
 * these columns would turn every multi-page visit into a self-referral within seconds. Only
 * `pageviews` and `last_seen_at` move.
 */
export async function openOrTouchSession(input: SessionInput): Promise<string | null> {
  const existing = await supabaseAdmin
    .from("attribution_sessions")
    .select("id, pageviews")
    .eq("client_id", input.clientId)
    .eq("session_key", input.sessionKey)
    .maybeSingle();

  if (existing.error) {
    throw new Error(`[attribution] session read failed: ${existing.error.message}`);
  }

  if (existing.data) {
    const { error } = await supabaseAdmin
      .from("attribution_sessions")
      .update({
        pageviews: (existing.data.pageviews as number) + 1,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", existing.data.id);
    if (error) throw new Error(`[attribution] session touch failed: ${error.message}`);
    return existing.data.id as string;
  }

  const ref = classifyReferrer(input.referrer);
  const utm = readUtm(input.search);
  const landing = splitLanding(input.href);
  const testCode = clip(input.testCode, 64);

  const { data, error } = await supabaseAdmin
    .from("attribution_sessions")
    .insert({
      client_id: input.clientId,
      session_key: clip(input.sessionKey, 128),
      landing_host: clip(landing.host),
      landing_path: clip(landing.path),
      referrer_host: clip(ref.host),
      referrer_path: clip(ref.path),
      referrer_kind: ref.kind,
      ai_engine: ref.engine,
      utm_source: clip(utm.source),
      utm_medium: clip(utm.medium),
      utm_campaign: clip(utm.campaign),
      utm_content: clip(utm.content),
      utm_term: clip(utm.term),
      pageviews: 1,
      is_test: Boolean(testCode),
      test_code: testCode,
      ip_hash: input.ipHash,
      user_agent: clip(input.userAgent, MAX_UA),
    })
    .select("id")
    .maybeSingle();

  // A concurrent first beacon from the same session loses the unique index and that is a
  // success, not a failure: re-read and hand back the winner's row, the same way
  // api/scan/start resolves its own read-then-insert race into a cache hit.
  if (error) {
    const retry = await supabaseAdmin
      .from("attribution_sessions")
      .select("id")
      .eq("client_id", input.clientId)
      .eq("session_key", input.sessionKey)
      .maybeSingle();
    if (retry.data) return retry.data.id as string;
    throw new Error(`[attribution] session insert failed: ${error.message}`);
  }
  return (data?.id as string) ?? null;
}

/**
 * LAYER 1. The pixel saw a booking confirmation and nobody was asked where they came from.
 *
 * ‼️ IT TAKES NO BASIS AND IT CAN NEVER PRODUCE A QUALIFIED ROW. 'pixel_only' is written as a
 * literal here, the CHECK constraint refuses ai_evidence on it, and the generated `qualified`
 * column evaluates false regardless. Three independent locks, because this is the one write
 * path reachable from an unauthenticated public endpoint.
 */
export async function recordPixelBooking(args: {
  clientId: string;
  sessionId: string | null;
  testCode: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const testCode = clip(args.testCode, 64);
  const { error } = await supabaseAdmin.from("attribution_bookings").insert({
    client_id: args.clientId,
    session_id: args.sessionId,
    count_basis: "pixel_only",
    ai_evidence: false,
    is_test: Boolean(testCode),
    test_code: testCode,
    payload: args.payload ?? {},
  });
  if (error) throw new Error(`[attribution] pixel booking insert failed: ${error.message}`);
}

/**
 * LAYER 2 and LAYER 3. A booking somebody was actually asked about.
 *
 * ‼️ `ai_evidence` IS DERIVED FROM THE ANSWER AND IS NOT A PARAMETER. Accepting it would let a
 * caller assert AI evidence with no answer behind it, which is the pixel rule failing one layer
 * up. isAiSelfReport() is the single definition and it reads the patient's own answer.
 *
 * An `assistant` booking with no answer recorded is legal and is NOT qualified: the Concierge
 * took the booking, so attribution is certain, but the guarantee counts patients who SAID they
 * came from AI. That gap is the reason the Concierge asks the question at all.
 */
export async function recordCountedBooking(args: {
  clientId: string;
  basis: "assistant" | "self_reported";
  selfReport: string | null;
  sessionId?: string | null;
  conciergeSessionId?: string | null;
  bookedAt?: string;
  testCode?: string | null;
  payload?: Record<string, unknown>;
}): Promise<string | null> {
  const answer: SelfReportSlug | null = readSelfReport(args.selfReport);
  if (args.basis === "self_reported" && !answer) {
    throw new Error(
      "[attribution] a self_reported booking needs a recognised answer. " +
        "Record it as an assistant booking with no answer, or ask again."
    );
  }
  const testCode = clip(args.testCode ?? null, 64);
  const { data, error } = await supabaseAdmin
    .from("attribution_bookings")
    .insert({
      client_id: args.clientId,
      session_id: args.sessionId ?? null,
      concierge_session_id: args.conciergeSessionId ?? null,
      count_basis: args.basis,
      self_report: answer,
      ai_evidence: isAiSelfReport(answer),
      booked_at: args.bookedAt ?? new Date().toISOString(),
      is_test: Boolean(testCode),
      test_code: testCode,
      payload: args.payload ?? {},
    })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`[attribution] booking insert failed: ${error.message}`);
  return (data?.id as string) ?? null;
}

/**
 * The number the guarantee turns on.
 *
 * ‼️ IT READS THE GENERATED `qualified` COLUMN AND NOTHING ELSE. Not count_basis, not
 * ai_evidence, and never the session's referrer. Rebuilding this predicate by hand is the one
 * change that would quietly let a pixel row into the count.
 */
export async function countQualified(clientId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("attribution_bookings")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("qualified", true)
    .eq("is_test", false);
  if (error) throw new Error(`[attribution] qualified count failed: ${error.message}`);
  return count ?? 0;
}
