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
 * THE PROPOSITION, rewritten 2026-08-25 for the one-at-a-time cursor: at every moment there is
 * EXACTLY ONE step waiting for a person, and resolving it reveals exactly one more. Auto steps
 * may share a moment, because they resolve themselves; two things to DO is the thing that must
 * never happen.
 *
 * That inverts what this probe used to assert. Confirming baseline_scan used to surface
 * competitor_shortlist AND avatar_harvest together, and the old version checked for both. Under
 * `reachableCursor` neither appears while the presence sweep is still open, so the negative is
 * now the interesting half and the walk down to step 9 is what proves the chain still advances.
 *
 * `ready` plus a card at step 9 is still asserted rather than just "an anchor exists": that is
 * the auto_then_manual invariant that starved before ac0b733.
 *
 * hub_preview is the specific trap this catches. Its only blocker is intake_received, so it is
 * reachable from the very first transition, and its runner posts a note through notifyStep,
 * which CREATES an anchor. Gate the anchor function alone and its top-level message still lands
 * in the channel out of turn, with nothing looking broken.
 *
 * ‼️ WHAT IT CANNOT PROVE, and does not claim to: that Slack RENDERED anything (only that a ts
 * came back), and that a real audit produces competitors. Both are correct limits. The thing
 * under test is the cascade, and a test that also depended on the audit engine would fail for
 * reasons that have nothing to do with it.
 */

import { DELIVERY_STEPS } from "../src/config/delivery-steps";
import { supabaseAdmin } from "../src/lib/db";
import { confirmAvatar } from "../src/lib/clients/avatars";

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

/**
 * Steps that are ANCHORED, unresolved, and wait for a person.
 *
 * The count this probe is really about. Auto steps are excluded because they resolve themselves
 * inside the same cascade and never ask anybody for anything, so several of them sharing a
 * moment is correct rather than a wall.
 */
function waiting(rows: Map<string, Record<string, unknown>>): string[] {
  return DELIVERY_STEPS.filter((s) => {
    const r = rows.get(s.key);
    if (!r?.slack_anchor_ts) return false;
    if (r.status === "complete" || r.status === "skipped") return false;
    return s.mode !== "auto";
  }).map((s) => s.key);
}

