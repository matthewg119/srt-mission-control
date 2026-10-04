// The front door: "who are you onboarding today?", before a client exists.
//
// ‼️ IT IS A ROUTER, NOT A CLIENT THREAD, AND IT IS DELIBERATELY STATELESS.
// launch_conversations is unique on client_id because Matthew's rule is one client per thread and
// never two. This conversation has no client yet, so it cannot be one of those rows without making
// that column nullable and the invariant softer. It carries its history in the request instead,
// exactly as /api/today/chat does, and the moment a client is picked or created the UI leaves for
// that client's real thread. Nothing said here is worth keeping: it is a question about which
// board to open.
//
// ‼️ IT CREATES CLIENTS AND THAT IS THE ONLY WRITE IT HAS.
// startLaunchClient() is reused whole. It already reuses startPilot(), which owns the slug
// collision retry, the market overlap check and the CRM link, and validateLaunchIntake() is the
// same validator the form and the step 1 verifier run. A second definition of "a valid intake" is
// what let 777777777 be stored as a state.

import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { supabaseAdmin } from "@/lib/db";
import { validateLaunchIntake, type IntakeField } from "@/lib/validate/intake-fields";
import { startLaunchClient } from "./provision";
import { LAUNCH_STEPS } from "@/config/launch-steps";

const DOOR_MODEL: ClaudeModel = "claude-sonnet-4-6";

export interface DoorMessage {
  role: "user" | "assistant";
  content: string;
}

export interface DoorResult {
  say: string;
  asks: string[];
  /** Set when a client was created or chosen. The UI leaves for that client's thread. */
  openClientId: string | null;
  openClientName: string | null;
  /** Field-by-field refusals from the shared validator, when a create was attempted and refused. */
  problems: string[];
}

interface DoorPlan {
  say: string;
  asks: string[];
  action: {
    kind: "none" | "create_client" | "open_client";
    clientId?: string;
    email?: string;
    legalName?: string;
    dbaName?: string;
    phone?: string;
    addressLine1?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    verticalSlug?: string;
    website?: string;
  };
  confidence: number;
}

function isDoorPlan(v: unknown): v is DoorPlan {
  const p = v as DoorPlan;
  return (
    !!p &&
    typeof p.say === "string" &&
    Array.isArray(p.asks) &&
    !!p.action &&
    typeof p.action.kind === "string" &&
    typeof p.confidence === "number"
  );
}

export interface DoorClient {
  id: string;
  name: string;
  vertical: string | null;
  settled: number;
  total: number;
}

/** Every launch client, with how far along it is. Read only. */
export async function launchClients(): Promise<DoorClient[]> {
  const { data: rows } = await supabaseAdmin
    .from("clients")
    .select("id, slug, dba_name, legal_name, vertical_slug")
    .eq("onboarding_lane", "launch")
    .order("created_at", { ascending: false });

  const clients = rows ?? [];
  if (!clients.length) return [];

  const ids = clients.map((c) => c.id as string);
  const { data: steps } = await supabaseAdmin
    .from("client_launch_steps")
    .select("client_id, status")
    .in("client_id", ids);

  const settledBy = new Map<string, number>();
  for (const s of steps ?? []) {
    const status = s.status as string;
    if (status === "complete" || status === "skipped") {
      settledBy.set(s.client_id as string, (settledBy.get(s.client_id as string) ?? 0) + 1);
    }
  }

  return clients.map((c) => ({
    id: c.id as string,
    name: (c.dba_name as string) || (c.legal_name as string) || (c.slug as string),
    vertical: (c.vertical_slug as string) || null,
    settled: settledBy.get(c.id as string) ?? 0,
    total: LAUNCH_STEPS.length,
  }));
}

function systemPrompt(clients: DoorClient[]): string {
  const list = clients.length
    ? clients
        .map((c) => `  ${c.id} — ${c.name}${c.vertical ? ` (${c.vertical})` : ""}: ${c.settled} of ${c.total} settled`)
        .join("\n")
    : "  (none yet)";

  return [
    "You are the front door of SRT's onboarding. You are talking to Matthew, who owns the agency.",
    "Your only job is to work out WHICH client he is working on, then get out of the way.",
    "",
    "HOW TO TALK:",
    "- Terse. One line of context, then the ask. Never explain unless he asks.",
    "- Never use an em dash or an en dash. Use a comma or a full stop.",
    "- Ask for several things at once. He answers by pasting one voice note transcript, so a",
    "  batch of questions is faster for him than a sequence of single ones.",
    "- If he pastes a blob (a screenshot transcript, a Google Maps listing, a call note), pull",
    "  every field out of it and tell him which ones you filled. Then ask only for what is left.",
    "- Correct malformed values and say that you did. Never silently.",
    "",
    "THE TWO THINGS HE CAN DO:",
    '1. Start a NEW client. You need all of these before you may act: email, legalName, phone,',
    "   addressLine1, city, state, postalCode, verticalSlug. dbaName and website are optional.",
    "   website is the existing site, if the business already has one. Most do not: that is the",
    "   whole point of this lane, so leave it empty unless he gives you one.",
    "   verticalSlug is lowercase with hyphens, for example roofing-contractor or family-dentist.",
    "   It is required and cannot be guessed later, because there is no website for a scan to read.",
    "2. FINISH an existing one. Pick its id from the list below and use open_client.",
    "",
    "THE CLIENTS THAT ALREADY EXIST:",
    list,
    "",
    "YOUR ANSWER IS ONE JSON OBJECT:",
    '  action.kind "none"           you still need something from him. Put it in asks.',
    '  action.kind "create_client"  ONLY when you have every required field. Put them on action.',
    '  action.kind "open_client"    with action.clientId, an id copied exactly from the list.',
    "",
    "Never invent a client id. Never create a client while a required field is still missing or",
    "guessed: ask for it instead. If you are not sure, ask.",
    "",
    "If this is the first message, greet him in one line and ask who he is onboarding today: a new",
    "client, or finishing one of the ones listed above.",
  ].join("\n");
}

