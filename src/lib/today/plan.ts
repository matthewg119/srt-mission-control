// The day, assembled: four sources, one ordering, nothing written but the pin.
//
// ‼️ IT MUST NEVER BECOME A SECOND BOARD, and that is the line this file is most careful about.
// Every delivery row links to the Slack card that owns it, completing work still happens there, and
// the only table written here is day_plan_order. ops-index.ts records the same rule for the pinned
// header it replaced: "A pinned message that started offering work would be an ungated surface
// dumping the whole backlog, which is precisely what the step board replaced."
//
// ‼️ IT NEVER CALLS reachableCursor(), ensureReachableAnchors(), runReadyAutoSteps() OR postReadySteps().
// The first of those WRITES: it re-seeds missing step rows, which is why lead-context.ts refuses to
// call it and says so in its header. A page render that quietly repairs boards is a page render that
// cannot be refreshed safely. `unblocks` comes from DELIVERY_STEPS[].blockedBy, pure config.
//
// ‼️ IT DOES NOT CALL buildWorklist(). That pages roughly 8,300 contacts in nine round trips behind
// CANDIDATE_CAP, which is most of a chat turn's budget before anything has been said. Today reads
// lead_tasks directly: small, indexed, and already the thing the follow-up lane writes.
//
// ‼️ A SOURCE THAT CANNOT BE READ IS NAMED, NEVER SWALLOWED. An empty day and a broken read look
// identical on screen, and only one of them means there is nothing to do.

import { supabaseAdmin } from "@/lib/db";
import { businessDayKey } from "@/lib/business-time";
import { bucketFor } from "@/lib/task-feed";
import { DELIVERY_STEPS, isStepKey, stepNumber, type StepKey } from "@/config/delivery-steps";
import { STEP_ACTIONS } from "@/lib/clients/do-this-now";
import {
  EFFORT_BY_SOURCE,
  EFFORT_BY_VERB,
  ROLE_LABEL,
  ROLE_ORDER,
  isOwnerWork,
  roleForStep,
  type DayRole,
} from "@/config/roles";
import {
  followupKeyFor,
  groupByRole,
  pageKeyFor,
  stepKeyFor,
  type DayItem,
  type DayPlan,
} from "./item";
import { newClientBonus, scoreFollowup, scorePage, scoreStep, unblockCount } from "./score";

/** Named in the banner when the ordering table is absent. */
const DAY_PLAN_SQL = "docs/2026-09-26-day-plan.sql";

/** Live clients only. `churned` and `waitlist` are not today's work. */
const LIVE_BILLING = ["pilot", "active"] as const;

function missingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    err.code === "42703" ||
    /does not exist|schema cache/i.test(err.message ?? "")
  );
}

/** A Slack permalink built from the ids the board already stores. */
function slackLink(channelId: string | null, ts: string | null): string | null {
  if (!channelId || !ts) return null;
  return `https://slack.com/app_redirect?channel=${channelId}&message_ts=${ts}`;
}

const stepLabel = (key: string): string => DELIVERY_STEPS.find((s) => s.key === key)?.label ?? key;

// ─────────────────────────────────────────────────────────────────────────────
// The pins
// ─────────────────────────────────────────────────────────────────────────────

interface Pin {
  role: DayRole | null;
  position: number;
  deferredUntil: string | null;
}