function eq(label: string, got: string, want: string) {
  ok(`${label} (${got})`, got === want, got === want ? undefined : `wanted ${want}`);
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
    //
    // ‼️ A CANONICAL NAP IS PART OF THE FIXTURE, and without it this probe measures the wrong
    // thing. nap_sweep refuses with "no canonical address or phone on the client record" and
    // parks in `error`; presence_sweep_manual is blockedBy it, so the ONE step that should be
    // waiting for a person after step 1 never becomes reachable and the board correctly shows
    // nothing to do. That is right behaviour and a useless test.
    //
    // ‼️ STILL NO DOMAIN, DELIBERATELY. A domain sends hub_preview's runner at Vercel to
    // ATTACH one, which is a real API call against the production project for a client that is
    // about to be deleted. site_dns_intel therefore fails on "no domain on the client", which
    // is expected and carved out of the error check at the end.
    await supabaseAdmin
      .from("clients")
      .update({
        intake_completed_at: new Date().toISOString(),
        address_line1: "1 Probe Street",
        city: "Greensboro",
        state: "NC",
        postal_code: "27410",
        phone: "+13368332303",
      })
      .eq("id", clientId);

    const step1 = await setDeliveryStep({
      clientId,
      stepKey: "intake_received",
      transition: "complete",
      actor: "cascade probe",
    });
    ok("step 1 confirms", step1.ok, step1.error);

    let rows = await stepRows(clientId);

    // ── After step 1 ────────────────────────────────────────────────────────
    //
    // The three auto steps below it all become reachable at once and all three resolve
    // themselves, so they legitimately share a moment. What must NOT happen is a second thing
    // for a person to do.
    console.log("\nAfter step 1");
    for (const key of ["baseline_scan", "site_dns_intel", "nap_sweep"]) {
      ok(`${key} has an anchor`, Boolean(rows.get(key)?.slack_anchor_ts));
    }
    ok("exactly one step is waiting for a person", waiting(rows).length === 1, waiting(rows).join(", "));
    eq("and it is the presence sweep", waiting(rows)[0] ?? "none", "presence_sweep_manual");

    // ‼️ THE NEGATIVE IS HALF THE PROOF, and it is the half _debug-post-all-steps.ts destroyed
    // on the real client: it forced anchors out for all 33 ignoring blockedBy, and
    // postStepAnchor short-circuits on an existing anchor, so the code path under test can
    // never run again there.
    for (const key of ["competitor_shortlist", "avatar_harvest", "hub_preview"]) {
      ok(
        `${key} has NO anchor yet`,
        !rows.get(key)?.slack_anchor_ts,
        String(rows.get(key)?.slack_anchor_ts ?? "")
      );
    }

    // ‼️ hub_preview IS THE ONE THAT PROVES runReadyAutoSteps IS GATED TOO. Its only blocker is
    // intake_received, so it is reachable the moment step 1 lands — and its runner posts a note
    // through notifyStep, which CREATES an anchor. Gating only the anchor function would leave
    // this step's top-level message in the channel anyway, with nothing looking broken.
    ok(
      "hub_preview's runner did not fire out of turn",
      rows.get("hub_preview")?.status !== "ready" && rows.get("hub_preview")?.status !== "complete",
      String(rows.get("hub_preview")?.status ?? "missing")
    );

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
        vertical_slug: "cascade_probe_vertical",
        business_type: "a throwaway used by the cascade probe",
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

    // ‼️ THE CLASSIFICATION IS ADOPTED WHEN STEP 2 CONFIRMS, and until 2026-08-25 nothing
    // anywhere wrote these two columns. Every client fell through to a hardcoded "med_spa" and
    // forty phrases were filed under it in a corpus that has no client_id to unpick them by.
    const { data: adopted } = await supabaseAdmin
      .from("clients")
      .select("vertical_slug, business_type")
      .eq("id", clientId)
      .maybeSingle();
    eq(
      "the audit's vertical landed on the client row",
      String(adopted?.vertical_slug ?? "null"),
      "cascade_probe_vertical"
    );
    ok("and its business type with it", Boolean(adopted?.business_type));

    // ── The proposition: ONE step at a time, and resolving it reveals the next ONE ──
    rows = await stepRows(clientId);

    console.log("\nAfter step 2, nobody having done anything else");
    ok("still exactly one step waiting", waiting(rows).length === 1, waiting(rows).join(", "));
    eq("and it is still the presence sweep", waiting(rows)[0] ?? "none", "presence_sweep_manual");
    // Before the cursor, confirming step 2 surfaced BOTH of these at once. Matthew asked for one.
    for (const key of ["competitor_shortlist", "avatar_harvest"]) {
      ok(`${key} still has no anchor`, !rows.get(key)?.slack_anchor_ts);
    }

    // ── Resolve step 5, and watch exactly one more appear ───────────────────
    //
    // Skipped rather than completed: the sweep needs six attributed screenshots in a Slack
    // thread and this probe cannot produce those. A skip is a resolution everywhere in this
    // system except the Day-0 wall, which is the point of using it here.
    const step5 = await setDeliveryStep({
      clientId,
      stepKey: "presence_sweep_manual",
      transition: "skipped",
      skippedReason: "cascade probe: no screenshots to file",
      actor: "cascade probe",
    });
    ok("step 5 skips", step5.ok, step5.error);

    rows = await stepRows(clientId);
    console.log("\nAfter step 5 resolves");
    ok("exactly one step is waiting again", waiting(rows).length === 1, waiting(rows).join(", "));
    eq("and it is the competitor shortlist", waiting(rows)[0] ?? "none", "competitor_shortlist");

    const seven = rows.get("competitor_shortlist");
    ok("competitor_shortlist got an anchor by itself", Boolean(seven?.slack_anchor_ts));
    ok("competitor_shortlist got its card", Boolean(seven?.slack_message_ts));
    ok(
      "competitor_shortlist is awaiting_me",
      seven?.status === "awaiting_me",
      String(seven?.status ?? "missing")
    );
    ok("avatar_confirmed is STILL not anchored", !rows.get("avatar_confirmed")?.slack_anchor_ts);

    // ── Resolve 7, and the AVATAR is what appears next ─────────────────────
    //
    // ‼️ THIS IS THE STEP THAT MOVED ON 2026-08-25, AND THE WALK IS WHERE THE MOVE IS VISIBLE.
    // avatar_confirmed used to sit at position 11, after the harvest that researches whoever it
    // names. It is position 8 now, immediately after the competitor shortlist, because the
    // avatar decides what the harvest is FOR. It is `mode: "manual"`, so under reachableCursor
    // it ends the walk: review_audit and avatar_harvest both wait behind it, which is the
    // serialisation the cursor's doc block says is the deliberate cost of calm over throughput.
    {
      const res = await setDeliveryStep({
        clientId,
        stepKey: "competitor_shortlist",
        transition: "skipped",
        skippedReason: "cascade probe: walking to the avatar",
        actor: "cascade probe",
      });
      ok("competitor_shortlist skips", res.ok, res.error);
    }

    rows = await stepRows(clientId);
    console.log("\nAt the avatar");
    ok("exactly one step is waiting", waiting(rows).length === 1, waiting(rows).join(", "));
    eq("and it is the avatar", waiting(rows)[0] ?? "none", "avatar_confirmed");

    const eight = rows.get("avatar_confirmed");
    ok("avatar_confirmed got an anchor by itself", Boolean(eight?.slack_anchor_ts));
    ok("avatar_confirmed got its card", Boolean(eight?.slack_message_ts));
    ok("avatar_harvest is STILL not anchored", !rows.get("avatar_harvest")?.slack_anchor_ts);

    // ‼️ CONFIRMED FOR REAL RATHER THAN SKIPPED, AND THAT IS THE POINT OF THIS PROBE NOW.
    // The whole lane exists because clients.primary_avatar had no writer and this step could
    // only ever be skipped. confirmAvatar is the writer; setDeliveryStep then VERIFIES against
    // the column it wrote, so a green tick here is the first one this step has ever earned.
    const picked = await confirmAvatar({
      clientId,
      slot: "a1",
      label: "cascade probe avatar",
      by: "cascade probe",
    });
    ok("the avatar is writable at all", picked.ok, picked.error);

    const eightDone = await setDeliveryStep({
      clientId,
      stepKey: "avatar_confirmed",
      transition: "complete",
      actor: "cascade probe",
    });
    ok("avatar_confirmed CONFIRMS rather than skipping", eightDone.ok, eightDone.error);
    eq(
      "and its evidence is system tier, off the column",
      eightDone.verdict?.ok ? eightDone.verdict.kind : "refused",
      "system"
    );

    // ── Resolve the review audit to reach the auto_then_manual runner ───────
    {
      const res = await setDeliveryStep({
        clientId,
        stepKey: "review_audit",
        transition: "skipped",
        skippedReason: "cascade probe: walking to the harvest",
        actor: "cascade probe",
      });
      ok("review_audit skips", res.ok, res.error);
    }

    rows = await stepRows(clientId);
    console.log("\nAt the harvest");

    const nine = rows.get("avatar_harvest");
    ok("avatar_harvest got an anchor by itself", Boolean(nine?.slack_anchor_ts));

    // ‼️ THE EVIDENCE IS output_ref PLUS A CARD PLUS awaiting_me, AND THIS USED TO ASSERT
    // `ready`, WHICH IS THE STATE OF A BROKEN CARD POST.
    //
    // runReadyAutoSteps writes `ready` and then calls postStep, whose last act is to park the
    // row at `awaiting_me`. So a healthy auto_then_manual step is NEVER observed at `ready`
    // once the dust settles — it only stays there when postStep returns early, which it does
    // on a failed Slack post. The old assertion passed only while the card was failing.
    //
    // What actually needs proving is unchanged: the runner RAN (output_ref), it produced a
    // card, and it then WAITED for a person instead of ticking itself. That is the invariant
    // that broke when postReadySteps ran before runReadyAutoSteps and parked the row where no
    // runner could ever claim it.
    ok("avatar_harvest filed an output_ref, so its generator ran", Boolean(nine?.output_ref));
    ok("avatar_harvest got its card", Boolean(nine?.slack_message_ts));
    ok(
      "and then waited for a person rather than ticking itself",
      nine?.status === "awaiting_me",
      String(nine?.status ?? "missing")
    );
    ok("and it is the only thing waiting", waiting(rows).length === 1, waiting(rows).join(", "));

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

    // ‼️ ONE CARVE-OUT, NAMED. site_dns_intel needs a domain and the fixture deliberately has
    // none (see the NAP block above: a domain would send hub_preview at the Vercel API). Its
    // failure is the fixture, not the cascade — and nothing is blockedBy it, so it stalls
    // nothing. Every other step erroring IS a real failure of this probe.
    const EXPECTED_ERRORS = new Set(["site_dns_intel"]);
    const errored = [...rows.entries()].filter(
      ([k, r]) => r.status === "error" && !EXPECTED_ERRORS.has(k)
    );
    ok(
      "no step is in error, other than the one the fixture cannot satisfy",
      errored.length === 0,
      errored.map(([k, r]) => `${k}: ${r.error_detail}`).join("; ")
    );
    ok(
      "an errored auto step does not stall the walk",
      waiting(rows).length === 1,
      waiting(rows).join(", ")
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
