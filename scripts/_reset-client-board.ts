/**
 * Put one client's delivery board back to step 1 so the whole onboarding can be walked again.
 *
 * ‼️ THIS IS A REHEARSAL TOOL, NOT A DELETE. The `clients` row survives, and so does everything
 * that is a RECORD rather than board state: the executed agreement, the Day 0 audit, the
 * attribution numbers, the concierge conversation logs, the CRM link. What goes is the board and
 * the artifacts each step verifies itself against, because a step that ticks green off work a
 * previous run did is not a rehearsal, it is the exact bug this design exists to prevent.
 *
 * ‼️ RESOLVE BY SLUG, NEVER BY A PINNED ID. docs/lanes/CONTRACT.md:17-21: SRT Agency has been
 * re-onboarded twice, `clients.slug` is the unique provisioning claim, and every id written down
 * in this repo for it is dead. That is why this takes a slug and refuses a uuid.
 *
 * ── The three things that make this harder than a DELETE ──
 *
 * 1. seedDeliverySteps() upserts with ignoreDuplicates (delivery-checklist.ts:66-72), so it
 *    CANNOT reset a row that already exists. The 39 rows are deleted and re-seeded. Reopening
 *    them one at a time instead would fire refreshStages, postStepAnchor, refreshStepAnchor,
 *    markAnchor, refreshHeader, offerDraftsFor and the whole ensureReachableAnchors cascade
 *    thirty-nine times over (delivery-checklist.ts:440-547).
 *
 * 2. The Slack columns must be cleared or the board edits the OLD cards in place. postStep
 *    branches on slack_message_ts (step-engine.ts:1640,1664): with it set, a "repost" silently
 *    becomes a chat.update against a message that no longer exists. postStepAnchor
 *    short-circuits on slack_anchor_ts (step-board.ts:202). Deleting the rows clears both.
 *
 * 3. THE OLD MESSAGES ARE DELETED BY STORED ts, NOT BY READING THE CHANNEL. The bot is not a
 *    member of #onboarding-srt-aeo and conversations.history returns not_in_channel there
 *    (clients/artifacts/deliver.ts:8-11). So every ts is collected from the database BEFORE
 *    anything is wiped. joinChannel runs first anyway, because it is idempotent and it is the
 *    difference between chat.delete working and not.
 *
 * ‼️ WHAT chat.delete CAN AND CANNOT REMOVE. A bot token only deletes the bot's own messages.
 * Anything Matthew typed comes back `cant_delete_message` and is left exactly where it is, which
 * is the behaviour you want: his words are not this script's to remove. Those lines in the output
 * are correct, not failures.
 *
 * ‼️ clients.intake_completed_at IS KEPT, AND THIS IS THE ONE DECISION MOST LIKELY TO BE
 * "TIDIED UP" LATER. The intake_received verifier reads exactly that column (step-verify.ts:243)
 * and NOTHING but a fresh onboarding2 signing ever writes it. Nulling it deadlocks the board at
 * step 1, permanently, with no override: there is no manual tier for a system verifier. The board
 * is reopened here by calling openOpsThread + postDeliveryChecklist directly, which is what
 * startDelivery does after its claim, so the claim itself is not needed and must not be faked.
 *
 * The baseline scan is NOT re-fired, and step 2 is ticked against the kept report instead.
 * audit_reports survives the reset and baseline_scan resolves by client_id only, so the
 * verifier confirms it off the photograph that already exists. Firing a fresh audit would spend
 * a real run to prove something already proven AND mint a newer report that replaces the very
 * thing this reset preserves. Ticking it is not optional politeness: baseline_scan has no card
 * and no runner, so a board that leaves it pending cannot be advanced from Slack at all.
 *
 *   SLACK_CLIENT_ONBOARDING_CHANNEL=C0BLK797PNU \
 *     bunx tsx --env-file=.env.local scripts/_reset-client-board.ts <slug> --dry
 *   SLACK_CLIENT_ONBOARDING_CHANNEL=C0BLK797PNU \
 *     bunx tsx --env-file=.env.local scripts/_reset-client-board.ts <slug> --yes
 *
 * SLACK_CLIENT_ONBOARDING_CHANNEL lives only in Vercel, so pass it inline. Without
 * --env-file=.env.local the probes and this script return nothing at all, silently.
 */
import fs from "fs";
import path from "path";
import { supabaseAdmin } from "../src/lib/db";
import { slack } from "../src/lib/slack-bot";
import { DELIVERY_STEPS } from "../src/config/delivery-steps";

