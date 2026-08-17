// CRM tools for the Vektor chatbot.
//
// Lives apart from ai-tools.ts (already 1454 lines with a 40-case switch) and
// merges in at the boundary. Because src/app/api/slack/events/route.ts calls
// runConversationWithTools with default opts, and ai.ts defaults to AI_TOOLS +
// executeTool, everything here is available in Slack the moment it is exported
// — no Slack-side wiring at all.
//
// ── Typed tools AND one SQL tool ──────────────────────────────────────
// The ask was "access to all of our database". There are 80+ tables, so
// hand-written tools alone can never cover it. But a raw SQL tool reachable
// from a shared Slack channel, against a database holding contacts.ssn_full,
// contacts.dob and integrations.config (Microsoft OAuth refresh tokens), is a
// genuine exfiltration surface.
//
// So: typed tools for the hot paths and every WRITE, plus query_database for
// the long tail — with its safety enforced in Postgres (the crm_read schema of
// PII-stripped views plus a SECURITY DEFINER function that drops to a
// read-only role) rather than by regex here. The checks in this file are
// ergonomics and telemetry; docs/2026-08-18-crm-readonly-role.sql is the
// actual boundary.

import type { ToolExecutionResult } from "./ai-tools";
import { parseBusinessDate } from "./business-time";
import { supabaseAdmin } from "./db";
import {
  addNote,
  completeTask,
  createTask,
  logCall,
  setLeadStatus,
  snoozeLead,
} from "./crm";
import { buildWorklist, statusCounts, worklistSummary } from "./worklist";
import { STAGE_PIPELINES } from "@/config/stage-display";

const ALL_STAGES = STAGE_PIPELINES.flatMap((p) => p.stages.map((s) => s.name));

/** Everything the chatbot does is attributed to this actor in the timeline. */
const ACTOR = "vektor";

// ─────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────

