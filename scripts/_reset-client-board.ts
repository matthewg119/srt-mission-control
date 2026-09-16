/**
 * Put one client's delivery board back to the PREP CALL so the rest of the onboarding can be
 * walked again.
 *
 * ‼️ THIS IS A REHEARSAL TOOL, NOT A DELETE. The `clients` row survives, and so does everything
 * that is a RECORD rather than board state: the executed agreement, the Day 0 audit, the
 * attribution numbers, the concierge conversation logs, the CRM link, the avatar history and every
 * client_event. What goes is the board and the artifacts each step verifies itself against, because
 * a step that ticks green off work a previous run did is not a rehearsal, it is the exact bug this
 * design exists to prevent.
 *
 * ‼️ IT DOES NOT GO BACK TO ZERO, AND THAT IS THE 2026-09-12 CHANGE. It used to wipe every
 * artifact, which meant the board reopened at step 5 asking for nineteen presence screenshots that
 * had already been taken, a competitor shortlist already picked, and a review audit already read.
 * The measurement work is EVIDENCE about the business: it is still true after a reset, and asking
 * somebody to redo it is how a rehearsal turns into a week. So everything before the prep call is
 * KEPT and re-confirmed through its own verifier, and the board lands on the prep call, which is
 * where the strategy actually starts.
 *
 * What that means in practice: steps 1 to 9 tick themselves off evidence that is still on file, and
 * anything that cannot honestly re-confirm stays open and says so. Nothing is ticked by assertion.
 *
 * ‼️ RESOLVE BY SLUG, NEVER BY A PINNED ID. docs/lanes/CONTRACT.md:17-21: SRT Agency has been
 * re-onboarded twice, `clients.slug` is the unique provisioning claim, and every id written down
 * in this repo for it is dead. That is why this takes a slug and refuses a uuid.
 *
 * ── The three things that make this harder than a DELETE ──
 *
 * 1. seedDeliverySteps() upserts with ignoreDuplicates (delivery-checklist.ts), so it CANNOT reset
 *    a row that already exists. The rows are deleted and re-seeded. Reopening them one at a time
 *    instead would fire refreshStages, postStepAnchor, refreshStepAnchor, markAnchor, refreshHeader,
 *    offerDraftsFor and the whole ensureReachableAnchors cascade forty-one times over.
 *
 * 2. The Slack columns must be cleared or the board edits the OLD cards in place. postStep branches
 *    on slack_message_ts: with it set, a "repost" silently becomes a chat.update against a message
 *    that no longer exists. postStepAnchor short-circuits on slack_anchor_ts. Deleting the rows
 *    clears both.
 *
 * 3. THE OLD MESSAGES ARE DELETED BY STORED ts, NOT BY READING THE CHANNEL. The bot is not a member
 *    of #onboarding-srt-aeo and conversations.history returns not_in_channel there. So every ts is
 *    collected from the database BEFORE anything is wiped. joinChannel runs first anyway, because
 *    it is idempotent and it is the difference between chat.delete working and not.
 *
 * ‼️ RUN scripts/_backfill-client-events.ts FIRST. This deletes the bot's cards, and their anchors
 * are the only way to find those threads again. Once they are gone the history is unreadable.
 *
 * ‼️ WHAT chat.delete CAN AND CANNOT REMOVE. A bot token only deletes the bot's own messages.
 * Anything Matthew typed comes back `cant_delete_message` and is left exactly where it is, which is
 * the behaviour you want: his words are not this script's to remove.
 *
 * ‼️ clients.intake_completed_at IS KEPT, AND THIS IS THE ONE DECISION MOST LIKELY TO BE "TIDIED UP"
 * LATER. The intake_received verifier reads exactly that column and NOTHING but a fresh onboarding2
 * signing ever writes it. Nulling it deadlocks the board at step 1, permanently, with no override.
 *
 *   SLACK_CLIENT_ONBOARDING_CHANNEL=C0BLK797PNU \
 *     bunx tsx --env-file=.env.local scripts/_reset-client-board.ts <slug> --dry
 *   SLACK_CLIENT_ONBOARDING_CHANNEL=C0BLK797PNU \
 *     bunx tsx --env-file=.env.local scripts/_reset-client-board.ts <slug> --yes \
 *       --channel=srt-agency-onboarding --invite=U074ZQ1K0UE
 *
 * SLACK_CLIENT_ONBOARDING_CHANNEL is where the OLD cards are deleted from. --channel is the NEW
 * private channel the rehearsed board is posted into; without it the board reopens where it was.
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
const CHANNEL_ARG = process.argv.find((a) => a.startsWith("--channel="))?.slice("--channel=".length) ?? null;
const INVITE_ARG = process.argv.find((a) => a.startsWith("--invite="))?.slice("--invite=".length) ?? null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!SLUG || (!DRY && !CONFIRMED)) {
  console.error("usage: _reset-client-board.ts <slug> --dry | --yes [--channel=<name>] [--invite=<U…>] [--out=<backup.json>]");
  console.error("");
  console.error("--dry      reads everything, writes nothing, prints exactly what it would touch.");
  console.error("--yes      does it. A backup is written first and its path is printed.");
  console.error("--channel  create a fresh PRIVATE channel and post the rehearsed board into it.");
  console.error("--invite   Slack member id to add to that channel. A private channel is invisible");
  console.error("           to anybody who is not in it, so without this nobody can read the board.");
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
 * Everything before the prep call. Their evidence is KEPT and these steps re-confirm themselves.
 *
 * ‼️ DERIVED FROM THE ARRAY, NOT WRITTEN DOWN. Inserting a step renumbers the board, and a hardcoded
 * list of nine keys would quietly start meaning something else the next time one moves.
 */