const FIELD_LABELS: Record<IntakeField, string> = {
  email: "business email",
  verticalSlug: "what the business is",
  legalName: "legal name",
  dbaName: "public facing name",
  phone: "phone",
  addressLine1: "street address",
  city: "city",
  state: "state",
  postalCode: "ZIP",
  website: "existing website",
};

/**
 * One turn of the front door.
 *
 * Throws only when the model is unreachable, so the surface can say so rather than swallow it.
 */
export async function runDoorTurn(args: {
  history: DoorMessage[];
  message: string;
  actor: string;
}): Promise<DoorResult> {
  const clients = await launchClients();

  const transcript = args.history
    .map((m) => `${m.role === "user" ? "MATTHEW" : "YOU"}: ${m.content}`)
    .join("\n\n");

  const result = await callClaudeJSON<DoorPlan>({
    model: DOOR_MODEL,
    system: systemPrompt(clients),
    user: [transcript, `MATTHEW: ${args.message}`].filter(Boolean).join("\n\n"),
    maxTokens: 1200,
    temperature: 0.3,
    validate: isDoorPlan,
    schemaHint:
      '{ "say": string, "asks": string[], "action": { "kind": "none" | "create_client" | ' +
      '"open_client", "clientId"?: string, "email"?: string, "legalName"?: string, ' +
      '"dbaName"?: string, "phone"?: string, "addressLine1"?: string, "city"?: string, ' +
      '"state"?: string, "postalCode"?: string, "verticalSlug"?: string, "website"?: string }, ' +
      '"confidence": number }',
  });

  const plan = result.data;
  const clean = (s: string) => (hasBannedDash(s) ? s.replace(/\s*[—–]\s*/g, ", ") : s);

  const say = clean(plan.say ?? "");
  const asks = (plan.asks ?? []).map((a) => clean(String(a)));
  const action = plan.action ?? { kind: "none" };

  if (action.kind === "open_client") {
    // ‼️ THE ID IS MATCHED AGAINST THE REAL LIST, NEVER TRUSTED. A model that invents a plausible
    // uuid would otherwise send him into a board for a client that does not exist, and the page
    // would 404 with no explanation of why.
    const found = clients.find((c) => c.id === (action.clientId ?? "").trim());
    if (!found) {
      return {
        say,
        asks: asks.length ? asks : ["Which of those clients did you mean?"],
        openClientId: null,
        openClientName: null,
        problems: ["That client id is not one of the ones on this lane."],
      };
    }
    return { say, asks, openClientId: found.id, openClientName: found.name, problems: [] };
  }

  if (action.kind === "create_client") {
    // The shared validator, not a second opinion. It returns EVERY bad field at once so one round
    // trip can fix all of them, which is the whole reason the form and the route both call it.
    const verdict = validateLaunchIntake({
      email: action.email,
      verticalSlug: action.verticalSlug,
      legalName: action.legalName,
      dbaName: action.dbaName,
      phone: action.phone,
      addressLine1: action.addressLine1,
      city: action.city,
      state: action.state,
      postalCode: action.postalCode,
      website: action.website,
    });

    if (!verdict.ok) {
      const problems = (Object.entries(verdict.errors) as [IntakeField, string][]).map(
        ([field, error]) => `${FIELD_LABELS[field] ?? field}: ${error}`
      );
      return {
        say,
        asks: asks.length ? asks : ["Give me those and I will open it."],
        openClientId: null,
        openClientName: null,
        problems,
      };
    }

    const v = verdict.values;
    const started = await startLaunchClient({
      email: v.email ?? "",
      verticalSlug: v.verticalSlug ?? "",
      legalName: v.legalName ?? null,
      dbaName: v.dbaName ?? null,
      phone: v.phone ?? null,
      addressLine1: v.addressLine1 ?? null,
      city: v.city ?? null,
      state: v.state ?? null,
      postalCode: v.postalCode ?? null,
      website: v.website ?? null,
    });

    if (!started.ok || !started.clientId) {
      return {
        say,
        asks: [],
        openClientId: null,
        openClientName: null,
        problems: [started.error ?? "The client could not be opened."],
      };
    }

    const name = v.dbaName || v.legalName || started.slug || "the client";
    return {
      say: say || `${name} is open.`,
      asks: [],
      openClientId: started.clientId,
      openClientName: name,
      problems: started.warnings ?? [],
    };
  }

  return { say, asks, openClientId: null, openClientName: null, problems: [] };
}