export const CRM_TOOLS = [
  {
    name: "get_worklist",
    description:
      "THE tool for 'who do we need to call today?', 'who should I follow up with?', 'what's on my list?'. Returns leads ranked by urgency, each with a plain-English reason. Buckets: 'unscheduled' = a working lead with NO follow-up date set (the most important bucket), 'overdue' = follow-up task past due, 'due_today' = follow-up due today, 'replied' = they answered and we haven't. Call with no arguments for the standard daily list.",
    input_schema: {
      type: "object" as const,
      properties: {
        bucket: {
          type: "string",
          description:
            "Optional filter: unscheduled | overdue | due_today | replied. Omit for everything, ranked.",
        },
        limit: { type: "number", description: "How many leads to return. Default 25." },
        include_snoozed: {
          type: "boolean",
          description: "Include leads that were snoozed. Default false.",
        },
      },
      required: [] as string[],
    },
  },
  {
    name: "get_lead",
    description:
      "Look up one lead by name, business name, email or phone. Returns their full profile, current status, open follow-up tasks and the last 10 timeline entries. Use this before logging a call or changing a status so you have the context.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Person name, business name, email address or phone number.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_lead_timeline",
    description:
      "Full activity history for one lead — every note, call, text, email and status change, newest first. Use when asked 'what happened with X' or 'what did we last talk about'.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: { type: "string", description: "The contact id from get_lead or get_worklist." },
        limit: { type: "number", description: "Default 30." },
        types: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional filter, e.g. ['call','note']. Types: note, call, email, sms, meeting, status_change, task_created, task_completed, portal, snooze, system.",
        },
      },
      required: ["contact_id"],
    },
  },
  {
    name: "search_leads_db",
    description:
      "Search and filter leads across the whole CRM. Use for 'show me all Pre-Approved leads', 'who came from Meta Ads', 'which leads haven't been touched in 2 weeks', 'leads asking for over $100k'.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Free text — matches name, business, email." },
        status: { type: "string", description: `Exact lead status. One of: ${ALL_STAGES.join(", ")}` },
        source: { type: "string", description: "Lead source, e.g. 'Meta Ads'." },
        min_amount: { type: "number", description: "Minimum funding amount requested." },
        untouched_days: {
          type: "number",
          description: "Only leads with no activity for at least this many days.",
        },
        has_open_task: {
          type: "boolean",
          description: "true = only leads with a follow-up scheduled, false = only leads without one.",
        },
        limit: { type: "number", description: "Default 25, max 100." },
      },
      required: [] as string[],
    },
  },
  {
    name: "get_lead_stats",
    description:
      "Counts across the CRM — leads per status, per source, or new leads per day. Use for 'how many leads are in underwriting', 'how's the pipeline looking', 'how many new leads this week'.",
    input_schema: {
      type: "object" as const,
      properties: {
        group_by: {
          type: "string",
          description: "status | source | day | worklist. Default status.",
        },
        since: { type: "string", description: "ISO date. Only used with group_by=day or source." },
      },
      required: [] as string[],
    },
  },
  {
    name: "log_call",
    description:
      "Record a call with a lead. A FOLLOW-UP DATE IS MANDATORY — every call must leave a next date behind, because a lead with no follow-up scheduled is exactly what the worklist flags as neglected. If the user tells you about a call without giving a next date, ASK them for one before calling this tool. Do not invent a date.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: { type: "string", description: "The contact id from get_lead or get_worklist." },
        outcome: {
          type: "string",
          description:
            "connected | voicemail | no_answer | bad_number | not_interested | booked",
        },
        next_follow_up_date: {
          type: "string",
          description:
            "REQUIRED. When to follow up next, as an ISO date (YYYY-MM-DD) or datetime. Ask the user if they didn't say.",
        },
        notes: { type: "string", description: "What was discussed." },
        duration_minutes: { type: "number", description: "Call length in minutes." },
        next_step: { type: "string", description: "What the follow-up task should be called." },
        status: {
          type: "string",
          description: `Optionally move the lead to a new status. One of: ${ALL_STAGES.join(", ")}`,
        },
      },
      required: ["contact_id", "outcome", "next_follow_up_date"],
    },
  },
  {
    name: "add_lead_note",
    description:
      "Add a note to a lead's timeline. Use for anything worth remembering that isn't a call. For calls use log_call instead, so the follow-up date gets set.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: { type: "string" },
        note: { type: "string", description: "The note body." },
        title: { type: "string", description: "Short title. Defaults to 'Note'." },
      },
      required: ["contact_id", "note"],
    },
  },
  {
    name: "set_lead_status",
    description:
      "Change a lead's status. Never invent a status — use one of the listed values. Confirm with the user before moving a lead to a closed/dead status.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: { type: "string" },
        status: { type: "string", description: `One of: ${ALL_STAGES.join(", ")}` },
        reason: { type: "string", description: "Why it moved." },
      },
      required: ["contact_id", "status"],
    },
  },
  {
    name: "create_lead_task",
    description:
      "Schedule a follow-up on a lead. Use when the user says 'remind me to call X on Friday' or 'follow up with Y next week'.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: { type: "string" },
        title: { type: "string", description: "What to do, e.g. 'Call about statements'." },
        due_date: { type: "string", description: "ISO date or datetime." },
        priority: { type: "string", description: "low | normal | high. Default normal." },
      },
      required: ["contact_id", "title", "due_date"],
    },
  },
  {
    name: "complete_lead_task",
    description:
      "Mark a follow-up task done. If the lead still needs working, pass next_follow_up_date so it doesn't fall into the 'no follow-up scheduled' bucket.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: { type: "string" },
        outcome: { type: "string", description: "What happened." },
        next_follow_up_date: {
          type: "string",
          description: "Optional — schedules the next follow-up in the same step.",
        },
      },
      required: ["task_id"],
    },
  },
  {
    name: "snooze_lead",
    description:
      "Hide a lead from the call board until a date. Use when the lead asked to be contacted later. A reason is required so the board can explain itself.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: { type: "string" },
        until: { type: "string", description: "ISO date to resurface on." },
        reason: { type: "string", description: "Why, e.g. 'asked to call back after the 1st'." },
      },
      required: ["contact_id", "until", "reason"],
    },
  },
  {
    name: "describe_schema",
    description:
      "List the tables and columns available to query_database. ALWAYS call this before writing a query for the first time in a conversation — guessing column names produces broken SQL.",
    input_schema: {
      type: "object" as const,
      properties: {
        table: { type: "string", description: "Optional — describe just this one table." },
      },
      required: [] as string[],
    },
  },
  {
    name: "query_database",
    description:
      "Run a read-only SELECT against the CRM for questions the other tools don't cover. Call describe_schema first. Only the crm_read views are reachable and sensitive fields (SSN, DOB, tokens) are not exposed. SELECT only, one statement, results capped at 200 rows. Prefer the typed tools when one fits — they return better-formatted results.",
    input_schema: {
      type: "object" as const,
      properties: {
        sql: {
          type: "string",
          description:
            "A single SELECT statement against crm_read.* views. No semicolon, no CTEs that write.",
        },
        purpose: {
          type: "string",
          description: "One line on what this is answering. Logged for audit.",
        },
      },
      required: ["sql", "purpose"],
    },
  },
];

