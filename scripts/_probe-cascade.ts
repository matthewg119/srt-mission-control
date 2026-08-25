/**
 * Probe: confirming step 2 makes steps 7 and 9 appear BY THEMSELVES.
 *
 *   bunx tsx --env-file=.env.local scripts/_probe-cascade.ts [--keep]
 *
 * ‼️ WHY THIS CANNOT BE PROVED ON THE REAL CLIENT. scripts/_debug-post-all-steps.ts deliberately
 * ignores blockedBy and forces an anchor out for all thirty-three steps, and it has been run
 * against SRT Agency LLC. postStepAnchor short-circuits on an existing anchor and postReadySteps
 * skips any row that already has a slack_message_ts, so the code path under test can never run
 * again on that client. A throwaway client is the only way to observe the cascade.
 *
 * THE PROPOSITION: with baseline_scan confirmed, competitor_shortlist (manual) gets an anchor
 * and a card, and avatar_harvest (auto_then_manual) runs its generator and THEN gets a card,
 * without anybody doing anything. Both are blockedBy ["baseline_scan"]. The second is the case
 * that starved before ac0b733, which is why `ready` plus a card is asserted rather than just
 * "an anchor exists".
 *
 * ‼️ WHAT IT CANNOT PROVE, and does not claim to: that Slack RENDERED anything (only that a ts
 * came back), and that a real audit produces competitors. Both are correct limits. The thing
 * under test is the cascade, and a test that also depended on the audit engine would fail for
 * reasons that have nothing to do with it.
 */

import { DELIVERY_STEPS } from "../src/config/delivery-steps";
import { supabaseAdmin } from "../src/lib/db";

// ‼️ NEVER AGAINST THE REAL CHANNEL. This probe posts real anchors, and a throwaway client in
// #onboarding-srt-aeo would leave permanent top-level messages that cannot be reordered later.
// postStepAnchor and notifyStep read this one env var and are the only door, so pointing it
// somewhere else is a complete redirect.
const PRODUCTION_CHANNELS = ["C0BLK797PNU"];

const KEEP = process.argv.includes("--keep");

let failures = 0;

function ok(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function stepRows(clientId: string) {
  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status, slack_anchor_ts, slack_message_ts, output_ref, error_detail")
    .eq("client_id", clientId);
  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of data ?? []) byKey.set(r.step_key as string, r as Record<string, unknown>);
  return byKey;
}

async function cleanup(clientId: string, reportId: string | null) {
  if (KEEP) {
    console.log(`\n--keep given. Client ${clientId} left in place.`);
    return;
  }
  // audit_runs and audit_reports key on report_id, not on the client, so they do not cascade.
  if (reportId) {
    await supabaseAdmin.from("audit_runs").delete().eq("report_id", reportId);
    await supabaseAdmin.from("audit_reports").delete().eq("id", reportId);
  }
  // client_delivery_steps, client_docs, nap_discrepancies, competitor_candidates,
  // review_audit_rows and client_dns_records all cascade on client_id.
  await supabaseAdmin.from("clients").delete().eq("id", clientId);
  console.log(`\nCleaned up client ${clientId}.`);
}