const SLUG = process.argv[2];
const DRY = process.argv.includes("--dry");
const CONFIRMED = process.argv.includes("--yes");
const OUT_ARG = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!SLUG || (!DRY && !CONFIRMED)) {
  console.error("usage: _reset-client-board.ts <slug> --dry | --yes [--out=<backup.json>]");
  console.error("");
  console.error("--dry  reads everything, writes nothing, prints exactly what it would touch.");
  console.error("--yes  does it. A backup is written first and its path is printed.");
  process.exit(1);
}

// A uuid here is the mistake this script exists to make impossible.
if (UUID.test(SLUG)) {
  console.error(`"${SLUG}" is a uuid. This takes a SLUG.`);
  console.error("A re-onboard mints a NEW id under the SAME slug, so every id in the docs is dead:");
  console.error("  select id, slug, legal_name from clients order by created_at");
  process.exit(1);
}

/**
 * Everything deleted, child-first so a foreign key never refuses.
 *
 * ‼️ EACH ONE IS HERE BECAUSE A VERIFIER READS IT. Leaving one behind does not leave a harmless
 * stale row: it makes that step tick green the instant it is reached. client_hosts is the sharpest
 * example, because hub_preview verifies off a client_hosts row carrying vercel_attached_at, so
 * step 15 would pass without the runner having done anything. Deleting the ROW detaches nothing
 * from Vercel: the domains stay on the project, which is exactly why re-attaching works
 * (attachHost GETs first and finds them).
 *
 * client_messages is the other one that is easy to miss. It is unique on (client_id, draft_key),
 * so offerDraftsFor re-emits NOTHING while the old rows stand.
 *
 * ‼️ avatar_briefs IS DELIBERATELY ABSENT FROM BOTH LISTS, AND IT LOOKS LIKE AN OMISSION.
 * It has no client_id at all: it is keyed (vertical, avatar_slug) and shared ACROSS clients on
 * purpose (docs/2026-08-25-lane-2-avatar.sql:31-49), so the second med spa aiming at laser hair
 * removal gets the first one's deep research instead of paying for the run again. A reset that
 * deleted from it would take another client's work with it, and a reset that merely tried would
 * error on a column that does not exist. clients.primary_avatar and primary_avatar_slug are kept
 * for the same reason the intake timestamp is: step 11's verifier reads them and its writer is
 * thin, so clearing them makes a step nobody can tick.
 */
const WIPE = [
  "page_gate_runs",
  "page_sources",
  "page_magnet_candidates",
  "page_studio_sessions",
  // ‼️ client_id is NOT NULL on every row this touches, and the filter below is what keeps it
  // that way. The seven LIBRARY magnets carry client_id null; deleting those breaks the widget
  // for every client alive, not just this one.
  "lead_magnets",
  "client_pages",
  "page_candidates",
  "client_question_sets",
  "competitor_candidates",
  "nap_discrepancies",
  "review_audit_rows",
  "harvest_runs",
  "client_avatar_runs",
  "client_dns_records",
  "client_docs",
  "client_messages",
  "client_replica_pages",
  "concierge_configs",
  "client_hosts",
];

/**
 * Read for the backup but never deleted. Named rather than omitted, so the backup is a full
 * picture of the client at reset time and so the next person can see the decision was made
 * rather than forgotten.
 */
const KEEP = [
  "client_onboarding_steps", // the eight-stage rollup; refreshStages recomputes it
  "audit_reports", // the Day 0 photograph. baseline_scan has no fallback without it
  "concierge_sessions",
  "concierge_scan_ledger",
  "attribution_sessions",
  "attribution_bookings",
  "attribution_monthly",
  "review_tool_submissions",
  "hub_hits",
  "time_log",
  "client_weekly_reports",
];

