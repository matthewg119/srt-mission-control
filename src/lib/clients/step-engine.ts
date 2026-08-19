// The step engine: one threaded Slack post per step that needs a person.
//
// Runner v3 §3. "Tasks needing me post a threaded message with imperative sentences and the
// EXACT string to search or paste. Never 'check the listing.' Always 'Search Google for:
// Acme Med Spa Greensboro NC'."
//
// That instruction is the whole design. A checklist row saying "Presence sweep, manual
// tier" is a to-do; the same row with eighteen search strings already composed from the
// canonical NAP is work you can actually start. The difference is whether it gets done on a
// Tuesday afternoon.
//
// ‼️ NOTHING HERE AUTO-ADVANCES PAST A HUMAN. §2: manual steps "go 'done' ONLY when I click
// the button. Never infer completion from a file upload." A screenshot landing in the thread
// files evidence and the step WAITS. [Done] reads that evidence to tell you what looks
// missing — and then still waits for you to press it.

import { supabaseAdmin } from "@/lib/db";
import { slack, type SlackBlock } from "@/lib/slack-bot";
import { DELIVERY_STEPS, stepByKey, type DeliveryStep } from "@/lib/clients/delivery-checklist";

/** Platforms with no usable search API. §6's manual tier, core six first. */
const CORE_SIX = ["Google", "Apple Maps", "Bing", "Yelp", "RealSelf", "Facebook"];
const EXTENDED = [
  "Yellow Pages", "BBB", "Nextdoor", "Manta", "Healthgrades", "NPI Registry",
  "MapQuest", "Superpages", "Hotfrog", "Citysearch", "Foursquare", "local chamber",
];

interface ClientFacts {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  phone: string | null;
}

/**
 * The literal instructions for one step.
 *
 * Returns null for a step that needs no extra explanation — the label is the instruction and
 * padding it with boilerplate teaches people to stop reading these posts.
 */
function instructionsFor(step: DeliveryStep, c: ClientFacts): string[] | null {
  const where = [c.city, c.state].filter(Boolean).join(" ");
  const q = `${c.name} ${where}`.trim();

  switch (step.key) {
    case "presence_sweep_manual":
      return [
        "For each: screenshot showing name, address and phone. If there is no listing,",
        "screenshot the empty search result — that IS the evidence for \"missing\".",
        "",
        "*Core six* — these are the ones we fix in week one:",
        ...CORE_SIX.map((p, i) => `  ${i + 1}. ${p} — search: \`${q}\``),
        "",
        "*Extended* — context only, not week-one cleanup:",
        ...EXTENDED.map((p, i) => `  ${CORE_SIX.length + i + 1}. ${p} — search: \`${q}\``),
        "",
        "Reply in this thread with the screenshots, then hit Done.",
      ];

    case "competitor_shortlist":
      return [
        "Ten candidates are on the board, ranked by how many of the twenty questions named",
        "them and across which engines. Google each one yourself before picking — the URL is",
        "on the card. Pick exactly three. Nothing after this moves until you do.",
      ];

    case "avatar_confirmed":
      return [
        "The proposal is on the board. Audit avatars are CANDIDATES only, and only when the",
        "cached niche matches this client's vertical — they are cached per niche, not per",
        "business, so every med spa audited this month has the same three. Map one to",
        "a1 / a2 / a3 or reject them all.",
      ];

    case "access_granted":
      return [
        "Per platform, the literal ask:",
        "  • *GBP* — business.google.com, select the clinic, Users, Add, invite us as Manager",
        "  • *Search Console* — search.google.com/search-console, add the domain as a Domain property",
        "  • *Analytics* — analytics.google.com, Admin, Property Access Management, add us as Editor",
        "",
        "If the GBP is unclaimed, claim it together on the call — it is instant and it is a",
        "credibility moment. If an old agency holds it, start Google's ownership request ON",
        "THE CALL: it is a fixed seven-day wait and it is usually the long pole.",
      ];

    case "dns_records":
      return [
        "*Three records: two CNAMEs and one TXT.* Say it that way — \"CNAME and TXT\" reads as",
        "two, and that is where the count drifted before. The exact values are on the DNS panel.",
        "Never ask for registrar credentials. They drive.",
      ];

    case "cards_printed":
      return [
        "The card PDF is on the board. The QR points at the reviews host, which is live from",
        "the moment the domain is attached, so the cards work before the hub has pages.",
      ];

    case "review_tool_handed":
      return [
        "Hand it to the NAMED person from the call sheet — a name, not \"the front desk\".",
        "Restate once: every patient, own phone at home, nothing offered, nobody prompted",
        "for a name.",
      ];

    default:
      return null;
  }
}