const PREP_CALL_STEP = "offer_locked";
const PRE_LOCK_STEPS = DELIVERY_STEPS.slice(
  0,
  DELIVERY_STEPS.findIndex((s) => s.key === PREP_CALL_STEP)
).map((s) => s.key);

/**
 * Deleted, child-first so a foreign key never refuses.
 *
 * ‼️ EACH ONE IS HERE BECAUSE A VERIFIER READS IT AND THE STEP IT BELONGS TO IS BEING RE-WALKED.
 * Leaving one behind does not leave a harmless stale row: it makes that step tick green the instant
 * it is reached. client_hosts is the sharpest example, because hub_preview verifies off a
 * client_hosts row carrying vercel_attached_at, so that step would pass without the runner having
 * done anything. Deleting the ROW detaches nothing from Vercel: the domains stay on the project,
 * which is exactly why re-attaching works.
 *
 * client_messages is the other one that is easy to miss. It is unique on (client_id, draft_key), so
 * offerDraftsFor re-emits NOTHING while the old rows stand.
 *
 * ‼️ avatar_briefs IS DELIBERATELY ABSENT. It has no client_id: it is keyed (vertical, avatar_slug)
 * and shared ACROSS clients on purpose, so the second med spa aiming at laser hair removal gets the
 * first one's deep research instead of paying for the run again.
 */
const WIPE = [
  "page_gate_runs",
  "page_sources",
  "page_magnet_candidates",
  "page_studio_sessions",
  // ‼️ client_id is NOT NULL on every row this touches, and the filter below is what keeps it that
  // way. The seven LIBRARY magnets carry client_id null; deleting those breaks the widget for every
  // client alive, not just this one.
  "lead_magnets",
  "client_pages",
  "page_candidates",
  "client_question_sets",
  // The keyword set and the page plan are downstream of the LOCK, which is being cleared. A set
  // approved against an offer nobody has agreed to again is an approval of nothing.
  "client_keywords",
  "page_plan",
  "harvest_runs",
  "client_dns_records",
  "client_messages",
  "client_replica_pages",
  "concierge_configs",
  "client_hosts",
];

/**
 * Read for the backup, never deleted.
 *
 * ‼️ THE FIRST THREE ARE THE 2026-09-12 CHANGE AND THEY USED TO BE IN THE WIPE LIST. They are the
 * measurement half of the onboarding: nineteen swept listings, a competitor shortlist somebody
 * picked, and review counts somebody read off the listings by hand because no platform here has an
 * API. None of it is board state and none of it stops being true because the board was reset.
 * Deleting them is what made a rehearsal cost a week.
 *
 * client_avatar_runs left the WIPE list on the same day, for the same reason: it is the record of
 * which buyer this client was aimed at and when it changed.
 */