export const CRM_TOOL_NAMES = new Set(CRM_TOOLS.map((t) => t.name));

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

type Input = Record<string, unknown>;

function s(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const t = String(v).trim();
  return t === "" ? undefined : t;
}

function n(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const num = Number(v);
  return Number.isFinite(num) ? num : undefined;
}

function result(data: unknown): ToolExecutionResult {
  return { content: JSON.stringify(data), structuredData: data };
}

function fail(message: string, extra: Input = {}): ToolExecutionResult {
  return result({ error: message, ...extra });
}

/** Accepts "2026-08-20", "2026-08-20T15:00:00Z", or "tomorrow"-style ISO. */
function parseDate(v: unknown): Date | null {
  // Bare date → 9am ET, so a follow-up "on Friday" lands in working hours
  // instead of midnight where it looks overdue all day. "Local" is UTC on
  // Vercel, which made that 5am ET; see src/lib/business-time.ts.
  return parseBusinessDate(s(v));
}

const CONTACT_SUMMARY_COLS =
  "id, first_name, last_name, business_name, email, phone, mobile_phone, application_stage, working_state, source, amount_needed, monthly_revenue, credit_score, last_activity_at, next_action_at, next_action_reason, open_task_count, snoozed_until, do_not_contact, zoho_lead_id, created_at";

async function findLead(query: string): Promise<Input | null> {
  const digits = query.replace(/\D/g, "");

  if (digits.length >= 10) {
    const last10 = digits.slice(-10);
    const { data } = await supabaseAdmin
      .from("contacts")
      .select(CONTACT_SUMMARY_COLS)
      .or(`phone_last10.eq.${last10},mobile_last10.eq.${last10}`)
      .limit(1);
    if (data?.[0]) return data[0] as Input;
  }

  if (query.includes("@")) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select(CONTACT_SUMMARY_COLS)
      .ilike("email", query)
      .limit(1);
    if (data?.[0]) return data[0] as Input;
  }

  const like = `%${query}%`;
  const { data } = await supabaseAdmin
    .from("contacts")
    .select(CONTACT_SUMMARY_COLS)
    .or(
      `business_name.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`
    )
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .limit(1);

  return (data?.[0] as Input) ?? null;
}

// ─────────────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────────────

