// The client half of the assistant's tools.
//
// ‼️ THE CHATBOT COULD NOT SEE A SINGLE CLIENT UNTIL THIS FILE. Measured 2026-09-11: every tool it
// had read the CRM -- contacts, lead_activities, lead_tasks, deals -- and none read `clients` or
// any client table, and the read-only role behind query_database had no grant on them either, so
// there was no back door through SQL. Ask it "what are SRT's approved keywords" and it had nothing
// to answer with, which is the gap Matthew named: "to be able to pull any info I need from our
// current chatbot in Mission Control."
//
// ‼️ EVERY TOOL HERE IS A READ. The board is where a client's state changes, behind verifiers that
// ask for evidence; a tool that ticked a step or approved a keyword set would be a second door into
// the one place this system is deliberately strict. The one exception is starting a WORKFLOW, which
// produces drafts and posts them for a person to read (workflows/registry.ts).
//
// Spread into AI_TOOLS, so the web chat, Slack and Telegram all get them with no extra wiring:
// ai-tools.ts's own header says that is the point of merging there rather than at each call site.

import type { ToolExecutionResult } from "./ai-tools";
import { resolveClient } from "./clients/client-reads";

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

/** Every tool takes the same `client` argument, so one description explains it once. */
const CLIENT_ARG = {
  client: {
    type: "string",
    description:
      "The client: a slug (srt-agency-llc), a name, a domain, or an id. Ambiguous names are " +
      "refused with the list of matches rather than guessed at.",
  },
};

export const CLIENT_TOOLS = [
  {
    name: "find_client",
    description:
      "Find a delivery client by name, slug, domain or id. Use this FIRST when a question names a client you do not have an id for. Clients are the businesses SRT delivers AEO work to; they are not CRM leads.",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string", description: "Name, slug, domain or id to search for." } },
      required: ["query"],
    },
  },
  {
    name: "get_client_profile",
    description:
      "The whole picture of one client: their offer and whether it is locked, the confirmed avatar, tier, vertical, what intake answered, Day 0 state, and how far the 41-step delivery board has got, including any step sitting in error. Use for 'how is X doing', 'what is X's offer', 'where are we with X'.",
    input_schema: {
      type: "object" as const,
      properties: { ...CLIENT_ARG },
      required: ["client"],
    },
  },
  {
    name: "get_client_keywords",
    description:
      "A client's keyword set: how many were written, how many a person APPROVED, the split by category, and the top phrases with their provenance and whether an engine currently names the client for each. Only approved 'query' rows can become pages.",
    input_schema: {
      type: "object" as const,
      properties: {
        ...CLIENT_ARG,
        use: { type: "string", description: "'query' (things people type, the default) or 'hook' (marketing lines, never page targets)." },
        approved_only: { type: "boolean", description: "Default true. False includes what has not been approved yet." },
        category: { type: "string", description: "Filter to one category key, e.g. price or comparison." },
        limit: { type: "number", description: "How many phrases to return. Default 40." },
      },
      required: ["client"],
    },
  },
  {
    name: "get_client_plan",
    description:
      "The page plan: one pillar plus its supports, each with its target keyword, working title, theme and whether the page has been drafted. Includes the link to the visual plan map.",
    input_schema: { type: "object" as const, properties: { ...CLIENT_ARG }, required: ["client"] },
  },
  {
    name: "get_client_pages",
    description: "The client's pages and their status: draft, published or archived. Drafts are the normal state before Day 0.",
    input_schema: { type: "object" as const, properties: { ...CLIENT_ARG }, required: ["client"] },
  },
  {
    name: "get_client_audits",
    description:
      "This client's visibility runs, newest first, each one saying WHICH KIND it is: their baseline photograph, or a measurement we fired ourselves (Photograph II, a day 30/60/90 re-test). Never present the two as one trend. Includes any call notes on the report.",
    input_schema: {
      type: "object" as const,
      properties: { ...CLIENT_ARG, limit: { type: "number", description: "How many runs. Default 10." } },
      required: ["client"],
    },
  },
  {
    name: "get_client_docs",
    description: "Documents filed against a client: screenshots and files people uploaded, and the PDFs this system generated (the call pack, the review card, the question set).",
    input_schema: { type: "object" as const, properties: { ...CLIENT_ARG }, required: ["client"] },
  },
  {
    name: "search_client_events",
    description:
      "Search everything said and done about a client: every Slack message, command, button press, file and bot post, in order. Use for 'what did we tell X', 'when did we approve X's keywords', 'what happened on X last week'.",
    input_schema: {
      type: "object" as const,
      properties: {
        ...CLIENT_ARG,
        contains: { type: "string", description: "Only events whose text contains this." },
        step_key: { type: "string", description: "Only events in one step's thread, e.g. keyword_set." },
        kinds: {
          type: "array",
          items: { type: "string" },
          description: "Filter by kind: message, command, button, file, bot_post, assistant_reply.",
        },
        since: { type: "string", description: "ISO date. Only events after it." },
        limit: { type: "number", description: "How many events. Default 50, newest first." },
      },
      required: ["client"],
    },
  },
];