const KEEP = [
  "nap_discrepancies",
  "competitor_candidates",
  "review_audit_rows",
  "client_avatar_runs",
  "client_events",
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
  const oldChannel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!oldChannel) {
    throw new Error(
      "SLACK_CLIENT_ONBOARDING_CHANNEL is not set. It is where the OLD cards are deleted from, it " +
        "lives only in Vercel, so pass it inline. Production is C0BLK797PNU."
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
  console.log(`  ops_channel_id      ${String(c.ops_channel_id ?? "null")}`);
  console.log(`  day_0_archived_at   ${String(c.day_0_archived_at ?? "null")}`);
  console.log(`  offer locked        ${(c.offer as { lockedAt?: string } | null)?.lockedAt ?? "no"}`);
  console.log("");
  console.log(`re-walking from: *${PREP_CALL_STEP}* (step ${PRE_LOCK_STEPS.length + 1} of ${DELIVERY_STEPS.length})`);
  console.log(`kept and re-confirmed: ${PRE_LOCK_STEPS.join(", ")}`);
  console.log("");

  // ── 2. The Slack ts values, collected BEFORE anything is wiped ────────────
  const { data: stepRows, error: stepErr } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status, skipped_reason, slack_anchor_ts, slack_message_ts")
    .eq("client_id", clientId);
  if (stepErr) throw new Error(`could not read the board: ${stepErr.message}`);

  const rows = stepRows ?? [];
  // Cards first, then anchors, then the ops header. Deleting a parent before its replies is legal,
  // but it leaves the log reading backwards when a delete fails halfway.
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
      `${opsTs ? ", 1 ops header" : ""} = ${toDelete.length} message(s) to delete from ${oldChannel}`
  );

  // ── 3. The documents, split by which half of the board they belong to ─────
  //
  // ‼️ EVIDENCE IS KEPT, ARTIFACTS ARE NOT. A screenshot filed against the presence sweep is a
  // picture of a listing somebody opened: still true, and re-taking nineteen of them is the cost
  // this whole change exists to remove. A GENERATED document is this system's own output about a
  // board that is being re-walked, so it goes and is written again.
  const { data: docRows } = await supabaseAdmin
    .from("client_docs")
    .select("id, filename, delivery_step_key, source")
    .eq("client_id", clientId);

  const docs = docRows ?? [];
  const docKept = docs.filter(
    (d) => d.source !== "generated" && PRE_LOCK_STEPS.includes((d.delivery_step_key as string) ?? "")
  );
  const docGone = docs.filter((d) => !docKept.includes(d));

  console.log(`docs:  ${docKept.length} kept (evidence before the prep call), ${docGone.length} deleted`);

  // ‼️ A SKIP IS A DECISION AND IT SURVIVES, the same way intake_completed_at, the confirmed avatar
  // and the payment stamp survive. "Marked not applicable" is a judgement a person made about this
  // business; a reset that threw it away would stop the board on the first step he had already
  // ruled out and ask him to rule it out again. Verified ticks are re-EARNED, decisions are kept.
  const priorSkips = rows.filter(
    (r) => r.status === "skipped" && PRE_LOCK_STEPS.includes(r.step_key as string)
  );
  if (priorSkips.length) {
    console.log(
      `skips: ${priorSkips.length} carried over (${priorSkips.map((r) => r.step_key as string).join(", ")})`
    );
  }
  console.log("");

  // ── 4. The backup, before anything ────────────────────────────────────────
  const backup: Record<string, unknown> = {
    reset_at: new Date().toISOString(),
    slug: SLUG,
    client_id: clientId,
    client,
    delivery_steps: rows,
    docs_kept: docKept,
    docs_deleted: docGone,
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
      // NOT swallowed. _delete-client.ts hides these, which is how `client_drafts` survived in its
      // table list for months while existing nowhere in the schema.
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

  if (CHANNEL_ARG) {
    console.log(`would create private channel #${CHANNEL_ARG}${INVITE_ARG ? ` and invite ${INVITE_ARG}` : ""}`);
    if (!INVITE_ARG) {
      console.log("  !! no --invite: a private channel is invisible to anybody who is not in it.");
    }
  }

  if (DRY) {
    console.log("\n--dry: nothing written, no Slack message touched, no backup file.");
    console.log("Re-run with --yes to do it.");
    return;
  }

  const out =
    OUT_ARG ??
    path.join("backups", `reset-${SLUG}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(backup, null, 2), "utf8");
  console.log(`Backup written: ${out} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)\n`);

  // ── 5. Slack, by stored ts ────────────────────────────────────────────────
  // Idempotent, and the difference between chat.delete working and not on a channel the bot did
  // not create. slackFetch returns { ok:false } and never throws: read the body.
  const joined = await slack.joinChannel(oldChannel);
  if (!joined.ok) console.log(`joinChannel: ${joined.error ?? "refused"} (continuing)`);

  let gone = 0;
  let refused = 0;
  for (const ts of toDelete) {
    const res = (await slack.deleteMessage(oldChannel, ts)) as { ok?: boolean; error?: string };
    if (res.ok === true) gone += 1;
    else {
      refused += 1;
      console.log(`  kept  ${ts}  ${res.error ?? "unknown"}`);
    }
    // chat.delete is Slack tier 3. Same spacer _rerun-step-10.ts settled on.
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`slack: ${gone} deleted, ${refused} left in place\n`);

  // ── 6. The board ──────────────────────────────────────────────────────────
  const { error: wipeStepsErr } = await supabaseAdmin
    .from("client_delivery_steps")
    .delete()
    .eq("client_id", clientId);
  if (wipeStepsErr) throw new Error(`could not clear the board: ${wipeStepsErr.message}`);
  console.log(`deleted ${rows.length} client_delivery_steps rows`);

  // ── 7. The artifacts the re-walked steps verify against ───────────────────
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

  if (docGone.length) {
    const { error } = await supabaseAdmin
      .from("client_docs")
      .delete()
      .in("id", docGone.map((d) => d.id as string));
    if (error) console.log(`  !! client_docs: ${error.message}`);
    else console.log(`  deleted ${String(docGone.length).padStart(4)} from client_docs (${docKept.length} evidence rows kept)`);
  }

  // ── 8. The client columns that gate a re-walk ─────────────────────────────
  //
  // ops_thread_ts must be null: openOpsThread claims with .is("ops_thread_ts", null) and
  // postDeliveryChecklist refuses to open a board without one. ops_index_ts goes with it, or the
  // pinned index points at a message in the old channel.
  //
  // ‼️ THE day_0 QUARTET CLEARS TOGETHER OR NOT AT ALL. docs/2026-08-18-day-zero-wall.sql holds a
  // CHECK that (day_0_archived_at is null) = (day_0_source is null), and day_0_source is itself
  // constrained. Clearing one of them is a constraint violation, not a partial reset.
  const { error: patchErr } = await supabaseAdmin
    .from("clients")
    .update({
      ops_thread_ts: null,
      ops_index_ts: null,
      day_0_archived_at: null,
      day_0_source: null,
      day_0_archived_by: null,
      day_0_waived_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);
  if (patchErr) throw new Error(`could not clear the client columns: ${patchErr.message}`);
  console.log("cleared ops_thread_ts, ops_index_ts and the day_0 quartet (intake_completed_at KEPT)");

  // ── 9. The offer lock ─────────────────────────────────────────────────────
  //
  // The prep call is the step being rehearsed, and a board that reopens holding a locked offer
  // walks straight past it. The PROPOSAL survives: it is a reading of the intake form, still true,
  // and it is what the prep call's card opens with.
  const { unlockOffer } = await import("../src/lib/clients/offers");
  const unlocked = await unlockOffer(clientId);
  console.log(unlocked.ok ? "offer lock cleared, proposal kept" : `!! offer not unlocked: ${unlocked.error}`);

  // ── 10. The fresh channel, BEFORE anything is seeded ──────────────────────
  //
  // ops_channel_id is write-once (a conditional update guarded on `is null`), and channelFor
  // memoises it, so this has to happen before openOpsThread or the board posts into the old
  // channel and can never be moved.
  if (CHANNEL_ARG) {
    const { createOpsChannel } = await import("../src/lib/clients/provision");
    try {
      const made = await createOpsChannel(clientId, SLUG, { name: CHANNEL_ARG, invite: INVITE_ARG });
      console.log(
        made
          ? `channel: #${made.name} (${made.channelId})${INVITE_ARG ? `, invited ${INVITE_ARG}` : ""}`
          : "channel: ops_channel_id was already set, so it was left alone"
      );
    } catch (e) {
      console.log(`!! channel not created: ${(e as Error).message}. The board will reopen where it was.`);
    }
  }

  // ── 11. Reopen, in the order startDelivery uses ───────────────────────────
  const { openOpsThread } = await import("../src/lib/onboarding2/delivery");
  const { seedDeliverySteps, autoCompleteStep, setDeliveryStep, postDeliveryChecklist } = await import(
    "../src/lib/clients/delivery-checklist"
  );

  const opened = await openOpsThread({ clientId, name });
  if (!opened.ts) throw new Error(opened.warning ?? "the ops thread could not be opened");
  if (opened.warning) console.log(`ops thread: ${opened.warning}`);
  console.log(`ops thread posted and claimed: ${opened.ts}`);

  await seedDeliverySteps(clientId);
  console.log(`seeded ${DELIVERY_STEPS.length} steps\n`);

  // ── 12. Re-confirm everything before the prep call ────────────────────────
  //
  // ‼️ EVERY ONE OF THESE GOES THROUGH ITS OWN VERIFIER. autoCompleteStep routes into
  // setDeliveryStep, which runs verifyStep BEFORE the row write and writes nothing on a refusal.
  // So this is not a list of steps being ticked, it is a list of steps being ASKED, and a step
  // whose evidence did not survive says so and stays open. That is the whole difference between
  // keeping the evidence and asserting the work was done.
  //
  // In order, because a later verifier can read what an earlier one adopted: baseline_scan is what
  // writes clients.vertical_slug through adoptAuditClassification, and the harvest refuses without it.
  console.log("re-confirming the steps before the prep call:");
  const before = new Map(rows.map((r) => [r.step_key as string, r] as const));

  for (const key of PRE_LOCK_STEPS) {
    const prior = before.get(key);

    // ‼️ A SKIP IS RE-APPLIED, NOT RE-ASKED, and setDeliveryStep does not gate it: "A SKIP is a
    // decision, not a claim about work, and there is nothing to verify about deciding a step does
    // not apply." The reason is his own words, carried over verbatim, because the artifacts read
    // it and a reset is not a new opinion about why something was skipped.
    if ((prior?.status as string | undefined) === "skipped") {
      const reason = (prior?.skipped_reason as string | null) ?? "Marked not applicable before the board was reset";
      const res = await setDeliveryStep({
        clientId,
        stepKey: key,
        transition: "skipped",
        skippedReason: reason,
        actor: "Mission Control",
      });
      console.log(`  ${res.ok ? "skip  " : "OPEN  "}${key}  (carried over: ${reason})`);
      continue;
    }

    const res = await autoCompleteStep(clientId, key);
    console.log(`  ${res.ok ? "ok    " : "OPEN  "}${key}${res.ok ? "" : `  (${res.error ?? "refused"})`}`);
  }

  await postDeliveryChecklist(clientId);
  console.log("\nboard reopened");

  // ── 13. What it looks like now ────────────────────────────────────────────
  const { data: after } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status, slack_anchor_ts")
    .eq("client_id", clientId);

  const now = after ?? [];
  const anchored = now.filter((r) => r.slack_anchor_ts).length;
  const byStatus = new Map<string, number>();
  for (const r of now) byStatus.set(r.status as string, (byStatus.get(r.status as string) ?? 0) + 1);

  console.log(`\n${now.length} rows, ${anchored} anchored`);
  console.log([...byStatus.entries()].map(([s, n]) => `  ${s}: ${n}`).join("\n"));

  const { reachableCursor } = await import("../src/lib/clients/step-engine");
  const cursor = [...(await reachableCursor(clientId))];
  console.log(`\ncursor: ${cursor.join(", ") || "(empty)"}`);
  console.log(`Backup: ${out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
