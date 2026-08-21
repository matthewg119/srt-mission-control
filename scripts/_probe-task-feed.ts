// Read-only: does the /api/crm/tasks embed actually work?
//
// The only genuinely uncertain part of the merged Tasks board is the PostgREST
// `contacts!inner(...)` embed. A bad column name hard-errors the whole query
// (see docs/2026-08-19-contacts-drift-repair.sql), and a to-one embed comes
// back as an object here but is typed as an array, so both need proving against
// the live DB rather than against the schema file.
//
//   bun run scripts/_probe-task-feed.ts

import { supabaseAdmin } from "../src/lib/db";
import { bucketTasks, fromLeadTask, leadDisplayName } from "../src/lib/task-feed";

async function main() {
  const { data, error } = await supabaseAdmin
    .from("lead_tasks")
    .select(
      "id, contact_id, title, description, task_type, priority, status, due_at, snoozed_until, created_at, contacts!inner(id, first_name, last_name, business_name)"
    )
    .eq("status", "open")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(200);

  if (error) {
    console.error("EMBED FAILED:", error.code, error.message);
    process.exit(1);
  }

  const rows = data ?? [];
  console.log(`embed ok — ${rows.length} open follow-ups`);

  const shape = rows[0]?.contacts;
  console.log(`contacts embed arrives as: ${Array.isArray(shape) ? "ARRAY" : "OBJECT"}`);

  const tasks = rows.map((r) => {
    const c = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
    return fromLeadTask({
      id: r.id as string,
      contact_id: r.contact_id as string,
      title: r.title as string,
      description: r.description as string | null,
      task_type: r.task_type as string | null,
      priority: r.priority as string | null,
      status: r.status as string | null,
      due_at: r.due_at as string | null,
      created_at: r.created_at as string | null,
      lead_name: c ? leadDisplayName(c) : null,
    });
  });

  // "Unnamed lead" everywhere would mean the embed silently returned nothing.
  const unnamed = tasks.filter((t) => t.lead?.name === "Unnamed lead").length;
  console.log(`lead names resolved: ${tasks.length - unnamed}/${tasks.length}`);

  for (const b of bucketTasks(tasks)) {
    console.log(`\n${b.label} (${b.tasks.length})`);
    for (const t of b.tasks.slice(0, 3)) {
      console.log(`  ${t.title.slice(0, 44).padEnd(46)} ${t.lead?.name ?? "-"}  [${t.priority}]`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