export const CLIENT_TOOL_NAMES = new Set(CLIENT_TOOLS.map((t) => t.name));

/**
 * Resolve the `client` argument, or hand back a refusal the model can read out.
 *
 * An ambiguous name returns the candidates: the assistant should ask which one, never pick. The
 * page studio's rule, and for the same reason -- guessing opens work against the wrong client.
 */
async function need(input: Input): Promise<{ id: string; name: string } | ToolExecutionResult> {
  const ref = s(input.client);
  if (!ref) return fail("Name a client: a slug, a name, a domain or an id.");

  const found = await resolveClient(ref);
  if (found.ok) return { id: found.client.id, name: found.client.name };

  return fail(found.error, {
    candidates: found.candidates.map((c) => ({ name: c.name, slug: c.slug, id: c.id })),
    next: found.candidates.length > 1 ? "Ask which one, by slug. Do not choose." : undefined,
  });
}

function isRefusal(v: unknown): v is ToolExecutionResult {
  return typeof v === "object" && v !== null && "content" in v && "structuredData" in v;
}

export async function executeClientTool(toolName: string, input: Input): Promise<ToolExecutionResult> {
  try {
    if (toolName === "find_client") {
      const query = s(input.query);
      if (!query) return fail("Say what to search for.");
      const found = await resolveClient(query);
      return found.ok
        ? result({ tool: "find_client", client: found.client })
        : fail(found.error, { candidates: found.candidates });
    }

    const client = await need(input);
    if (isRefusal(client)) return client;

    const reads = await import("./clients/client-reads");

    switch (toolName) {
      case "get_client_profile": {
        const profile = await reads.clientProfile(client.id);
        if ("error" in profile) return fail(profile.error);
        return result({ tool: "get_client_profile", ...profile });
      }

      case "get_client_keywords": {
        const keywords = await reads.clientKeywords({
          clientId: client.id,
          use: s(input.use) === "hook" ? "hook" : "query",
          approvedOnly: input.approved_only !== false,
          category: s(input.category) ?? null,
          limit: n(input.limit),
        });
        if ("error" in keywords) return fail(keywords.error);
        return result({ tool: "get_client_keywords", client: client.name, ...keywords });
      }

      case "get_client_plan": {
        const plan = await reads.clientPlan(client.id);
        if ("error" in plan) return fail(plan.error);
        return result({ tool: "get_client_plan", client: client.name, ...plan });
      }

      case "get_client_pages":
        return result({
          tool: "get_client_pages",
          client: client.name,
          pages: await reads.clientPages(client.id),
        });

      case "get_client_audits":
        return result({
          tool: "get_client_audits",
          client: client.name,
          runs: await reads.clientAudits(client.id, n(input.limit) ?? 10),
        });

      case "get_client_docs":
        return result({
          tool: "get_client_docs",
          client: client.name,
          docs: await reads.clientDocs(client.id),
        });

      case "search_client_events": {
        const { readClientEvents } = await import("./clients/client-events");
        const kinds = Array.isArray(input.kinds)
          ? (input.kinds as unknown[]).map((k) => String(k)).filter(Boolean)
          : undefined;
        const events = await readClientEvents({
          clientId: client.id,
          contains: s(input.contains) ?? null,
          stepKey: s(input.step_key) ?? null,
          kinds: kinds as never,
          since: s(input.since) ?? null,
          limit: n(input.limit) ?? 50,
        });
        return result({ tool: "search_client_events", client: client.name, count: events.length, events });
      }

      default:
        return fail(`Unknown client tool: ${toolName}`);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The client read failed.");
  }
}