/** How many files this step expects in its thread before [Done] stops complaining. */
function expectedUploads(step: DeliveryStep): number {
  if (step.key === "presence_sweep_manual") return CORE_SIX.length + EXTENDED.length;
  return 0;
}

function blocks(step: DeliveryStep, c: ClientFacts, body: string[]): SlackBlock[] {
  const out: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${c.name}* · ${step.phase}\n*${step.label}*`,
      },
    },
  ];

  if (body.length) {
    out.push({ type: "section", text: { type: "mrkdwn", text: body.join("\n") } });
  }

  out.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Done" },
        style: "primary",
        action_id: "step_done",
        value: `${c.id}:${step.key}`,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Skip — not applicable" },
        action_id: "step_skip",
        value: `${c.id}:${step.key}`,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "I hit a problem" },
        action_id: "step_problem",
        value: `${c.id}:${step.key}`,
      },
    ],
  } as SlackBlock);

  return out;
}

async function loadFacts(clientId: string): Promise<ClientFacts | null> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, city, state, address_line1, postal_code, phone")
    .eq("id", clientId)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id as string,
    name: ((data.dba_name as string | null) || (data.legal_name as string)) ?? "this client",
    city: (data.city as string | null) ?? null,
    state: (data.state as string | null) ?? null,
    addressLine1: (data.address_line1 as string | null) ?? null,
    postalCode: (data.postal_code as string | null) ?? null,
    phone: (data.phone as string | null) ?? null,
  };
}

/**
 * Post one step to the client's thread and park it in awaiting_me.
 *
 * Idempotent on slack_message_ts: a step already posted is edited, never re-posted. §3's
 * "one message per tenant, updated in place" applied per step — a step that posts twice is
 * a step nobody trusts.
 */
export async function postStep(clientId: string, stepKey: string): Promise<void> {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel) return;

  const step = stepByKey(stepKey);
  if (!step) return;

  const [facts, { data: row }, { data: client }] = await Promise.all([
    loadFacts(clientId),
    supabaseAdmin
      .from("client_delivery_steps")
      .select("status, slack_message_ts")
      .eq("client_id", clientId)
      .eq("step_key", stepKey)
      .maybeSingle(),
    supabaseAdmin.from("clients").select("ops_thread_ts").eq("id", clientId).maybeSingle(),
  ]);

  if (!facts || !client?.ops_thread_ts) return;
  if (row?.status === "complete" || row?.status === "skipped") return;

  const body = instructionsFor(step, facts) ?? [];
  const kit = blocks(step, facts, body);
  const fallback = `${facts.name} · ${step.label}`;

  if (row?.slack_message_ts) {
    await slack
      .updateMessage(channel, row.slack_message_ts as string, fallback, kit)
      .catch(() => {});
  } else {
    const res = (await slack.postThreadReply(
      channel,
      client.ops_thread_ts as string,
      fallback,
      kit
    )) as { ok?: boolean; ts?: string };

    if (res?.ts) {
      await supabaseAdmin
        .from("client_delivery_steps")
        .update({ slack_message_ts: res.ts, updated_at: new Date().toISOString() })
        .eq("client_id", clientId)
        .eq("step_key", stepKey)
        // The claim: only write the ts if nothing has one, so two concurrent posts cannot
        // both win. Same shape as ops_checklist_ts.
        .is("slack_message_ts", null);
    }
  }

  await supabaseAdmin
    .from("client_delivery_steps")
    .update({
      status: "awaiting_me",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId)
    .eq("step_key", stepKey)
    .in("status", ["pending", "blocked", "ready", "error"]);
}

/**
 * How many files have been filed against this step's thread.
 *
 * §3: "[Done] on an upload task validates the expected file count landed in the thread; if
 * not, it names what's missing and stays open." Note what this does NOT do: it never ticks
 * the step. Evidence arriving is not a person saying they are finished.
 */
export async function uploadsFor(clientId: string, stepKey: string): Promise<number> {
  const { data: row } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("slack_message_ts")
    .eq("client_id", clientId)
    .eq("step_key", stepKey)
    .maybeSingle();

  const ts = (row?.slack_message_ts as string | null) ?? null;
  if (!ts) return 0;

  const { count } = await supabaseAdmin
    .from("client_docs")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("slack_thread_ts", ts);

  return count ?? 0;
}

/** Expected-vs-actual, for the [Done] handler's refusal message. */
export function expectedFor(stepKey: string): number {
  const step = stepByKey(stepKey);
  return step ? expectedUploads(step) : 0;
}

/**
 * Post whichever manual steps are now startable and have never been posted.
 *
 * Called after any step transition. Deliberately conservative: it posts only steps whose
 * blockers are ALL complete, so the thread fills up in the order the work actually happens
 * rather than dumping 33 cards on day one.
 */
export async function postReadySteps(clientId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status, slack_message_ts")
    .eq("client_id", clientId);

  const rows = data ?? [];
  const done = new Set(
    rows.filter((r) => r.status === "complete" || r.status === "skipped").map((r) => r.step_key as string)
  );
  const posted = new Set(
    rows.filter((r) => r.slack_message_ts).map((r) => r.step_key as string)
  );

  for (const step of DELIVERY_STEPS) {
    if (step.mode === "auto") continue;
    if (done.has(step.key) || posted.has(step.key)) continue;
    if ((step.blockedBy ?? []).some((k) => !done.has(k))) continue;

    await postStep(clientId, step.key).catch((e) =>
      console.error(`[step-engine] post ${step.key} failed:`, (e as Error).message)
    );
  }
}

/**
 * Run whichever AUTO steps are now runnable and have not run.
 *
 * ‼️ THE COUNTERPART TO postReadySteps, AND THE THING THAT WAS MISSING.
 * postReadySteps skips `mode === "auto"` on the first line of its loop, and nothing else ran
 * those steps either — so five rows rendered `_auto_` in Slack forever while no code behind them
 * existed. This is the other half: manual steps get posted to a person, auto steps get executed.
 *
 * Conservative in the same way postReadySteps is:
 *  - only when every blocker is complete, so work happens in the order it actually happens;
 *  - only when the step has never started, so a re-entrant call cannot run a generator twice;
 *  - claimed with a conditional UPDATE before running, because two step transitions landing at
 *    once would otherwise both see 'ready' and both generate a PDF.
 *
 * An auto step that FAILS goes to 'error' with the reason on the row. It does not retry itself
 * and it does not block: the daily digest surfaces errors, and a human decides. A generator that
 * silently retried would spend an audit's worth of fetches on a client whose website is down.
 *
 * ‼️ A STEP THAT GENERATES SOMETHING BUT STILL NEEDS A PERSON DOES NOT COMPLETE ITSELF.
 * `auto_then_manual` runs its generator and then posts the card and waits, exactly as Runner v3
 * §2 requires: "Never auto-advance past a human." avatar_harvest is the live example — the
 * cited-source harvest is finished, the deep-research brief is not until somebody runs it.
 */
export async function runReadyAutoSteps(clientId: string): Promise<void> {
  const { AUTO_RUNNERS } = await import("./artifacts/registry");

  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status")
    .eq("client_id", clientId);

  const rows = data ?? [];
  const done = new Set(
    rows.filter((r) => r.status === "complete" || r.status === "skipped").map((r) => r.step_key as string)
  );
  const byKey = new Map(rows.map((r) => [r.step_key as string, r.status as string]));

  for (const step of DELIVERY_STEPS) {
    const runner = AUTO_RUNNERS[step.key];
    if (!runner) continue;

    const status = byKey.get(step.key);
    // 'pending', 'blocked' and 'ready' are all startable. 'running', 'awaiting_me', 'complete',
    // 'skipped' and 'error' are not: the first is in flight, the rest have had their turn.
    if (!status || !["pending", "blocked", "ready"].includes(status)) continue;
    if ((step.blockedBy ?? []).some((k) => !done.has(k))) continue;

    // The claim. `.in("status", ...)` makes this conditional: the loser of a race updates zero
    // rows and gets no data back, so exactly one caller runs the generator.
    const { data: claimed } = await supabaseAdmin
      .from("client_delivery_steps")
      .update({ status: "running", started_at: new Date().toISOString(), error_detail: null })
      .eq("client_id", clientId)
      .eq("step_key", step.key)
      .in("status", ["pending", "blocked", "ready"])
      .select("id");

    if (!claimed?.length) continue;

    let result: { ok: boolean; error?: string; note?: string };
    try {
      result = await runner(clientId);
    } catch (e) {
      result = { ok: false, error: (e as Error).message };
    }

    if (!result.ok) {
      await supabaseAdmin
        .from("client_delivery_steps")
        .update({ status: "error", error_detail: result.error ?? "unknown", updated_at: new Date().toISOString() })
        .eq("client_id", clientId)
        .eq("step_key", step.key);

      const { notifyThread } = await import("./delivery-checklist");
      await notifyThread(clientId, `:warning: *${step.label}* failed: ${result.error ?? "unknown"}`).catch(() => {});
      continue;
    }

    if (result.note) {
      const { notifyThread } = await import("./delivery-checklist");
      await notifyThread(clientId, result.note).catch(() => {});
    }

    if (step.mode === "auto_then_manual") {
      // Generated, now waiting on a person. Post the card and stop.
      await supabaseAdmin
        .from("client_delivery_steps")
        .update({ status: "ready", updated_at: new Date().toISOString() })
        .eq("client_id", clientId)
        .eq("step_key", step.key);
      await postStep(clientId, step.key).catch(() => {});
      continue;
    }

    const { autoCompleteStep } = await import("./delivery-checklist");
    await autoCompleteStep(clientId, step.key).catch((e) =>
      console.error(`[step-engine] completing ${step.key} failed:`, (e as Error).message)
    );
  }
}

/**
 * The daily #alerts-infra digest. Runner v3 §3.
 *
 * "Tasks in 'error', and tasks 'awaiting_me' longer than 48h."
 *
 * Two states and no others, on purpose. A digest that lists everything outstanding is a
 * digest nobody reads by week three, and the checklist message already shows what is
 * outstanding. These two are different: an error will never resolve itself, and a step that
 * has been waiting two days has been forgotten rather than deferred.
 */
export async function stepDigest(): Promise<string | null> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("client_id, step_key, status, updated_at, error_detail, clients!inner(legal_name, dba_name)")
    .in("status", ["error", "awaiting_me"]);

  const rows = (data ?? []) as unknown as Array<{
    client_id: string;
    step_key: string;
    status: string;
    updated_at: string;
    error_detail: string | null;
    clients: { legal_name: string; dba_name: string | null };
  }>;

  const errors = rows.filter((r) => r.status === "error");
  const stale = rows.filter((r) => r.status === "awaiting_me" && r.updated_at < cutoff);

  if (!errors.length && !stale.length) return null;

  const name = (r: (typeof rows)[number]) => r.clients.dba_name || r.clients.legal_name;
  const label = (k: string) => stepByKey(k)?.label ?? k;
  const lines: string[] = [];

  if (errors.length) {
    lines.push(`*${errors.length} step${errors.length === 1 ? "" : "s"} in error*`);
    for (const r of errors) {
      lines.push(`  • ${name(r)} — ${label(r.step_key)}${r.error_detail ? `: ${r.error_detail}` : ""}`);
    }
  }

  if (stale.length) {
    if (lines.length) lines.push("");
    lines.push(`*${stale.length} waiting more than 48h*`);
    for (const r of stale) {
      const days = Math.floor((Date.now() - new Date(r.updated_at).getTime()) / 86400000);
      lines.push(`  • ${name(r)} — ${label(r.step_key)} (${days}d)`);
    }
  }

  return lines.join("\n");
}
