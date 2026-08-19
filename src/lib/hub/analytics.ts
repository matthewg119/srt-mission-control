// Reading and writing hub_hits.
//
// The WRITE is one INSERT with no lookup, because it runs on the path of every request a
// client's own visitors make and anything slower would be a tax on their site rather than
// on ours.
//
// The READS go through three Postgres functions rather than pulling rows and reducing them
// in JS, which is the house pattern everywhere else. The reason is in the migration header
// and is worth repeating: PostgREST applies a server-side row ceiling, so a raw read would
// silently return the newest N rows and draw a plausible, wrong chart. Aggregating in the
// database also makes count(distinct visitor_key) correct, which it cannot be over a
// truncated page. Everything AFTER the aggregate is folded in JS, where the house pattern
// is right.

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/db";
import type { BotClass } from "@/lib/hub/bot-classify";
import { classifyUserAgent } from "@/lib/hub/bot-classify";

export interface HitInput {
  clientId: string;
  host: string;
  kind: "hub" | "reviews";
  path: string;
  userAgent: string | null;
  /** RAW. Hashed here and never stored. */
  ip: string | null;
  referrer: string | null;
}

/**
 * The slug a path maps to. "" is the index.
 *
 * Middleware has already refused anything that is not the index or one lowercase segment
 * (HUB_SLUG), so this is a strip rather than a parse.
 */
export function slugFromPath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "").slice(0, 80);
}