async function main() {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel) {
    throw new Error(
      "SLACK_CLIENT_ONBOARDING_CHANNEL is not set. It lives only in Vercel; pass it inline. " +
        "Production is C0BLK797PNU."
    );
  }

  // ── 1. The client, by slug ────────────────────────────────────────────────
  const { data: client, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("*")
    .eq("slug", SLUG)
    .maybeSingle();
  if (clientErr) throw new Error(`could not read clients: ${clientErr.message}`);
  if (!client) throw new Error(`no clients row with slug "${SLUG}".`);

  const c = client as Record<string, unknown>;
  const clientId = c.id as string;
  const name = (c.dba_name as string) || (c.legal_name as string) || SLUG;

  console.log(`${name}  (${SLUG})`);
  console.log(`  id                  ${clientId}`);
  console.log(`  intake_completed_at ${String(c.intake_completed_at ?? "null")}  (KEPT)`);
  console.log(`  ops_thread_ts       ${String(c.ops_thread_ts ?? "null")}`);
  console.log(`  day_0_archived_at   ${String(c.day_0_archived_at ?? "null")}`);
  console.log("");

  // ── 2. The Slack ts values, collected BEFORE anything is wiped ────────────
  const { data: stepRows, error: stepErr } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status, slack_anchor_ts, slack_message_ts")
    .eq("client_id", clientId);
  if (stepErr) throw new Error(`could not read the board: ${stepErr.message}`);

  const rows = stepRows ?? [];
  // Cards first, then anchors, then the ops header. Deleting a parent before its replies is
  // legal, but it leaves the log reading backwards when a delete fails halfway.
  const cardTs = rows.map((r) => r.slack_message_ts as string | null).filter(Boolean) as string[];
  const anchorTs = rows.map((r) => r.slack_anchor_ts as string | null).filter(Boolean) as string[];
  const opsTs = (c.ops_thread_ts as string | null) ?? null;
  const toDelete = [...cardTs, ...anchorTs, ...(opsTs ? [opsTs] : [])];

  console.log(
    `board: ${rows.length} rows against ${DELIVERY_STEPS.length} steps in config, ` +
      `${rows.filter((r) => r.status === "complete").length} complete`
  );
  console.log(
    `slack: ${cardTs.length} card(s), ${anchorTs.length} anchor(s)` +
      `${opsTs ? ", 1 ops header" : ""} = ${toDelete.length} message(s) to delete`
  );
  console.log("");

  // ── 3. The backup, before anything ────────────────────────────────────────
  const backup: Record<string, unknown> = {
    reset_at: new Date().toISOString(),
    slug: SLUG,
    client_id: clientId,
    client,
    delivery_steps: rows,
    deleted: {} as Record<string, unknown>,
    kept: {} as Record<string, unknown>,
  };
  const deleted = backup.deleted as Record<string, unknown>;
  const kept = backup.kept as Record<string, unknown>;

  for (const [bucket, tables] of [
    [deleted, WIPE],
    [kept, KEEP],
  ] as Array<[Record<string, unknown>, string[]]>) {
    for (const t of tables) {
      const { data, error } = await supabaseAdmin.from(t).select("*").eq("client_id", clientId);
      // NOT swallowed. _delete-client.ts hides these, which is how `client_drafts` survived in
      // its table list for months while existing nowhere in the schema.
      if (error) {
        bucket[t] = { error: error.message };
        console.log(`  !! ${t.padEnd(26)} ${error.message.slice(0, 70)}`);
        continue;
      }
      if ((data ?? []).length) bucket[t] = data;
    }
  }

  const counts = (b: Record<string, unknown>) =>
    Object.entries(b)
      .filter(([, v]) => Array.isArray(v))
      .map(([k, v]) => `${k}=${(v as unknown[]).length}`);

  console.log(`would delete: ${counts(deleted).join(", ") || "nothing"}`);
  console.log(`would keep:   ${counts(kept).join(", ") || "nothing"}`);
  console.log("");

  if (DRY) {
    console.log("--dry: nothing written, no Slack message touched, no backup file.");
    console.log("Re-run with --yes to do it.");
    return;
  }

  const out =
    OUT_ARG ??
    path.join("backups", `reset-${SLUG}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(backup, null, 2), "utf8");
  console.log(`Backup written: ${out} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)\n`);

  // ── 4. Slack, by stored ts ────────────────────────────────────────────────
  // Idempotent, and the difference between chat.delete working and not on a channel the bot
  // did not create. slackFetch returns { ok:false } and never throws: read the body.
  const joined = await slack.joinChannel(channel);
  if (!joined.ok) console.log(`joinChannel: ${joined.error ?? "refused"} (continuing)`);

  let gone = 0;
  let refused = 0;
  for (const ts of toDelete) {
    const res = (await slack.deleteMessage(channel, ts)) as { ok?: boolean; error?: string };
    if (res.ok === true) {
      gone += 1;
    } else {
      refused += 1;
      console.log(`  kept  ${ts}  ${res.error ?? "unknown"}`);
    }
    // chat.delete is Slack tier 3. Same spacer _rerun-step-10.ts settled on.
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`slack: ${gone} deleted, ${refused} left in place\n`);

  // ── 5. The board ──────────────────────────────────────────────────────────
  const { error: wipeStepsErr } = await supabaseAdmin
    .from("client_delivery_steps")
    .delete()
    .eq("client_id", clientId);
  if (wipeStepsErr) throw new Error(`could not clear the board: ${wipeStepsErr.message}`);
  console.log(`deleted ${rows.length} client_delivery_steps rows`);

  // ── 6. The artifacts every verifier reads ─────────────────────────────────
  for (const t of WIPE) {
    const had = Array.isArray(deleted[t]) ? (deleted[t] as unknown[]).length : 0;
    if (!had) continue;
    const { error } = await supabaseAdmin.from(t).delete().eq("client_id", clientId);
    if (error) {
      console.log(`  !! ${t}: ${error.message}`);
      continue;
    }
    console.log(`  deleted ${String(had).padStart(4)} from ${t}`);
  }

  // ── 7. The client columns that gate a re-walk ─────────────────────────────
  // ops_thread_ts must be null: openOpsThread claims with .is("ops_thread_ts", null) and
  // postDeliveryChecklist refuses to open a board without one.
  //
  // ‼️ THE day_0 QUARTET CLEARS TOGETHER OR NOT AT ALL. docs/2026-08-18-day-zero-wall.sql:84
  // holds a CHECK that (day_0_archived_at is null) = (day_0_source is null), and day_0_source is
  // itself constrained to ('photograph_2','manual_step','waived'). Clearing one of them is a
  // constraint violation, not a partial reset.
  const { error: patchErr } = await supabaseAdmin
    .from("clients")
    .update({
      ops_thread_ts: null,
      day_0_archived_at: null,
      day_0_source: null,
      day_0_archived_by: null,
      day_0_waived_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);
  if (patchErr) throw new Error(`could not clear the client columns: ${patchErr.message}`);
  console.log("cleared ops_thread_ts and the day_0 quartet (intake_completed_at KEPT)\n");

  // ── 8. Reopen, in the order startDelivery uses ────────────────────────────
  const { openOpsThread } = await import("../src/lib/onboarding2/delivery");
  const { seedDeliverySteps, autoCompleteStep, postDeliveryChecklist } = await import(
    "../src/lib/clients/delivery-checklist"
  );

  const opened = await openOpsThread({ clientId, name });
  if (!opened.ts) throw new Error(opened.warning ?? "the ops thread could not be opened");
  if (opened.warning) console.log(`ops thread: ${opened.warning}`);
  console.log(`ops thread posted and claimed: ${opened.ts}`);

  await seedDeliverySteps(clientId);
  console.log(`seeded ${DELIVERY_STEPS.length} steps`);

  // The same call startDelivery makes, and it goes through the same verifier the button does:
  // it ticks because clients.intake_completed_at is still there, which is the whole reason that
  // column was kept.
  const ticked = await autoCompleteStep(clientId, "intake_received");
  console.log(`intake_received: ${ticked.ok ? "ticked" : `REFUSED (${ticked.error})`}`);

  // ‼️ baseline_scan TOO, OR THE BOARD STOPS DEAD AT STEP 2 WITH NOTHING THAT CAN MOVE IT.
  // Measured on the first real run of this script, 2026-09-07. baseline_scan is `mode: auto`,
  // so the board gives it an ANCHOR and no card, which means no [Done] button in Slack. And it
  // is in ROUTE_COMPLETED rather than AUTO_RUNNERS (artifacts/registry.ts), so no board runner
  // will ever fire it either: in a real onboarding startDelivery calls startBaselineScan as a
  // separate step of its own. This script deliberately does not, because audit_reports is KEPT
  // and a fresh scan would mint a NEWER report that replaces the Day 0 photograph the whole
  // reset went out of its way to preserve.
  //
  // So the step was left reachable, uncompletable, and blocking competitor_shortlist,
  // avatar_confirmed, review_audit and avatar_harvest behind it. The only exit was the
  // dashboard checkbox, which nothing told you about.
  //
  // This is NOT a free tick. autoCompleteStep routes through the same verifier the button
  // does, and that verifier reads audit_runs and the report status. With no kept report it
  // REFUSES and says so in the thread, which is the correct outcome: a client with no
  // photograph genuinely has not had step 2 done.
  const scanned = await autoCompleteStep(clientId, "baseline_scan");
  console.log(
    `baseline_scan:   ${scanned.ok ? "ticked off the kept audit report" : `not ticked (${scanned.error})`}`
  );
  if (!scanned.ok) {
    console.log("    No usable audit on file. Fire a fresh one, or the board stops at step 2:");
    console.log("      startBaselineScan(clientId) in src/lib/clients/baseline-scan.ts");
  }

  await postDeliveryChecklist(clientId);
  console.log("board reopened\n");

  // ── 9. What it looks like now ─────────────────────────────────────────────
  const { data: after } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status, slack_anchor_ts")
    .eq("client_id", clientId);

  const now = after ?? [];
  const anchored = now.filter((r) => r.slack_anchor_ts).length;
  const byStatus = new Map<string, number>();
  for (const r of now) byStatus.set(r.status as string, (byStatus.get(r.status as string) ?? 0) + 1);

  console.log(`${now.length} rows, ${anchored} anchored`);
  console.log([...byStatus.entries()].map(([s, n]) => `  ${s}: ${n}`).join("\n"));
  console.log(`\nBackup: ${out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