async function loadPins(planDay: string): Promise<{ pins: Map<string, Pin>; available: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("day_plan_order")
    .select("item_key, role, position, deferred_until")
    .eq("plan_day", planDay);

  if (error) {
    if (!missingTable(error)) console.error("[today/plan] pins unreadable:", error.message);
    return { pins: new Map(), available: false };
  }

  const pins = new Map<string, Pin>();
  for (const r of data ?? []) {
    pins.set(r.item_key as string, {
      role: (r.role as DayRole) ?? null,
      position: Number(r.position ?? 0),
      deferredUntil: (r.deferred_until as string | null) ?? null,
    });
  }
  return { pins, available: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// The four adapters
// ─────────────────────────────────────────────────────────────────────────────

async function deliverySteps(now: number): Promise<{ items: DayItem[]; unreadable: string | null }> {
  const { openStepWork } = await import("@/lib/clients/step-engine");
  const rows = await openStepWork().catch(() => null);
  if (!rows) return { items: [], unreadable: "the delivery board" };

  const items: DayItem[] = [];
  for (const r of rows) {
    if (!isStepKey(r.stepKey) || !isOwnerWork(r.status)) continue;
    const key = r.stepKey as StepKey;
    const n = stepNumber(key);
    const unblocks = unblockCount(key);
    const scored = scoreStep({
      status: r.status,
      updatedAt: r.updatedAt,
      errorDetail: r.errorDetail,
      stepLabel: stepLabel(key),
      stepNumber: n,
      unblocks,
      now,
    });

    const verb = STEP_ACTIONS[key]?.verb ?? "decide";
    const permalink = slackLink(r.slackChannelId, r.slackMessageTs);

    items.push({
      key: stepKeyFor(r.clientId, key),
      source: "delivery_step",
      role: roleForStep(key),
      title: `${r.clientName}: ${stepLabel(key)}`,
      detail: scored.reasons[0] ?? null,
      href: permalink ?? `/dashboard/clients/${r.clientId}`,
      slackPermalink: permalink,
      clientId: r.clientId,
      clientName: r.clientName,
      priority: r.status === "error" ? "urgent" : "high",
      status: "open",
      // A step has no due date. bucketFor(null) puts it in `no_date`, which is honest.
      dueAt: null,
      createdAt: r.updatedAt,
      bucket: bucketFor(null),
      effortMinutes: EFFORT_BY_VERB[verb],
      unblocks,
      score: scored.score,
      reasons: scored.reasons,
      pinnedRank: null,
      deferredUntil: null,
      typeLabel: `step ${n}`,
    });
  }
  return { items, unreadable: null };
}

async function pagesToWrite(now: number): Promise<{ items: DayItem[]; unreadable: string | null }> {
  const { data, error } = await supabaseAdmin
    .from("page_plan")
    .select("id, client_id, working_title, target_keyword, approved_at, clients!inner(legal_name, dba_name, billing_status)")
    .eq("status", "approved")
    .is("page_id", null)
    .order("approved_at", { ascending: true })
    .limit(200);

  if (error) return { items: [], unreadable: "the page plan" };

  // claimed_at rides in its own select: it arrived with docs/2026-09-26-day-plan.sql and a database
  // without it must still render the rest of the day.
  const claimed = new Map<string, string | null>();
  const extra = await supabaseAdmin.from("page_plan").select("id, claimed_at").eq("status", "approved").limit(400);
  if (!extra.error) for (const r of extra.data ?? []) claimed.set(r.id as string, (r.claimed_at as string) ?? null);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    client_id: string;
    working_title: string;
    target_keyword: string;
    approved_at: string | null;
    clients: { legal_name: string; dba_name: string | null; billing_status: string | null };
  }>;

  const items: DayItem[] = [];
  for (const r of rows) {
    if (!LIVE_BILLING.includes((r.clients.billing_status ?? "") as (typeof LIVE_BILLING)[number])) continue;
    const name = r.clients.dba_name || r.clients.legal_name;
    const scored = scorePage({ approvedAt: r.approved_at, claimedAt: claimed.get(r.id) ?? null, now });

    items.push({
      key: pageKeyFor(r.id),
      source: "page_write",
      role: "writer",
      title: `${name}: ${r.working_title}`,
      detail: `Aimed at "${r.target_keyword}". ${scored.reasons[scored.reasons.length - 1] ?? ""}`.trim(),
      href: `/dashboard/clients/${r.client_id}/plan`,
      slackPermalink: null,
      clientId: r.client_id,
      clientName: name,
      priority: "medium",
      status: "open",
      dueAt: null,
      createdAt: r.approved_at ?? new Date(now).toISOString(),
      bucket: bucketFor(null),
      effortMinutes: EFFORT_BY_SOURCE.page_write,
      unblocks: 0,
      score: scored.score,
      reasons: scored.reasons,
      pinnedRank: null,
      deferredUntil: null,
      typeLabel: "page",
    });
  }
  return { items, unreadable: null };
}

async function followups(now: number): Promise<{ items: DayItem[]; unreadable: string | null }> {
  const { data, error } = await supabaseAdmin
    .from("lead_tasks")
    .select("id, title, description, priority, due_at, created_at, contacts!inner(id, first_name, last_name, business_name, do_not_contact)")
    .eq("status", "open")
    .order("due_at", { ascending: true, nullsFirst: true })
    .limit(150);

  if (error) return { items: [], unreadable: "the follow-up tasks" };

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    title: string;
    description: string | null;
    priority: string | null;
    due_at: string | null;
    created_at: string;
    contacts: { id: string; first_name: string | null; last_name: string | null; business_name: string | null; do_not_contact: boolean | null };
  }>;

  const items: DayItem[] = [];
  for (const r of rows) {
    // ‼️ do_not_contact IS A DECISION, NOT A FILTER TO SKIP. Surfacing one on a day plan is how
    // somebody rings a person who asked not to be rung.
    if (r.contacts.do_not_contact) continue;

    const who =
      r.contacts.business_name ||
      [r.contacts.first_name, r.contacts.last_name].filter(Boolean).join(" ") ||
      "a lead";
    const priority = r.priority === "high" ? "high" : r.priority === "low" ? "low" : "medium";
    const scored = scoreFollowup({ dueAt: r.due_at, now, priority });

    items.push({
      key: followupKeyFor(r.id),
      source: "followup",
      role: "outreach",
      title: `${who}: ${r.title}`,
      detail: r.description?.trim() || scored.reasons[0] || null,
      href: `/dashboard/leads/${r.contacts.id}`,
      slackPermalink: null,
      clientId: null,
      clientName: null,
      priority,
      status: "open",
      dueAt: r.due_at,
      createdAt: r.created_at,
      bucket: bucketFor(r.due_at),
      effortMinutes: EFFORT_BY_SOURCE.followup,
      unblocks: 0,
      score: scored.score,
      reasons: scored.reasons,
      pinnedRank: null,
      deferredUntil: null,
      typeLabel: "follow-up",
    });
  }
  return { items, unreadable: null };
}

