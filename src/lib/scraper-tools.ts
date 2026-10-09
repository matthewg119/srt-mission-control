// Scraper tools for the assistant, so #srt-scraper can be ASKED things rather than only commanded.
//
// Matthew, 2026-10-09: "let me be able to conversate with scraper to organize data and stuff like
// that ... if i text it right now like hey so what categories we have from the dropped clients we
// have pulled and what do you think of doing X ... it should understand our whole onboarding,
// avatar, offer etc, like vektor you know."
//
// ‼️ TWO THIRDS OF THIS ALREADY EXISTED, WHICH IS WHY IT IS A TOOL FILE AND NOT A NEW AGENT.
// `handleScraperEvent` returns false for anything that is not a CSV drop or a known command, and
// src/app/api/slack/events/route.ts then passes the message to the assistant, so ordinary chat in
// that channel has been reaching a model the whole time. What it could not reach was this lane's
// own data: asked "workflows" on 2026-09-27 the assistant answered "I don't have a pull maps or
// lead scrape workflow", which was honest and wrong. It could not see the feature.
//
// ‼️ AND THE ONBOARDING, AVATAR AND OFFER CONTEXT IS NOT REBUILT HERE EITHER. CLIENT_TOOLS already
// carries get_client_profile, get_onboarding_sheet, get_client_plan and search_client_events, and
// ai-tools.ts merges every tool list into one, so the assistant in #srt-scraper can already answer
// about a client's avatar. Re-exposing that through a scraper-shaped wrapper would be a second copy
// of a surface that works.
//
// ── The rule that governs every tool in this file ────────────────────────────────────────────
//
// ‼️ READ-ONLY, AND ANYTHING THAT SPENDS RETURNS A COMMAND RATHER THAN RUNNING ONE. A conversation
// that can buy records is a conversation that becomes an unreviewed purchase, and this lane's whole
// posture is that money moves on a check mark and nothing else. `plan_pull` is the shape: it works
// out exactly what WOULD be bought, hands back the text to type, and says who has to tick it.
//
// ‼️ AND query_database IS NOT WIDENED OR DUPLICATED HERE. The existing tool goes through
// `crm_readonly_query`, which is SECURITY DEFINER with a SET ROLE onto a read-only role against a
// schema of PII-stripped views, and it needs the SESSION pooler URI because SET ROLE does not
// survive transaction-level multiplexing. Reusing it is the only safe answer; a second query path
// against a database holding contacts.ssn_full is an exfiltration surface with a friendly name.

import type { ToolExecutionResult } from "./ai-tools";
import { supabaseAdmin } from "./db";
import { knownVerticals } from "./scraper/icp";
import { verticalDef, verticalSlugs } from "./scraper/verticals";
import {
  SENDING,
  cellsMeasured,
  dropRows,
  groupDropRows,
  metroCircleRows,
  metroCircles,
  metroPlan,
  metroRows,
  rawPerDay,
} from "./scraper/territory";
import {
  PLAN_MAX_RECORDS,
  planCardLines,
  planPull,
} from "./scraper/pull-plan";
import { livePlan, planSteps } from "./scraper/pull-plan-store";
import { funnelFor } from "./scraper/listprep";

