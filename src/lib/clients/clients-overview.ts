// Every client, shaped for the card that shows one. Four reads plus one index seek per client.
//
// ‼️ BOTH LANES, AND THAT REVERSES THE CALL MADE EARLIER TODAY. The first cut filtered to the Slack
// lane, citing dashboard/launch/page.tsx: "A SEPARATE PAGE FROM /dashboard/clients, NOT A FILTER ON
// IT." Matthew opened the page and asked the obvious question: "not sure why i cant see srt agency
// in clients?" He was right and the filter was wrong. That header is about the BOARD PANELS, which
// are worked differently and would need a lane branch in each; a LIST of who the clients are is not
// a panel, and a clients page that hides clients is answering a question nobody asked.
//
// What is kept from that rule: this file reads the launch lane's CONFIG and its SHARED TABLE and
// nothing else. No step engine, no step-board, no launch lib. It cannot tick, verify, advance or
// refuse anything on either board, which is the same shape lane-summary.ts calls a read-only
// bridge. /dashboard/launch stays exactly as it is, and each row carries its own lane's
// denominator, because 9 of 16 and 9 of 37 are different facts.
//
// ‼️ ONE QUERY PER TABLE, NOT ONE PER CLIENT. The idiom is dashboard/launch/page.tsx: read the
// clients, read every step row with .in("client_id", ids), aggregate into a Map in JS.
// slackLaneSummary() has exactly the right semantics but costs a round trip per client, and this
// page draws all of them at once.

import { supabaseAdmin } from "@/lib/db";
import { DELIVERY_STEPS, stepNumber, type StepKey } from "@/config/delivery-steps";
import { LAUNCH_STEPS, launchStepNumber, type LaunchStepKey } from "@/config/launch-steps";
import { isOwnerWork } from "@/config/roles";
import {
  clientHealth,
  daysSince,
  moneyLine,
  owedNext,
  quietLine,
  stageLabel,
  type ClientFacts,
  type ClientHealth,
  type OpenStepFacts,
} from "./client-health";

export type Lane = "slack" | "launch";

export interface ClientOverviewRow {
  id: string;
  href: string;
  name: string;
  /** Website, town, and the one legacy Slack channel. The small grey line under the name. */
  meta: string[];
  stage: string;
  money: string;
  owed: string;
  quiet: string;
  /** Kept as a number because the sort needs it. The card renders `quiet`. */
  quietDays: number;
  /** Which board this client is worked on. Shown on the row, and filterable. */
  lane: Lane;
  settled: number;
  /** ‼️ THIS CLIENT'S OWN ROW COUNT. The progress bar's denominator. Never the config's length. */
  total: number;
  /** This client's OWN lane's board length today, for the hover title and nothing else. */
  boardLength: number;
  /** 0 to 100, rounded once here so the card does no arithmetic. */
  percent: number;
  health: ClientHealth;
  /** Everything the search box matches on, lower-cased once here rather than on every keystroke. */
  haystack: string;
}

export interface ClientsOverview {
  rows: ClientOverviewRow[];
  /**
   * ‼️ SAID OUT LOUD RATHER THAN RENDERED AS AN EMPTY LIST. An outage that reads as "no clients
   * yet" on this page is how somebody opens a second client for a business that already has one.
   */
  error: string | null;
}

const RESOLVED = new Set(["complete", "skipped"]);

interface StepRow {
  client_id: string;
  step_key: string;
  status: string;
  updated_at: string | null;
  error_detail: string | null;
}

