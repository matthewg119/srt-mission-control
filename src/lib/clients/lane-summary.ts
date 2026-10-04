// The OTHER lane's board, as text, for a conversation that has to answer questions about it.
//
// ‼️ THIS IS THE ONE DELIBERATE BRIDGE BETWEEN THE TWO LANES, AND IT LIVES HERE RATHER THAN IN
// src/lib/launch/ FOR EXACTLY THAT REASON.
//
// _probe-launch-isolation.ts bans src/lib/launch/ from importing config/delivery-steps and the
// Slack step engine, and that ban is right: two engines that import each other are one engine with
// twice the surface area. But a client can legitimately exist on BOTH boards (SRT does), and when
// somebody asks the onboarding chat "what about step 21" the honest answer is not "there is no
// step 21, the board ends at 17". That answer was given, in production, on 2026-10-03.
//
// So the bridge is READ-ONLY, RETURNS TEXT, AND CALLS NOTHING. It reads a shared table and a
// config array and renders a description. It cannot tick, verify, advance or refuse anything on
// either board. A launch-lane file importing THIS is importing a summary, not an engine, and the
// probe asserts that this is the only such file so the exemption stays one line long.
//
// ‼️ IF YOU ARE ABOUT TO ADD A SECOND BRIDGE, DON'T. Widen this one, or ask whether the thing you
// want really belongs in a lane at all.

import { supabaseAdmin } from "@/lib/db";
import { DELIVERY_STEPS, stepNumber, type StepKey } from "@/config/delivery-steps";

export interface SlackLaneSummary {
  /** False when this client has no Slack board at all, which is the normal case for a new client. */
  present: boolean;
  total: number;
  settled: number;
  /** The first step that is neither complete nor skipped. */
  openStep: { number: number; key: string; label: string; status: string } | null;
  text: string;
}

const RESOLVED = new Set(["complete", "skipped"]);

export async function slackLaneSummary(clientId: string): Promise<SlackLaneSummary> {
  const empty: SlackLaneSummary = { present: false, total: 0, settled: 0, openStep: null, text: "" };

  const { data, error } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status, verified_detail")
    .eq("client_id", clientId);

  // ‼️ A READ FAILURE IS SILENCE, NOT A CLAIM. Saying "this client has no Slack board" because
  // Supabase blinked is the kind of confident wrong answer this whole file exists to stop.
  if (error || !data || data.length === 0) return empty;

  const byKey = new Map(
    data.map((r) => [String(r.step_key), { status: String(r.status), detail: (r.verified_detail as string | null) ?? null }])
  );

  const lines: string[] = [];
  let settled = 0;
  let openStep: SlackLaneSummary["openStep"] = null;

  for (const step of DELIVERY_STEPS) {
    const row = byKey.get(step.key);
    if (!row) continue;
    const n = stepNumber(step.key as StepKey);
    if (RESOLVED.has(row.status)) settled += 1;
    else if (!openStep) openStep = { number: n, key: step.key, label: step.label, status: row.status };

    const mark = row.status === "complete" ? "done" : row.status === "skipped" ? "skipped" : row.status;
    const why = row.detail ? ` (${row.detail.slice(0, 120)})` : "";
    lines.push(`  ${n}. ${step.key} — ${step.label}: ${mark}${why}`);
  }

  const total = lines.length;
  const text = [
    "THE SLACK BOARD, WHICH THIS CLIENT IS ALSO ON:",
    // ‼️ COUNTED, NEVER WRITTEN DOWN. The Slack board has been 43, then 41, then 37, and a sentence
    // naming a number is wrong within a month of being written. `total` is also not the board's
    // length: it is how many of THIS client's rows still match a step the config lists, so a
    // client seeded before a step was retired reads lower, which is the honest figure.
    `  ${settled} of ${total} settled, out of ${DELIVERY_STEPS.length} steps on the board today. Worked in the client's own Slack channel.`,
    openStep
      ? `  OPEN THERE: step ${openStep.number}, ${openStep.key} — ${openStep.label} (${openStep.status}).`
      : "  Nothing is open there.",
    "",
    ...lines,
  ].join("\n");

  return { present: true, total, settled, openStep, text };
}