export const SCRAPER_TOOLS = [
  {
    name: "get_territory",
    description:
      "THE tool for 'where have we pulled', 'which metro next', 'how much is left in Dallas', " +
      "'how many leads can we still get', 'are we done with Texas'. Returns the per-metro table " +
      "(pulled, qualified, call list, sendable, remaining) plus the plan in priority order with " +
      "the next metro named. A metro whose circle has never been measured reports remaining as " +
      "null, which means NOT MEASURED and never zero: do not describe it as empty or finished.",
    input_schema: {
      type: "object" as const,
      properties: {
        vertical: {
          type: "string",
          description: "Vertical slug, e.g. 'medspa' or 'dentist'. Defaults to medspa.",
        },
      },
      required: [] as string[],
    },
  },
  {
    name: "get_drop_breakdown",
    description:
      "THE tool for 'what categories are we throwing away', 'why are we dropping so many', 'what " +
      "does the ICP reject', 'show me the dropped businesses'. Returns every lead the profile did " +
      "not route to email, split by what judged it (a free rule against the model) and bucketed by " +
      "reason. IMPORTANT when answering: most of these still have a phone and are on the CALL " +
      "list, so they are not thrown away. Tier C is not in here at all; it is a KEEP.",
    input_schema: {
      type: "object" as const,
      properties: {
        vertical: { type: "string", description: "Vertical slug. Defaults to medspa." },
        metro: { type: "string", description: "Optional: just one metro, e.g. 'Dallas TX'." },
      },
      required: [] as string[],
    },
  },
  {
    name: "get_run",
    description:
      "One pull's funnel end to end: raw records, how many the ICP kept, how many were crawled, " +
      "how many addresses were found and how many are shippable. Use for 'how did the last pull " +
      "do', 'what did run X produce', 'what is our keep rate'. With no run id it returns the most " +
      "recent runs with their funnels.",
    input_schema: {
      type: "object" as const,
      properties: {
        run_id: { type: "string", description: "The run id. Omit for the most recent runs." },
        limit: { type: "number", description: "How many recent runs. Default 5." },
      },
      required: [] as string[],
    },
  },
  {
    name: "get_call_list",
    description:
      "The businesses with no email route but a phone number: no website, a platform-only domain, " +
      "a domain that cannot receive mail, or Tier C. Use for 'who can we ring', 'how many no " +
      "website leads', 'what is on the call list'. Says how many have reached the CRM and how many " +
      "have not, which is the number that matters.",
    input_schema: {
      type: "object" as const,
      properties: {
        vertical: { type: "string", description: "Vertical slug. Defaults to medspa." },
        limit: { type: "number", description: "How many examples to return. Default 20." },
      },
      required: [] as string[],
    },
  },
  {
    name: "plan_pull",
    description:
      "Work out what pulling N more records would cost and where they would come from, and hand " +
      "back the COMMAND to run. Use whenever somebody asks to pull, scrape, buy or get more leads, " +
      "or asks 'what would it cost to get 2000 more'. THIS BUYS NOTHING: it returns the command " +
      "text and the estimate, and a human has to type it in #srt-scraper and react to the card. " +
      "Always show the command and say that it needs the check mark.",
    input_schema: {
      type: "object" as const,
      properties: {
        count: { type: "number", description: "How many records. Required." },
        vertical: { type: "string", description: "Vertical slug. Defaults to medspa." },
      },
      required: ["count"],
    },
  },
  {
    name: "get_scraper_status",
    description:
      "What the lead engine is doing right now: any live pull plan and how far it has walked, how " +
      "many circles are measured, what the daily sending capacity is and how many days of supply " +
      "are left. Use for 'what is the scraper doing', 'is anything running', 'how are we for leads'.",
    input_schema: {
      type: "object" as const,
      properties: {
        vertical: { type: "string", description: "Vertical slug. Defaults to medspa." },
      },
      required: [] as string[],
    },
  },
];

export const SCRAPER_TOOL_NAMES = new Set(SCRAPER_TOOLS.map((t) => t.name));

type Input = Record<string, unknown>;

function result(data: unknown): ToolExecutionResult {
  return { content: JSON.stringify(data), structuredData: data };
}

function fail(message: string, extra: Input = {}): ToolExecutionResult {
  return result({ error: message, ...extra });
}

/**
 * The vertical, validated against the registry.
 *
 * ‼️ VALIDATED AND NOT DEFAULTED SILENTLY WHEN SOMETHING WAS ASKED FOR. A `?? "medspa"` on an
 * unknown value is the bug family that has bitten this codebase four separate times: it makes a
 * wrong vertical look like a working one, and here it would answer a question about plumbers with
 * confident med spa numbers. An ABSENT vertical does default, because "how much is left in Dallas"
 * with no vertical named means the one there is data for.
 */
function verticalOf(input: Input): { slug: string } | { error: string } {
  const asked = String(input.vertical ?? "").trim().toLowerCase();
  if (!asked) return { slug: knownVerticals().includes("medspa") ? "medspa" : knownVerticals()[0] };
  if (!knownVerticals().includes(asked)) {
    return {
      error:
        "`" + asked + "` is not a vertical this lane has. Known: " + verticalSlugs().join(", ") + ".",
    };
  }
  return { slug: asked };
}