export async function clientsOverview(now: number = Date.now()): Promise<ClientsOverview> {
  // ── READ 1: the clients. Both lanes in one query, partitioned below, so the launch count is free.
  //
  // ‼️ ONE STRING LITERAL, HOWEVER LONG. A concatenated select list makes supabase-js give up
  // inferring a row type and hand back GenericStringError, at which point every field access below
  // is a type error on a query that works perfectly. client-reads.ts carries the same scar.
  const { data: clientData, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select(
      "id, slug, legal_name, dba_name, website, city, state, email, billing_status, onboarding_status, onboarding_lane, market_conflict, pilot_ends_at, slack_channel_name, created_at"
    )
    .order("created_at", { ascending: false });

  if (clientErr) {
    return { rows: [], error: `the client list could not be read: ${clientErr.message}` };
  }

  // Read as plain records, the way client-reads.ts does it. Going through `unknown` also means
  // adding a column to that select later cannot tip it over the inference wall.
  const clients = (clientData ?? []) as unknown as Record<string, unknown>[];
  if (clients.length === 0) return { rows: [], error: null };

  // onboarding_lane defaults to 'slack' and may be null on a row older than that column. Anything
  // that is not literally "launch" is worked on the Slack board, which is the honest reading and
  // also the one that cannot make a client disappear off this page.
  const laneOf = (c: Record<string, unknown>): Lane =>
    c.onboarding_lane === "launch" ? "launch" : "slack";

  const slackIds = clients.filter((c) => laneOf(c) === "slack").map((c) => String(c.id));
  const launchIds = clients.filter((c) => laneOf(c) === "launch").map((c) => String(c.id));

  // ── READS 2 AND 3: both boards, one query each. status, updated_at and error_detail together, so
  // the open step, the stall clock and the error reason all come off the same read.
  //
  // ‼️ LOUD, NOT SILENT, AND THIS IS THE OPPOSITE CHOICE FROM lane-summary.ts ON PURPOSE. There, a
  // failed read omits one sentence from a chat answer. Here it would tell the page that every
  // client has no delivery board, which is a confident wrong answer about all of them at once.
  const [slackRead, launchRead] = await Promise.all([
    slackIds.length
      ? supabaseAdmin
          .from("client_delivery_steps")
          .select("client_id, step_key, status, updated_at, error_detail")
          .in("client_id", slackIds)
      : Promise.resolve({ data: [], error: null }),
    launchIds.length
      ? supabaseAdmin
          .from("client_launch_steps")
          .select("client_id, step_key, status, updated_at, error_detail")
          .in("client_id", launchIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (slackRead.error) {
    return { rows: [], error: `the delivery boards could not be read: ${slackRead.error.message}` };
  }
  if (launchRead.error) {
    return { rows: [], error: `the launch boards could not be read: ${launchRead.error.message}` };
  }

  const boards = byClient([
    ...((slackRead.data ?? []) as unknown as StepRow[]),
    ...((launchRead.data ?? []) as unknown as StepRow[]),
  ]);

  const ids = clients.map((c) => String(c.id));

  // ── READS 3..N+2: the last event per client, issued together.
  //
  // ‼️ ONE SEEK PER CLIENT, AND IT IS THE RIGHT TRADE RATHER THAN A SHORTCUT. PostgREST cannot do
  // MAX or GROUP BY, so the batched alternative is a time-boxed .in() read ordered desc, whose
  // correctness then depends on a server row cap nothing in this repo asserts: truncation drops the
  // OLDEST rows, so an already-quiet client falls out of the result entirely and lands in the
  // "nothing logged" fallback, which can promote it to At risk with a number nobody can reproduce.
  // A pill that cannot be explained is the one thing this rule cannot afford. Each read here is a
  // one-row index seek on client_events (client_id, created_at desc), Promise.all makes them one
  // round trip of wall clock, and the page already renders every client with no pagination, so it
  // is O(N) three times over already. When N stops being small the answer is a view doing
  // max(created_at) group by client_id, and this block swaps for it.
  const lastSeen = new Map<string, string | null>(
    await Promise.all(
      ids.map(async (id): Promise<[string, string | null]> => {
        const { data } = await supabaseAdmin
          .from("client_events")
          .select("created_at")
          .eq("client_id", id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return [id, (data?.created_at as string | undefined) ?? null];
      })
    )
  );

  const rows: ClientOverviewRow[] = clients.map((c) => {
    const id = String(c.id);
    const lane = laneOf(c);
    const board = boardFacts(boards.get(id), lane, now);

    // No events at all falls back to when the client was opened. A client opened three weeks ago
    // with nothing logged is not "quiet for 0 days", and quietFrom keeps the copy honest about
    // which of the two clocks produced the number.
    const lastEventAt = lastSeen.get(id) ?? null;
    const quietFrom: "event" | "opened" = lastEventAt ? "event" : "opened";
    const quietDays = daysSince(lastEventAt ?? String(c.created_at), now);

    const facts: ClientFacts = {
      billingStatus: (c.billing_status as string | null) ?? null,
      onboardingStatus: (c.onboarding_status as string | null) ?? null,
      marketConflict: c.market_conflict === true,
      quietDays,
      quietFrom,
      boardPresent: board.present,
      settled: board.settled,
      total: board.total,
      openStep: board.openStep,
      erroredStep: board.erroredStep,
      ownerWorkCount: board.ownerWorkCount,
    };

    const where = [c.city, c.state].filter(Boolean).join(", ");
    const name = (c.dba_name as string) || (c.legal_name as string) || String(c.slug ?? id);
    const meta = [
      (c.website as string | null) ?? null,
      where || null,
      // Legacy. Per-client Slack channels were retired on 2026-08-20 in favour of ops_channel_id,
      // and this renders for the one client provisioned before that, so the record that the
      // channel existed is not quietly lost in a redesign.
      c.slack_channel_name ? `#${String(c.slack_channel_name)} (legacy Slack)` : null,
    ].filter((x): x is string => Boolean(x));

    const stage = stageLabel((c.onboarding_status as string | null) ?? null);
    const owed = owedNext(facts);
    const health = clientHealth(facts);

    return {
      id,
      href: `/dashboard/clients/${id}`,
      name,
      meta,
      stage,
      money: moneyLine(facts.billingStatus, (c.pilot_ends_at as string | null) ?? null, now),
      owed,
      quiet: quietLine(quietDays, quietFrom),
      quietDays,
      lane,
      settled: board.settled,
      total: board.total,
      boardLength: lane === "launch" ? LAUNCH_STEPS.length : DELIVERY_STEPS.length,
      percent: board.total === 0 ? 0 : Math.round((board.settled / board.total) * 100),
      health,
      // ‼️ BUILT HERE, NOT IN THE SEARCH BOX. Typing filters on every keystroke, and lower-casing
      // six fields per row per stroke is work done over and over for an answer that never changes.
      // The slug and the legal name are in here but not on the card, because somebody searching
      // "srt-agency" or an LLC name should still find the row.
      haystack: [name, ...meta, stage, owed, health.reason, lane, c.slug, c.legal_name, c.email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    };
  });

  // ‼️ WORST FIRST, THEN QUIETEST. One large card per client means four or five are above the fold,
  // so the fold IS the ranking: putting the newest client there instead of the errored one wastes
  // the only thing this layout has over a one-line list. Array.sort is stable, so the clients query's
  // created_at desc survives as the final tiebreak and nothing about today's ordering is lost.
  rows.sort(
    (a, b) => LEVEL_ORDER[a.health.level] - LEVEL_ORDER[b.health.level] || b.quietDays - a.quietDays
  );

  return { rows, error: null };
}

const LEVEL_ORDER: Record<ClientHealth["level"], number> = { risk: 0, watch: 1, good: 2, closed: 3 };

/** client_id to step_key to row, in one pass over the flat result. */
function byClient(rows: StepRow[]): Map<string, Map<string, StepRow>> {
  const out = new Map<string, Map<string, StepRow>>();
  for (const r of rows) {
    const id = String(r.client_id);
    let inner = out.get(id);
    if (!inner) {
      inner = new Map<string, StepRow>();
      out.set(id, inner);
    }
    inner.set(String(r.step_key), r);
  }
  return out;
}

interface BoardFacts {
  present: boolean;
  settled: number;
  total: number;
  openStep: OpenStepFacts | null;
  erroredStep: OpenStepFacts | null;
  ownerWorkCount: number;
}

/**
 * One client's board, walked in DELIVERY_STEPS order, with slackLaneSummary()'s semantics: settled
 * is complete plus skipped, and openStep is the FIRST unsettled step in CONFIG order rather than
 * the first row the database happened to return.
 *
 * ‼️ `total` IS NOT THE BOARD'S LENGTH. It is how many of THIS client's rows still match a step the
 * config lists, so a client seeded before a step was retired reads lower, which is the honest
 * figure and the one a progress bar should divide by. lane-summary.ts says the same in the same
 * words, and the board has been 43, then 41, then 37.
 *
 * ‼️ A ROW WHOSE KEY THE CONFIG NO LONGER LISTS IS SKIPPED, NOT NORMALISED. currentStepKey() could
 * map a pre-rename row onto its current key, but THREE retired keys point at `review_handover`, so
 * normalising would collide and need a which-row-wins rule that nothing else in this repo has. This
 * matches lane-summary exactly, and it understates in a direction somebody can see.
 */
function boardFacts(rows: Map<string, StepRow> | undefined, lane: Lane, now: number): BoardFacts {
  const empty: BoardFacts = {
    present: false,
    settled: 0,
    total: 0,
    openStep: null,
    erroredStep: null,
    ownerWorkCount: 0,
  };
  if (!rows || rows.size === 0) return empty;

  let settled = 0;
  let total = 0;
  let ownerWorkCount = 0;
  let openStep: OpenStepFacts | null = null;
  let erroredStep: OpenStepFacts | null = null;

  // ‼️ THIS CLIENT'S OWN LANE'S REGISTRY, AND BOTH LANES NUMBER THEIR OWN STEPS. Walking the Slack
  // board over a launch client's rows would match nothing and read as "no board yet" for every one
  // of them, which is how the filter that hid them would have come back as a subtler bug.
  const registry = lane === "launch" ? LAUNCH_STEPS : DELIVERY_STEPS;
  const numberOf = (key: string): number =>
    lane === "launch" ? launchStepNumber(key as LaunchStepKey) : stepNumber(key as StepKey);

  for (const step of registry) {
    const row = rows.get(step.key);
    if (!row) continue;
    total += 1;

    const status = String(row.status);
    if (RESOLVED.has(status)) {
      settled += 1;
      continue;
    }

    const facts: OpenStepFacts = {
      // ‼️ COUNTED. Any copy naming a step number calls this, says both registries' docstrings.
      // The cast matches lane-summary.ts: the step arrays are typed with `key: string`.
      number: numberOf(step.key),
      key: step.key,
      label: step.label,
      status,
      errorDetail: row.error_detail ?? null,
      ageDays: row.updated_at ? daysSince(row.updated_at, now) : null,
    };

    if (!openStep) openStep = facts;
    if (status === "error" && !erroredStep) erroredStep = facts;
    // The canonical "waiting on a person" predicate, not re-spelled here.
    if (isOwnerWork(status)) ownerWorkCount += 1;
  }

  return { present: true, settled, total, openStep, erroredStep, ownerWorkCount };
}