/** UTC, always, and computed ONCE per hit so the hash and the column cannot disagree. */
export function hubDayKey(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/**
 * ‼️ ROTATES DAILY, BY DESIGN. The UTC date is inside the digest, so today's key cannot be
 * used to recognise the same person tomorrow. That is what makes a daily unique count
 * honest without the table becoming a visitor log. Never widen the window by hashing
 * without the date: the column would silently become a tracking id on domains SRT does not
 * own.
 *
 * NUL separators, not concatenation. Without them ("1.2.3" + "4x") and ("1.2" + "34x")
 * digest identically, which would merge two visitors into one at random.
 *
 * ‼️ ITS OWN SALT, not SCAN_IP_SALT. Rotating the /scan rate-limit ledger's salt is a
 * routine thing to do, and it must not silently re-key a year of traffic history into a
 * second population of "uniques". Same warning as that one though: the default is a
 * constant, and a constant salt is a rainbow table away from making this an IP log.
 */
function visitorKey(
  ip: string | null,
  ua: string | null,
  clientId: string,
  day: string
): string | null {
  if (!ip || ip === "unknown") return null;
  const salt = process.env.HUB_HIT_SALT ?? "srt-hub";
  return createHash("sha256")
    .update([ip, ua ?? "", clientId, day, salt].join("\u0000"))
    .digest("hex")
    .slice(0, 32);
}

/** Hostname only. A full referrer routinely carries whatever somebody typed into a search box. */
function referrerHost(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Record one request. Never throws.
 *
 * The caller is a waitUntil on a response that has already been sent, so there is nobody
 * left to tell. A failure here must cost the analytics row and nothing else.
 */
export async function recordHit(input: HitInput): Promise<void> {
  const { botClass, botName } = classifyUserAgent(input.userAgent);
  const day = hubDayKey();

  const { error } = await supabaseAdmin.from("hub_hits").insert({
    client_id: input.clientId,
    host: input.host,
    kind: input.kind,
    path: input.path,
    slug: slugFromPath(input.path),
    bot_class: botClass,
    bot_name: botName,
    // A bot is not a visitor. Hashing one would inflate uniques with crawler infrastructure
    // and put a key on rows that have no person behind them.
    visitor_key:
      botClass === "human" ? visitorKey(input.ip, input.userAgent, input.clientId, day) : null,
    referrer_host: referrerHost(input.referrer),
  });

  if (error) console.error("[hub-analytics] insert failed:", error.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export interface DayRow {
  day: string;
  human: number;
  ai_answer: number;
  ai_training: number;
  search: number;
  bot: number;
  /** Distinct daily keys. Humans only, and only meaningful for this one day. */
  uniques: number;
}

export interface PageRow {
  slug: string;
  hits: number;
  human: number;
  aiAnswer: number;
  aiTraining: number;
  search: number;
  lastAiAnswerAt: string | null;
}

export interface AgentRow {
  botClass: BotClass;
  botName: string | null;
  hits: number;
  daysSeen: number;
  lastSeen: string | null;
}

export interface HubTotals {
  hits: number;
  human: number;
  aiAnswer: number;
  aiTraining: number;
  search: number;
  uniques: number;
}

export interface HubMetrics {
  daily: DayRow[];
  pages: PageRow[];
  agents: AgentRow[];
  /** Every page's own daily series, keyed by slug. The drill-down needs no second query. */
  perPageDaily: Record<string, DayRow[]>;
  totals: HubTotals;
  /** The most recent hit of any kind, so an empty chart can be told from a dead collector. */
  lastHitAt: string | null;
}

function blankDay(day: string): DayRow {
  return { day, human: 0, ai_answer: 0, ai_training: 0, search: 0, bot: 0, uniques: 0 };
}

/**
 * Every day in the window, including the ones with nothing.
 *
 * Gaps matter. A line chart that skips empty days draws a straight run between two distant
 * points and reads as steady traffic through a week when there was none.
 */
function densify(days: number, rows: Map<string, DayRow>): DayRow[] {
  const out: DayRow[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const d = hubDayKey(new Date(now - i * 86_400_000));
    out.push(rows.get(d) ?? blankDay(d));
  }
  return out;
}

const n = (v: unknown): number => Number(v ?? 0);

export async function loadHubMetrics(clientId: string, days = 30): Promise<HubMetrics> {
  const to = hubDayKey();
  const from = hubDayKey(new Date(Date.now() - (days - 1) * 86_400_000));
  const args = { p_client_id: clientId, p_from: from, p_to: to };

  const [byDay, bySlug, byAgent] = await Promise.all([
    supabaseAdmin.rpc("hub_hits_by_day", args),
    supabaseAdmin.rpc("hub_hits_by_day_slug", args),
    supabaseAdmin.rpc("hub_hits_by_agent", args),
  ]);

  // THROW, following listPublished's doctrine rather than listAllForBoard's. A chart that
  // renders an empty series during a Supabase blip says "no AI engine has ever fetched your
  // pages", which is a finding somebody would repeat to a client on a call.
  const failed = [byDay, bySlug, byAgent].find((r) => r.error);
  if (failed?.error) {
    console.error("[hub-analytics] read failed:", failed.error.message);
    throw new Error(failed.error.message);
  }

  // ── the hub series ────────────────────────────────────────────────────────
  const dayMap = new Map<string, DayRow>();
  for (const r of (byDay.data ?? []) as Record<string, unknown>[]) {
    dayMap.set(String(r.day), {
      day: String(r.day),
      human: n(r.human),
      ai_answer: n(r.ai_answer),
      ai_training: n(r.ai_training),
      search: n(r.search),
      bot: n(r.bot),
      uniques: n(r.uniques),
    });
  }
  const daily = densify(days, dayMap);

  // ── per page: totals, and each page's own series ──────────────────────────
  const pageMap = new Map<string, PageRow>();
  const perSlugDays = new Map<string, Map<string, DayRow>>();

  for (const r of (bySlug.data ?? []) as Record<string, unknown>[]) {
    const slug = String(r.slug ?? "");
    const day = String(r.day);

    let page = pageMap.get(slug);
    if (!page) {
      page = {
        slug,
        hits: 0,
        human: 0,
        aiAnswer: 0,
        aiTraining: 0,
        search: 0,
        lastAiAnswerAt: null,
      };
      pageMap.set(slug, page);
    }

    const human = n(r.human);
    const aiAnswer = n(r.ai_answer);
    const aiTraining = n(r.ai_training);
    const search = n(r.search);
    const bot = n(r.bot);

    page.hits += human + aiAnswer + aiTraining + search + bot;
    page.human += human;
    page.aiAnswer += aiAnswer;
    page.aiTraining += aiTraining;
    page.search += search;

    const lastAi = r.last_ai_answer_at ? String(r.last_ai_answer_at) : null;
    if (lastAi && (!page.lastAiAnswerAt || lastAi > page.lastAiAnswerAt)) {
      page.lastAiAnswerAt = lastAi;
    }

    if (!perSlugDays.has(slug)) perSlugDays.set(slug, new Map());
    perSlugDays.get(slug)!.set(day, {
      day,
      human,
      ai_answer: aiAnswer,
      ai_training: aiTraining,
      search,
      bot,
      uniques: n(r.page_uniques),
    });
  }

  const perPageDaily: Record<string, DayRow[]> = {};
  for (const [slug, map] of perSlugDays) perPageDaily[slug] = densify(days, map);

  const pages = [...pageMap.values()].sort((a, b) => b.hits - a.hits);

  // ── named agents ──────────────────────────────────────────────────────────
  const agents: AgentRow[] = ((byAgent.data ?? []) as Record<string, unknown>[]).map((r) => ({
    botClass: r.bot_class as BotClass,
    botName: (r.bot_name as string | null) ?? null,
    hits: n(r.hits),
    daysSeen: n(r.days_seen),
    lastSeen: r.last_seen ? String(r.last_seen) : null,
  }));

  const totals = daily.reduce<HubTotals>(
    (acc, d) => ({
      hits: acc.hits + d.human + d.ai_answer + d.ai_training + d.search + d.bot,
      human: acc.human + d.human,
      aiAnswer: acc.aiAnswer + d.ai_answer,
      aiTraining: acc.aiTraining + d.ai_training,
      search: acc.search + d.search,
      // ‼️ Deliberately NOT a sum of the daily figures. Daily uniques cannot be added
      // across days without counting the same person once per day they returned. The
      // headline is the busiest single day, labelled as such.
      uniques: Math.max(acc.uniques, d.uniques),
    }),
    { hits: 0, human: 0, aiAnswer: 0, aiTraining: 0, search: 0, uniques: 0 }
  );

  const lastHitAt =
    agents.reduce<string | null>(
      (max, a) => (a.lastSeen && (!max || a.lastSeen > max) ? a.lastSeen : max),
      null
    ) ?? null;

  return { daily, pages, agents, perPageDaily, totals, lastHitAt };
}