export async function executeScraperTool(
  toolName: string,
  input: Input
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case "get_territory": {
      const v = verticalOf(input);
      if ("error" in v) return fail(v.error);

      const [rows, circles, circleRows, cells] = await Promise.all([
        metroRows(v.slug),
        metroCircles(v.slug),
        metroCircleRows(v.slug),
        cellsMeasured(v.slug),
      ]);
      const plan = metroPlan(rows, circles);
      const burn = rawPerDay();
      // ‼️ WHEN, NOT JUST HOW MANY. DataForSEO's index is live and the Dallas circle grew 12.7% in
      // ten days, so a remainder computed against a three week old count is not wrong but it is
      // old, and the only way the model can caveat that is if the age is in the payload.
      const measuredAt = new Map(circleRows.map((c) => [c.metroKey, c.measuredAt]));

      const worked = plan.filter((p) => p.worked);
      const unmeasured = plan.filter((p) => p.remaining === null);
      const finished = plan.filter((p) => p.remaining === 0);
      const nextUp = plan.find((p) => p.remaining === null || (p.remaining ?? 0) > 0);

      return result({
        tool: "get_territory",
        vertical: v.slug,
        label: verticalDef(v.slug)?.label ?? v.slug,
        totals: {
          pulled: rows.reduce((a, r) => a + r.pulled, 0),
          qualified: rows.reduce((a, r) => a + r.qualified, 0),
          callable: rows.reduce((a, r) => a + r.callable, 0),
          sendable: rows.reduce((a, r) => a + r.sendable, 0),
          emailed: rows.reduce((a, r) => a + r.emailed, 0),
        },
        per_metro: rows.map((r) => ({
          metro: r.metro,
          pulled: r.pulled,
          qualified: r.qualified,
          call_list: r.callable,
          sendable: r.sendable,
          remaining: r.remaining,
          last_pulled_at: r.lastPulledAt,
        })),
        plan: plan.map((p) => ({
          priority: p.priority,
          metro: p.label,
          pulled: p.pulled,
          remaining: p.remaining,
          circle_measured: p.circleTotal,
          circle_measured_at: measuredAt.get(p.key) ?? null,
          days_of_supply: p.daysOfSupply,
          state:
            p.remaining === null
              ? "circle never measured"
              : p.remaining === 0
                ? "finished, do not pull"
                : p.worked
                  ? "in progress, continue from offset " + p.pulled
                  : "unworked",
        })),
        next_metro: nextUp?.label ?? null,
        counts: {
          metros: plan.length,
          worked: worked.length,
          finished: finished.length,
          never_measured: unmeasured.length,
          national_cells_measured: cells,
        },
        burn_rate: { raw_records_a_day_low: burn.low, raw_records_a_day_high: burn.high },
        // ‼️ SPELLED OUT IN THE PAYLOAD RATHER THAN LEFT TO THE MODEL'S JUDGEMENT. A null remainder
        // read as zero is the one mistake that would make this tool actively harmful: it would
        // report fifteen untouched cities as finished and tell somebody the vertical was exhausted.
        reading_the_numbers:
          "remaining = null means NOBODY HAS MEASURED that metro's circle. It does not mean zero " +
          "and it does not mean finished. " + unmeasured.length + " of " + plan.length +
          " metros are in that state. Measuring one costs $0.0124 and `pull <n> " + v.slug +
          "` does it automatically as part of a plan.",
      });
    }

    case "get_drop_breakdown": {
      const v = verticalOf(input);
      if ("error" in v) return fail(v.error);

      const { rows, capped } = await dropRows(v.slug);
      const wanted = String(input.metro ?? "").trim().toLowerCase();
      const filtered = wanted
        ? rows.filter((r) => (r.metro ?? "").toLowerCase().includes(wanted))
        : rows;
      const grouped = groupDropRows(filtered);

      const all = grouped.reduce(
        (a, m) => ({
          byRule: a.byRule + m.byRule,
          byModel: a.byModel + m.byModel,
          called: a.called + m.called,
          binned: a.binned + m.binned,
        }),
        { byRule: 0, byModel: 0, called: 0, binned: 0 }
      );

      // One national bucket list, folded across metros, because "what are we throwing away" is
      // almost never a per-metro question even when it is asked next to one.
      const national = groupDropRows(filtered.map((r) => ({ ...r, metro: "all metros" })))[0];

      return result({
        tool: "get_drop_breakdown",
        vertical: v.slug,
        metro: wanted || "all",
        totals: {
          not_emailed: all.byRule + all.byModel,
          by_free_rule: all.byRule,
          by_model: all.byModel,
          still_callable: all.called,
          actually_binned: all.binned,
        },
        buckets: {
          free_rule: national?.ruleBuckets ?? [],
          model: national?.modelBuckets ?? [],
        },
        per_metro: grouped.map((m) => ({
          metro: m.metro,
          by_free_rule: m.byRule,
          by_model: m.byModel,
          still_callable: m.called,
          actually_binned: m.binned,
          top_model_reasons: m.modelBuckets.slice(0, 5),
        })),
        capped,
        reading_the_numbers:
          "These are rows the profile did not route to EMAIL. " + all.called +
          " of them still have a phone and a front desk and are on the call list, so do not " +
          "describe them as thrown away. Only the " + all.binned + " routed to 'drop' are binned. " +
          "Tier C is not in here at all: it is a keep, stored and called, never emailed. The " +
          "buckets are the model's own prose folded by normalizeReason, not a taxonomy.",
      });
    }

    case "get_run": {
      const runId = String(input.run_id ?? "").trim();
      if (runId) {
        const { data, error } = await supabaseAdmin
          .from("list_pipeline_runs")
          .select("id, label, vertical_slug, source, stage, raw_count, cost_usd, metro_total_count, created_at, error")
          .eq("id", runId)
          .maybeSingle();
        if (error) return fail("reading the run failed: " + error.message);
        if (!data) return fail("no run with id " + runId);
        return result({ tool: "get_run", run: data, funnel: await funnelFor(runId) });
      }

      const limit = Math.max(1, Math.min(20, Number(input.limit ?? 5) || 5));
      const { data, error } = await supabaseAdmin
        .from("list_pipeline_runs")
        .select("id, label, vertical_slug, source, stage, raw_count, cost_usd, metro_total_count, created_at, error")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return fail("reading the runs failed: " + error.message);

      const runs = (data ?? []) as Array<Record<string, unknown>>;
      const withFunnels = [];
      for (const r of runs) {
        withFunnels.push({ ...r, funnel: await funnelFor(String(r.id)) });
      }
      return result({ tool: "get_run", count: withFunnels.length, runs: withFunnels });
    }

    case "get_call_list": {
      const v = verticalOf(input);
      if ("error" in v) return fail(v.error);
      const limit = Math.max(1, Math.min(100, Number(input.limit ?? 20) || 20));

      const source = verticalDef(v.slug)?.crmSource ?? null;

      // Two head counts rather than reading the rows: at 423 on the call route today that is a
      // style point, at 4,000 records a day it is the difference between a count and a timeout.
      const callRoute = () =>
        supabaseAdmin
          .from("raw_leads")
          .select("id", { count: "exact", head: true })
          .eq("vertical_slug", v.slug)
          .eq("route", "call");

      const totalRes = await callRoute();
      if (totalRes.error) return fail("reading the call list failed: " + totalRes.error.message);
      const noSiteRes = await callRoute().or("website.is.null,website.eq.");
      if (noSiteRes.error) return fail("reading the call list failed: " + noSiteRes.error.message);
      const total = totalRes.count ?? 0;
      const noWebsite = noSiteRes.count ?? 0;

      const { data: examples } = await supabaseAdmin
        .from("raw_leads")
        .select("business_name, phone, website, city, state, qualify_reason, created_at")
        .eq("vertical_slug", v.slug)
        .eq("route", "call")
        .order("created_at", { ascending: false })
        .limit(limit);

      let inCrm = 0;
      if (source) {
        const { count } = await supabaseAdmin
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("source", source);
        inCrm = count ?? 0;
      }

      return result({
        tool: "get_call_list",
        vertical: v.slug,
        crm_source: source,
        totals: {
          on_the_call_route: total,
          of_those_no_website_at_all: noWebsite,
          in_the_crm_under_this_source: inCrm,
        },
        examples: examples ?? [],
        reading_the_numbers:
          "`route = 'call'` is the full call list: no website, a platform-only domain, a domain " +
          "with no MX, or Tier C. A row with no usable phone number is deliberately NOT written to " +
          "the CRM, because a board full of un-dialable rows stops being read; those stay in " +
          "raw_leads and in the CSV export. `call list sync` in #srt-scraper closes any gap " +
          "between the two numbers above.",
      });
    }

    case "plan_pull": {
      const v = verticalOf(input);
      if ("error" in v) return fail(v.error);
      const count = Number(input.count ?? 0);
      if (!Number.isFinite(count) || count < 1) {
        return fail("count is required and must be at least 1");
      }
      if (count > PLAN_MAX_RECORDS) {
        return fail(
          "the plan cap is " + PLAN_MAX_RECORDS + " records, because chunks are serialised one per " +
            "cron tick and more than that is most of a day of crawling"
        );
      }

      const def = verticalDef(v.slug);
      const [rows, circles] = await Promise.all([metroRows(v.slug), metroCircles(v.slug)]);
      const plan = planPull({ vertical: v.slug, requested: count, rows: metroPlan(rows, circles), def });

      // ‼️ THE COMMAND, NOT THE ACTION. This is the line the whole file turns on: a conversation
      // that could run this would be a conversation that spends money with no card and no check
      // mark, which is the one property this lane is built to keep.
      const command = "pull " + count + " " + v.slug;

      return result({
        tool: "plan_pull",
        bought_anything: false,
        command_to_run: command,
        where_to_run_it: "#srt-scraper",
        outcome: plan.outcome.kind,
        estimate: {
          records_in_concrete_chunks: plan.allocated,
          records_reserved_pending_a_measurement: plan.reserved,
          records_that_could_not_be_placed: plan.unplaced,
          chunks: plan.steps.filter((s) => s.kind === "pull").length,
          circles_to_measure: plan.measuring,
          cost_usd: Number(plan.totalCostUsd.toFixed(4)),
        },
        per_metro: plan.metros
          .filter((m) => m.allocated > 0 || m.reserved > 0)
          .map((m) => ({
            metro: m.label,
            records: m.allocated,
            reserved: m.reserved,
            measuring_first: m.measuring,
            left_after: m.leftAfter,
          })),
        card_preview: plan.steps.length
          ? planCardLines(plan, {
              verticalLabel: def?.label ?? v.slug,
              verifierCreditsLeft: SENDING.verifierCreditsLeft,
            }).join("\n")
          : null,
        how_to_answer:
          "Show the command `" + command + "` and say it has to be typed in #srt-scraper, where it " +
          "posts a card that buys nothing until somebody reacts with a check mark. Do not describe " +
          "this as having started a pull. Nothing was bought.",
      });
    }

    case "get_scraper_status": {
      const v = verticalOf(input);
      if ("error" in v) return fail(v.error);

      const [rows, circles, circleRows, cells] = await Promise.all([
        metroRows(v.slug),
        metroCircles(v.slug),
        metroCircleRows(v.slug),
        cellsMeasured(v.slug),
      ]);
      const plan = metroPlan(rows, circles);

      let live = null;
      try {
        const p = await livePlan(v.slug);
        if (p) {
          const steps = await planSteps(p.id);
          live = {
            status: p.status,
            asked_for: p.requested_records,
            records_pulled: p.records_pulled,
            spent_usd: Number(p.spent_usd ?? 0),
            estimated_usd: Number(p.estimated_cost_usd ?? 0),
            steps_total: steps.length,
            steps_done: steps.filter((s) => s.status === "done").length,
            steps_pending: steps.filter((s) => s.status === "pending").length,
            next_step: steps.find((s) => s.status === "pending")
              ? {
                  kind: steps.find((s) => s.status === "pending")!.kind,
                  metro: steps.find((s) => s.status === "pending")!.metro_label,
                }
              : null,
          };
        }
      } catch {
        // The plan tables may not be migrated. Everything else on this card still answers.
        live = null;
      }

      const measured = plan.filter((p) => p.remaining !== null);
      const supply = measured.reduce((a, p) => a + (p.remaining ?? 0), 0);
      const burn = rawPerDay();

      return result({
        tool: "get_scraper_status",
        vertical: v.slug,
        live_pull_plan: live,
        supply: {
          records_left_in_measured_metros: supply,
          metros_never_measured: plan.filter((p) => p.remaining === null).length,
          metro_circles_measured: circleRows.length,
          spent_measuring_circles_usd: Number(
            circleRows.reduce((a, c) => a + c.costUsd, 0).toFixed(4)
          ),
          oldest_circle_measured_at:
            circleRows.map((c) => c.measuredAt).filter(Boolean).sort()[0] ?? null,
          national_cells_measured: cells,
          days_at_the_high_burn: burn.high > 0 ? Math.round((supply / burn.high) * 10) / 10 : null,
        },
        sending: {
          mailboxes: SENDING.mailboxes,
          sends_a_day: SENDING.mailboxes * SENDING.perMailboxPerDay,
          verifier_credits_left: SENDING.verifierCreditsLeft,
        },
        reading_the_numbers:
          "MillionVerifier credits are the real budget, not DataForSEO: records cost about $0.37 " +
          "per thousand. Supply counts only MEASURED metros, so it understates rather than " +
          "overstates what is available.",
      });
    }

    default:
      return fail("Unknown scraper tool: " + toolName);
  }
}
