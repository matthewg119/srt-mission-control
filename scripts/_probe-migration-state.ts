// Where is the funding decommission up to, and is the database consistent?
//
// Read-only. Run it before and after every block of
// docs/2026-08-17-funding-decommission.sql:
//
//   bun run migration:check
//
// The check that matters most is ROLLUPS. The lead_activities and lead_tasks
// triggers only fire on INSERT, so deleting rows leaves contacts.last_activity_at,
// next_action_at and open_task_count describing rows that no longer exist. Until
// the recompute runs, the call board ranks on ghosts and nothing looks wrong.

import { supabaseAdmin } from "@/lib/db";
import { STAGE_NAMES, normalizeStage } from "@/config/stage-display";

const PAGE = 1000;

async function count(table: string, apply?: (q: never) => unknown): Promise<number> {
  let q = supabaseAdmin.from(table).select("id", { count: "exact", head: true });
  if (apply) q = apply(q as never) as typeof q;
  const { count: n, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return n ?? 0;
}

// One scalar out of the read-only SQL RPC. Used for catalog questions that
// PostgREST cannot answer honestly (see the deal_notes note below).
async function scalar(sql: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("crm_readonly_query", { q: sql });
  if (error) throw new Error(`scalar: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (!rows.length) return null;
  const v = Object.values(rows[0])[0];
  return v == null ? null : String(v);
}

function line(ok: boolean, label: string, detail: string) {
  console.log(`  ${ok ? "OK  " : "TODO"}  ${label.padEnd(42)} ${detail}`);
  return ok;
}

async function main() {
  console.log("\n📋 Funding decommission — database state\n");
  let blocking = 0;

  // ── Stages ────────────────────────────────────────────────────────
  const stages = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select("application_stage")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`contacts: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      const k = (r.application_stage as string | null) ?? "(null)";
      stages.set(k, (stages.get(k) ?? 0) + 1);
    }
    if (rows.length < PAGE) break;
  }
  const total = [...stages.values()].reduce((a, b) => a + b, 0);
  const legacy = [...stages.keys()].filter((k) => k !== "(null)" && !STAGE_NAMES.includes(k));

  console.log(`STAGES  (${total} contacts)`);
  for (const [k, v] of [...stages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    const mapped = STAGE_NAMES.includes(k) ? "" : `  -> would become "${normalizeStage(k === "(null)" ? null : k)}"`;
    console.log(`          ${String(v).padStart(6)}  ${k}${mapped}`);
  }
  if (legacy.length > 12) console.log(`          … and ${legacy.length - 12} more legacy values`);
  console.log();
  if (!line(legacy.length === 0, "block B (stage collapse)", legacy.length === 0 ? "done" : `${legacy.length} legacy stage values left`)) blocking++;

  // ── The wipe ──────────────────────────────────────────────────────
  console.log("\nWIPE");
  const zohoActs = await count("lead_activities", (q) => (q as unknown as { eq: (a: string, b: string) => unknown }).eq("source", "zoho"));
  const zohoTasks = await count("lead_tasks", (q) => (q as unknown as { eq: (a: string, b: string) => unknown }).eq("source", "zoho"));
  line(zohoActs === 0, "lead_activities source='zoho'", zohoActs === 0 ? "cleared" : `${zohoActs} rows remain`);
  line(zohoTasks === 0, "lead_tasks source='zoho'", zohoTasks === 0 ? "cleared" : `${zohoTasks} rows remain`);

  // ‼️ Ask the CATALOG, not PostgREST. This used to call count("deal_notes") and
  // treat a throw as "the table is gone" — but PostgREST answers a head-count on
  // a missing table with count=null and NO error, and count()'s `n ?? 0` turned
  // that into a confident "0 rows". So the check could never once report the
  // thing it exists to report: after the table was really dropped it went on
  // printing TODO / 0 rows, which reads exactly like "the drop silently failed".
  const dealNotesOid = await scalar(
    `select to_regclass('public.deal_notes')::text as v`
  );
  const dealNotesGone = dealNotesOid === null;
  line(
    dealNotesGone,
    "deal_notes table",
    dealNotesGone ? "dropped" : `still present (${dealNotesOid})`
  );

  // ── Rollups. The one that silently breaks the call board. ─────────
  console.log("\nROLLUPS  (stale after any delete until the recompute runs)");

  const withActivity = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("lead_activities")
      .select("contact_id")
      .order("contact_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`lead_activities: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) if (r.contact_id) withActivity.add(r.contact_id as string);
    if (rows.length < PAGE) break;
  }

  const openTaskContacts = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("lead_tasks")
      .select("contact_id")
      .eq("status", "open")
      .order("contact_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`lead_tasks: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) if (r.contact_id) openTaskContacts.add(r.contact_id as string);
    if (rows.length < PAGE) break;
  }

  let ghostActivity = 0;
  let ghostTasks = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select("id, last_activity_at, open_task_count, next_action_at")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`contacts: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      const id = r.id as string;
      if (r.last_activity_at && !withActivity.has(id)) ghostActivity++;
      if (((r.open_task_count as number) ?? 0) > 0 && !openTaskContacts.has(id)) ghostTasks++;
      if (r.next_action_at && !openTaskContacts.has(id)) ghostTasks++;
    }
    if (rows.length < PAGE) break;
  }

  if (!line(ghostActivity === 0, "last_activity_at points at real rows", ghostActivity === 0 ? "consistent" : `${ghostActivity} contacts stale — RUN BLOCK D`)) blocking++;
  if (!line(ghostTasks === 0, "open_task_count / next_action_at", ghostTasks === 0 ? "consistent" : `${ghostTasks} contacts stale — RUN BLOCK D`)) blocking++;

  // ── Call board ────────────────────────────────────────────────────
  console.log("\nCALL BOARD");
  const { buildWorklist } = await import("@/lib/worklist");
  const board = await buildWorklist({ limit: 5 });
  if (!line(board.length > 0, "buildWorklist returns leads", board.length ? `${board.length} on the board` : "EMPTY — check PRE_CONTACT_STAGES")) blocking++;
  for (const l of board) {
    console.log(`          ${(l.businessName || l.name).slice(0, 34).padEnd(34)} ${String(l.status ?? "—").padEnd(24)} ${l.reasons[0] ?? ""}`);
  }

  // ── Sequences ─────────────────────────────────────────────────────
  console.log("\nSEQUENCES");
  const { data: seqs } = await supabaseAdmin.from("email_sequences").select("slug, is_active").order("slug");
  const FUNDING = new Set([
    "website-lead-nurture", "website-lead-to-application", "application-abandoned",
    "application-completed-nurture", "fu-new-inbound", "awaiting-statements",
    "pre-approved-nurture", "approved-nurture",
  ]);
  const left = (seqs ?? []).filter((s) => FUNDING.has(s.slug as string));
  line(left.length === 0, "funding sequences removed", left.length === 0 ? "done" : `${left.length} left: ${left.map((s) => s.slug).join(", ")}`);
  console.log(`          present: ${(seqs ?? []).map((s) => s.slug).join(", ") || "(none)"}`);

  console.log(
    blocking === 0
      ? "\n✅ Consistent. Nothing blocking.\n"
      : `\n⚠️  ${blocking} thing(s) need attention above.\n`
  );
}

main().catch((e) => {
  console.error("\n❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