export async function executeCrmTool(
  toolName: string,
  input: Input
): Promise<ToolExecutionResult> {
  switch (toolName) {
    // ── Reads ────────────────────────────────────────────────────────
    case "get_worklist": {
      const items = await buildWorklist({
        bucket: s(input.bucket) as never,
        limit: n(input.limit) ?? 25,
        includeSnoozed: input.include_snoozed === true,
      });
      const summary = await worklistSummary();
      return result({
        tool: "get_worklist",
        summary,
        count: items.length,
        leads: items,
        note:
          items.length === 0
            ? "Nothing needs a call right now — every working lead has a follow-up scheduled and nothing is overdue."
            : undefined,
      });
    }

    case "get_lead": {
      const query = s(input.query);
      if (!query) return fail("query is required");

      const contact = await findLead(query);
      if (!contact) return fail(`No lead found matching "${query}"`);

      const contactId = contact.id as string;
      const [tasks, activities] = await Promise.all([
        supabaseAdmin
          .from("lead_tasks")
          .select("id, title, due_at, priority, task_type")
          .eq("contact_id", contactId)
          .eq("status", "open")
          .order("due_at", { ascending: true, nullsFirst: false }),
        supabaseAdmin
          .from("lead_activities")
          .select("activity_type, direction, subject, body, outcome, occurred_at, actor")
          .eq("contact_id", contactId)
          .order("occurred_at", { ascending: false })
          .limit(10),
      ]);

      return result({
        tool: "get_lead",
        lead: contact,
        openTasks: tasks.data ?? [],
        recentActivity: activities.data ?? [],
        needsFollowUpDate: (tasks.data ?? []).length === 0,
      });
    }

    case "get_lead_timeline": {
      const contactId = s(input.contact_id);
      if (!contactId) return fail("contact_id is required");

      let q = supabaseAdmin
        .from("lead_activities")
        .select(
          "id, activity_type, direction, channel, subject, body, outcome, duration_secs, occurred_at, actor, source"
        )
        .eq("contact_id", contactId)
        .order("occurred_at", { ascending: false })
        .limit(Math.min(n(input.limit) ?? 30, 100));

      const types = Array.isArray(input.types) ? (input.types as string[]) : null;
      if (types && types.length > 0) q = q.in("activity_type", types);

      const { data, error } = await q;
      if (error) return fail(error.message);
      return result({ tool: "get_lead_timeline", contactId, count: data?.length ?? 0, activities: data ?? [] });
    }

    case "search_leads_db": {
      const limit = Math.min(n(input.limit) ?? 25, 100);
      let q = supabaseAdmin.from("contacts").select(CONTACT_SUMMARY_COLS).limit(limit);

      const text = s(input.query);
      if (text) {
        const like = `%${text}%`;
        q = q.or(
          `business_name.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`
        );
      }
      const status = s(input.status);
      if (status) q = q.eq("application_stage", status);
      const source = s(input.source);
      if (source) q = q.ilike("source", `%${source}%`);
      const minAmount = n(input.min_amount);
      if (minAmount !== undefined) q = q.gte("amount_needed", minAmount);

      const untouched = n(input.untouched_days);
      if (untouched !== undefined) {
        const cutoff = new Date(Date.now() - untouched * 86_400_000).toISOString();
        q = q.or(`last_activity_at.is.null,last_activity_at.lt.${cutoff}`);
      }
      if (typeof input.has_open_task === "boolean") {
        q = input.has_open_task ? q.gt("open_task_count", 0) : q.eq("open_task_count", 0);
      }

      const { data, error } = await q.order("last_activity_at", {
        ascending: false,
        nullsFirst: false,
      });
      if (error) return fail(error.message);
      return result({ tool: "search_leads_db", count: data?.length ?? 0, leads: data ?? [] });
    }

    case "get_lead_stats": {
      const groupBy = s(input.group_by) ?? "status";

      if (groupBy === "worklist") {
        return result({ tool: "get_lead_stats", groupBy, ...(await worklistSummary()) });
      }
      if (groupBy === "status") {
        return result({ tool: "get_lead_stats", groupBy, counts: await statusCounts() });
      }

      const since = s(input.since);
      const cutoff = since ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
      const column = groupBy === "source" ? "source" : "created_at";
      const { data, error } = await supabaseAdmin
        .from("contacts")
        .select(column)
        .gte("created_at", cutoff)
        .limit(10_000);
      if (error) return fail(error.message);

      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        const raw = (row as Input)[column];
        const key =
          groupBy === "source"
            ? (s(raw) ?? "(no source)")
            : String(raw ?? "").slice(0, 10) || "(unknown)";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return result({
        tool: "get_lead_stats",
        groupBy,
        since: cutoff,
        counts: [...counts.entries()]
          .map(([key, count]) => ({ key, count }))
          .sort((a, b) => (groupBy === "day" ? a.key.localeCompare(b.key) : b.count - a.count)),
      });
    }

    // ── Writes ───────────────────────────────────────────────────────
    case "log_call": {
      const contactId = s(input.contact_id);
      const outcome = s(input.outcome);
      if (!contactId) return fail("contact_id is required");
      if (!outcome) return fail("outcome is required");

      // The rule, enforced at the tool boundary as well as in the API route
      // and the UI form. A call with no next date is how leads go quiet.
      const followUp = parseDate(input.next_follow_up_date);
      if (!followUp) {
        return fail(
          "A follow-up date is required on every logged call. Ask the user when they want to follow up, then call log_call again with next_follow_up_date.",
          { missing: "next_follow_up_date" }
        );
      }

      const durationMinutes = n(input.duration_minutes);
      const res = await logCall({
        contactId,
        outcome,
        nextFollowUpAt: followUp,
        notes: s(input.notes),
        durationSecs: durationMinutes ? Math.round(durationMinutes * 60) : undefined,
        nextStep: s(input.next_step),
        actor: ACTOR,
        origin: "ai",
      });
      if (!res.ok) return fail(res.error ?? "failed to log the call");

      const newStatus = s(input.status);
      let statusResult: unknown = null;
      if (newStatus) {
        statusResult = await setLeadStatus({
          contactId,
          status: newStatus,
          reason: `Call outcome: ${outcome}`,
          origin: "ai",
          actor: ACTOR,
        });
      }

      return result({
        tool: "log_call",
        ok: true,
        contactId,
        outcome,
        followUpAt: followUp.toISOString(),
        taskId: res.taskId,
        statusResult,
        message: `Call logged. Follow-up set for ${followUp.toISOString().slice(0, 10)}.`,
      });
    }

    case "add_lead_note": {
      const contactId = s(input.contact_id);
      const note = s(input.note);
      if (!contactId) return fail("contact_id is required");
      if (!note) return fail("note is required");

      const res = await addNote({
        contactId,
        title: s(input.title) ?? "Note",
        content: note,
        origin: "ai",
        actor: ACTOR,
      });
      return result({ tool: "add_lead_note", ...res });
    }

    case "set_lead_status": {
      const contactId = s(input.contact_id);
      const status = s(input.status);
      if (!contactId) return fail("contact_id is required");
      if (!status) return fail("status is required");
      if (!ALL_STAGES.includes(status)) {
        return fail(`"${status}" is not a known status.`, { validStatuses: ALL_STAGES });
      }

      const res = await setLeadStatus({
        contactId,
        status,
        reason: s(input.reason),
        origin: "ai",
        actor: ACTOR,
      });
      return result({ tool: "set_lead_status", ...res });
    }

    case "create_lead_task": {
      const contactId = s(input.contact_id);
      const title = s(input.title);
      const due = parseDate(input.due_date);
      if (!contactId) return fail("contact_id is required");
      if (!title) return fail("title is required");
      if (!due) return fail("due_date is required and must be a valid date");

      const res = await createTask({
        contactId,
        title,
        dueAt: due,
        priority: (s(input.priority) as "low" | "normal" | "high") ?? "normal",
        origin: "ai",
        actor: ACTOR,
      });
      return result({
        tool: "create_lead_task",
        ...res,
        dueAt: due.toISOString(),
        message: res.ok ? `Follow-up "${title}" set for ${due.toISOString().slice(0, 10)}.` : undefined,
      });
    }

    case "complete_lead_task": {
      const taskId = s(input.task_id);
      if (!taskId) return fail("task_id is required");

      const res = await completeTask(taskId, { actor: ACTOR, outcome: s(input.outcome) });
      if (!res.ok) return fail(res.error ?? "failed to complete the task");

      let nextTask: unknown = null;
      const next = parseDate(input.next_follow_up_date);
      if (next && res.contactId) {
        nextTask = await createTask({
          contactId: res.contactId,
          title: "Follow up",
          dueAt: next,
          origin: "ai",
          actor: ACTOR,
        });
      }

      return result({
        tool: "complete_lead_task",
        ok: true,
        contactId: res.contactId,
        nextTask,
        warning:
          !next && res.contactId
            ? "No next follow-up was scheduled — this lead will show up as 'no follow-up scheduled' on the call board."
            : undefined,
      });
    }

    case "snooze_lead": {
      const contactId = s(input.contact_id);
      const until = parseDate(input.until);
      const reason = s(input.reason);
      if (!contactId) return fail("contact_id is required");
      if (!until) return fail("until is required and must be a valid date");
      if (!reason) return fail("reason is required");

      const res = await snoozeLead({ contactId, until, reason, actor: ACTOR });
      return result({
        tool: "snooze_lead",
        ...res,
        until: until.toISOString(),
        message: res.ok ? `Snoozed until ${until.toISOString().slice(0, 10)}.` : undefined,
      });
    }

    // ── Open-ended query ─────────────────────────────────────────────
    case "describe_schema":
      return describeSchema(s(input.table));

    case "query_database":
      return queryDatabase(s(input.sql), s(input.purpose));

    default:
      return fail(`Unknown CRM tool: ${toolName}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// describe_schema / query_database
// ─────────────────────────────────────────────────────────────────────

async function describeSchema(table?: string): Promise<ToolExecutionResult> {
  const { data, error } = await supabaseAdmin.rpc("crm_describe_schema", {
    p_table: table ?? null,
  });

  if (error) {
    return fail(
      `Schema catalog unavailable: ${error.message}. Run docs/2026-08-18-crm-readonly-role.sql in Supabase.`
    );
  }

  return result({
    tool: "describe_schema",
    schema: "crm_read",
    note: "All queries must be SELECTs against crm_read.* views. Sensitive columns (SSN, DOB, OAuth tokens) are not exposed.",
    tables: data ?? [],
  });
}

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do|set|reset|vacuum|analyze|refresh|comment|security|listen|notify)\b/i;

/**
 * Blank out string literals and quoted identifiers before the keyword checks.
 *
 * Without this the checks fire on DATA, not on SQL. `activity_type` has 'call'
 * among its documented values and `lead_activities` stores free text, so
 *   select * from crm_read.lead_activities where activity_type = 'call'
 *   select * from crm_read.lead_activities where subject ilike '%update%'
 * are both perfectly legal reads that came back as "that statement contains a
 * write or administrative keyword". Contents are replaced rather than removed so
 * every offset stays put and the error messages still point at the right place.
 */
function blankLiterals(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const quote = c;
      out += quote;
      i++;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            out += "  ";
            i += 2;
            continue;
          }
          out += quote;
          i++;
          break;
        }
        out += sql[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

async function queryDatabase(
  sql?: string,
  purpose?: string
): Promise<ToolExecutionResult> {
  if (!sql) return fail("sql is required");
  if (!purpose) return fail("purpose is required — one line on what this answers");

  // Ergonomics and telemetry only. The real boundary is the read-only role
  // inside crm_readonly_query(); these checks just give the model a fast,
  // legible error instead of a Postgres permission dump.
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  const bare = blankLiterals(trimmed);

  if (!/^\s*select\b/i.test(bare) && !/^\s*with\b/i.test(bare)) {
    return fail("Only SELECT statements are allowed.");
  }
  if (bare.includes(";")) {
    return fail("Only one statement at a time — remove the semicolon.");
  }
  if (FORBIDDEN.test(bare.replace(/^\s*with\b/i, ""))) {
    return fail("That statement contains a write or administrative keyword. SELECT only.");
  }

  const limited = /\blimit\s+\d+/i.test(bare) ? trimmed : `${trimmed} LIMIT 200`;

  const { data, error } = await supabaseAdmin.rpc("crm_readonly_query", { q: limited });

  // Log every statement regardless of outcome — this is the audit trail for a
  // tool that is reachable from a shared Slack channel.
  await supabaseAdmin
    .from("system_logs")
    .insert({
      event_type: "ai_sql",
      description: `Vektor SQL: ${purpose.slice(0, 200)}`,
      metadata: { sql: limited, ok: !error, error: error?.message ?? null },
    })
    .then(
      () => {},
      () => {}
    );

  if (error) {
    return fail(
      `Query failed: ${error.message}. Call describe_schema to check table and column names. Remember: only crm_read.* views are reachable.`
    );
  }

  const rows = Array.isArray(data) ? data : [];
  return result({
    tool: "query_database",
    purpose,
    sql: limited,
    rowCount: rows.length,
    rows,
    truncated: rows.length >= 200,
  });
}