/**
 * ‼️ `tasks` IS DELIBERATELY NOT A SOURCE YET, AND THIS FUNCTION IS THE PLACEHOLDER THAT SAYS SO.
 *
 * Three reasons, and they compound. The table may not exist in production at all (only
 * docs/supabase-tasks-table.sql, which is not a dated migration, and /api/tasks guards with
 * isMissingTable). `assignee` defaults to the literal string "Matthew", so it cannot filter
 * anything. And `department` is written by the BrainHeart AI pulse and never read back, so it is a
 * model's guess nobody has ever checked.
 *
 * A model-authored free-text inbox is the one source that can put a funding task on a page whose
 * whole promise is that funding work is gone. When it joins, it joins behind an allowlist of `type`
 * values, never `department` and never `assignee`.
 */
async function opsTasks(): Promise<{ items: DayItem[]; unreadable: string | null }> {
  return { items: [], unreadable: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// The plan
// ─────────────────────────────────────────────────────────────────────────────

export async function buildDayPlan(opts: { now?: Date } = {}): Promise<DayPlan> {
  const now = (opts.now ?? new Date()).getTime();
  const planDay = businessDayKey(opts.now ?? new Date());

  const [steps, pages, follow, ops, pinned] = await Promise.all([
    deliverySteps(now),
    pagesToWrite(now),
    followups(now),
    opsTasks(),
    loadPins(planDay),
  ]);

  const unreadable = [steps.unreadable, pages.unreadable, follow.unreadable, ops.unreadable].filter(
    (s): s is string => Boolean(s)
  );

  const items = [...steps.items, ...pages.items, ...follow.items, ...ops.items];

  // A client inside their first month is worth a nudge: the work compounds.
  const dayZero = await dayZeroByClient(items).catch(() => new Map<string, string>());
  for (const item of items) {
    if (!item.clientId) continue;
    const bonus = newClientBonus(dayZero.get(item.clientId) ?? null, now);
    item.score += bonus.score;
    item.reasons.push(...bonus.reasons);
  }

  // ‼️ THE PIN CAN MOVE AN ITEM BETWEEN LANES. "This page write is really today's onboarding
  // blocker" is a real thing to decide, and day_plan_order.role is denormalised so that the decision
  // survives a change to STEP_ROLE in config/roles.ts.
  for (const item of items) {
    const pin = pinned.pins.get(item.key);
    if (!pin) continue;
    item.pinnedRank = pin.position;
    item.deferredUntil = pin.deferredUntil;
    if (pin.role) item.role = pin.role;
  }

  const { groups, later } = groupByRole(items, ROLE_ORDER, ROLE_LABEL);

  return {
    planDay,
    groups,
    later,
    estMinutes: groups.reduce((n, g) => n + g.estMinutes, 0),
    ...(pinned.available ? {} : { orderingUnavailable: true }),
    unreadable,
  };
}

/** Day 0 per client, for the first-month bonus. One read, only for the clients on the plan. */
async function dayZeroByClient(items: readonly DayItem[]): Promise<Map<string, string>> {
  const ids = [...new Set(items.map((i) => i.clientId).filter((v): v is string => Boolean(v)))];
  if (!ids.length) return new Map();

  const { data, error } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("client_id, completed_at")
    .eq("step_key", "day_zero_archive")
    .eq("status", "complete")
    .in("client_id", ids);
  if (error) return new Map();

  const out = new Map<string, string>();
  for (const r of data ?? []) {
    if (r.completed_at) out.set(r.client_id as string, r.completed_at as string);
  }
  return out;
}

/** The banner text when the ordering table has not been created. */
export function orderingBanner(): string {
  return `Drag is off until \`${DAY_PLAN_SQL}\` is run on this database. Everything below is in computed order.`;
}