async function main() {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL ?? "";
  if (!channel) {
    console.error(
      "SLACK_CLIENT_ONBOARDING_CHANNEL is not set. Point it at a SCRATCH channel and run again."
    );
    process.exit(1);
  }
  if (PRODUCTION_CHANNELS.includes(channel)) {
    console.error(
      `Refusing to run: SLACK_CLIENT_ONBOARDING_CHANNEL is ${channel}, which is the production ` +
        "onboarding channel. This probe posts real anchors and they cannot be reordered later. " +
        "Point it at a scratch channel."
    );
    process.exit(1);
  }
  console.log(`Posting into ${channel}.\n`);

  const { startPilot } = await import("../src/lib/clients/provision");
  const { seedDeliverySteps, setDeliveryStep } = await import(
    "../src/lib/clients/delivery-checklist"
  );

  // Through startPilot rather than a raw insert: that is what seeds the eight pilot stages and
  // mints the token, and a raw insert would be testing a client shape that never occurs.
  // No website, so chooseSubdomain and the DNS work stay out of the way.
  const stamp = process.env.PROBE_STAMP ?? String(Number(process.env.PROBE_EPOCH ?? "0") || 1);
  const created = await startPilot({
    legalName: `ZZ Cascade Probe ${stamp}`,
    email: `cascade-probe-${stamp}@example.com`,
    billingStatus: "pilot",
  });

  if (!created.ok) {
    console.error("Could not create the throwaway client:", created.error);
    process.exit(1);
  }

  const clientId = created.clientId;
  let reportId: string | null = null;
  console.log(`Throwaway client ${clientId}\n`);

  try {
    await seedDeliverySteps(clientId);

    // ── Get to the starting line: confirm step 1 ────────────────────────────
    await supabaseAdmin
      .from("clients")
      .update({ intake_completed_at: new Date().toISOString() })
      .eq("id", clientId);

    const step1 = await setDeliveryStep({
      clientId,
      stepKey: "intake_received",
      transition: "complete",
      actor: "cascade probe",
    });
    ok("step 1 confirms", step1.ok, step1.error);

    let rows = await stepRows(clientId);

    console.log("\nAfter step 1");
    for (const key of ["baseline_scan", "site_dns_intel", "nap_sweep"]) {
      ok(`${key} has an anchor`, Boolean(rows.get(key)?.slack_anchor_ts));
    }
    // ‼️ THE NEGATIVE IS HALF THE PROOF, and it is the half _debug-post-all-steps.ts destroyed
    // on the real client. If 7 and 9 are already anchored here, the cascade below proves nothing.
    for (const key of ["competitor_shortlist", "avatar_harvest"]) {
      ok(
        `${key} has NO anchor yet, because baseline_scan is not confirmed`,
        !rows.get(key)?.slack_anchor_ts,
        String(rows.get(key)?.slack_anchor_ts ?? "")
      );
    }

    // ── Satisfy step 2 the way production does ─────────────────────────────
    //
    // The rows are inserted directly rather than by running a real audit: the proposition is
    // about the CASCADE, not the audit engine, and a real run costs twenty model calls. It is
    // also a live regression test for the baseline_scan fix, because with the old verifier
    // reading clients.audit_report_id this step could not pass at all.
    const { data: report } = await supabaseAdmin
      .from("audit_reports")
      .insert({
        slug: `cascade-probe-${stamp}`,
        client_name: `ZZ Cascade Probe ${stamp}`,
        status: "done",
        score: 3,
        client_id: clientId,
      })
      .select("id")
      .single();

    reportId = (report?.id as string | null) ?? null;
    ok("a done audit_reports row exists for the client", Boolean(reportId));
    if (!reportId) throw new Error("no report id");

    await supabaseAdmin.from("audit_runs").insert([
      { report_id: reportId, block: 1, prompt: "q1", engine: "chatgpt_web", status: "ok" },
      { report_id: reportId, block: 1, prompt: "q2", engine: "chatgpt_web", status: "ok" },
      // One no_data, so the answered count is actually exercised rather than equal to the total.
      { report_id: reportId, block: 1, prompt: "q3", engine: "chatgpt_web", status: "no_data" },
    ]);

    const step2 = await setDeliveryStep({
      clientId,
      stepKey: "baseline_scan",
      transition: "complete",
      actor: "cascade probe",
    });
    ok("step 2 confirms from audit_runs", step2.ok, step2.error);
    ok(
      "step 2's evidence is system tier",
      step2.verdict?.ok === true && step2.verdict.kind === "system",
      step2.verdict && !step2.verdict.ok ? step2.verdict.found : undefined
    );

    // ── The proposition ────────────────────────────────────────────────────
    rows = await stepRows(clientId);

    console.log("\nAfter step 2, nobody having done anything else");

    const seven = rows.get("competitor_shortlist");
    ok("competitor_shortlist got an anchor by itself", Boolean(seven?.slack_anchor_ts));
    ok("competitor_shortlist got its card", Boolean(seven?.slack_message_ts));
    ok(
      "competitor_shortlist is awaiting_me",
      seven?.status === "awaiting_me",
      String(seven?.status ?? "missing")
    );

    const nine = rows.get("avatar_harvest");
    ok("avatar_harvest got an anchor by itself", Boolean(nine?.slack_anchor_ts));
    // `ready` plus a card is precisely "the runner ran and then waited for a person", which is
    // the invariant that broke when postReadySteps ran before runReadyAutoSteps and parked the
    // row at awaiting_me where no runner could ever claim it.
    ok("avatar_harvest ran its generator and waited", nine?.status === "ready", String(nine?.status ?? "missing"));
    ok("avatar_harvest filed an output_ref", Boolean(nine?.output_ref));
    ok("avatar_harvest got its card", Boolean(nine?.slack_message_ts));

    // ── Anchors are in DELIVERY_STEPS order ────────────────────────────────
    //
    // Slack orders by post time and nothing reorders it, so a step anchored out of turn is at
    // the wrong place in the channel permanently. Cheap to assert, and it is the regression
    // test for "1, 3, 4, 15, 2, 5, 19".
    const anchored = DELIVERY_STEPS.map((s) => ({
      key: s.key,
      ts: (rows.get(s.key)?.slack_anchor_ts as string | null) ?? null,
    })).filter((a) => a.ts);

    const sorted = [...anchored].sort((a, b) => Number(a.ts) - Number(b.ts));
    ok(
      "every anchor was posted in DELIVERY_STEPS order",
      anchored.every((a, i) => a.key === sorted[i].key),
      sorted.map((a) => a.key).join(" -> ")
    );

    const errored = [...rows.entries()].filter(([, r]) => r.status === "error");
    ok(
      "no step is in error",
      errored.length === 0,
      errored.map(([k, r]) => `${k}: ${r.error_detail}`).join("; ")
    );
  } finally {
    await cleanup(clientId, reportId);
  }
}

main()
  .catch((e) => {
    failures += 1;
    console.error("\nprobe threw:", (e as Error).message);
  })
  .finally(() => {
    console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED.\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
