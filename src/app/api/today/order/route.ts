export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { businessDayKey } from "@/lib/business-time";
import { DAY_ROLES, type DayRole } from "@/config/roles";
import { itemKeyScope } from "@/lib/today/item";

// "I dragged this above that", and "not today".
//
// ‼️ ONE ITEM PER REQUEST, NEVER THE WHOLE LIST. A body carrying the full ordering would make two
// tabs, or a phone and a laptop, silently overwrite each other's drags: the second save would
// replay a list assembled before the first one happened. One upsert on (plan_day, item_key) is
// last-write-wins per ITEM, which is the granularity the decision was actually made at.
//
// ‼️ A FLOAT AT THE MIDPOINT, SO A DRAG BETWEEN TWO PINS IS ONE ROW WRITE. The integer prior art
// argues for it: lead_magnets.sort_order is an integer and a migration had to reach for `sort_order
// 9999` just to push one row to the bottom.
//
// ‼️ IT DEGRADES RATHER THAN FAILING. Without docs/2026-09-26-day-plan.sql this answers
// { unavailable: true } and the page hides its drag handles, the same shape /api/tasks has used
// since `tasks` went missing in production.

function missingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    err.code === "42703" ||
    /does not exist|schema cache/i.test(err.message ?? "")
  );
}

interface Body {
  itemKey?: unknown;
  role?: unknown;
  /** The item it was dropped BELOW, and the one it was dropped ABOVE. Either may be absent. */
  afterKey?: unknown;
  beforeKey?: unknown;
  /** ISO, or null to clear. Present means this is a defer rather than a move. */
  deferUntil?: unknown;
  clientId?: unknown;
}

export async function PATCH(request: NextRequest) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const itemKey = typeof body.itemKey === "string" ? body.itemKey.trim() : "";
  if (!itemKey) return NextResponse.json({ error: "itemKey is required" }, { status: 400 });

  // The key grammar is parsed in exactly one place, and an unknown source is refused here rather
  // than stored: a row nothing can resolve is a row that sits in the table until the sweep.
  const { source } = itemKeyScope(itemKey);
  if (!source) return NextResponse.json({ error: `"${itemKey}" is not a day item key` }, { status: 400 });

  const role = DAY_ROLES.includes(body.role as DayRole) ? (body.role as DayRole) : null;
  if (!role) return NextResponse.json({ error: "role must be one of " + DAY_ROLES.join(", ") }, { status: 400 });

  const planDay = businessDayKey(new Date());
  const clientId = typeof body.clientId === "string" && body.clientId ? body.clientId : null;

  // A defer carries no neighbours: it does not change where the item sits, only whether it is shown.
  const isDefer = "deferUntil" in body;
  const deferUntil = typeof body.deferUntil === "string" ? body.deferUntil : null;

  let position = 0;
  if (!isDefer) {
    const neighbours = await supabaseAdmin
      .from("day_plan_order")
      .select("item_key, position")
      .eq("plan_day", planDay)
      .in("item_key", [body.afterKey, body.beforeKey].filter((v): v is string => typeof v === "string"));

    if (neighbours.error && missingTable(neighbours.error)) {
      return NextResponse.json({ unavailable: true, needs: "docs/2026-09-26-day-plan.sql" });
    }

    const byKey = new Map((neighbours.data ?? []).map((r) => [r.item_key as string, Number(r.position)]));
    const above = typeof body.afterKey === "string" ? byKey.get(body.afterKey) : undefined;
    const below = typeof body.beforeKey === "string" ? byKey.get(body.beforeKey) : undefined;

    if (above !== undefined && below !== undefined) position = (above + below) / 2;
    else if (above !== undefined) position = above + 1;
    else if (below !== undefined) position = below - 1;
    else {
      // Dropped into a lane with no pins in it yet. Anchor at zero; the next drag splits from here.
      position = 0;
    }
  } else {
    const current = await supabaseAdmin
      .from("day_plan_order")
      .select("position")
      .eq("plan_day", planDay)
      .eq("item_key", itemKey)
      .maybeSingle();
    if (current.error && missingTable(current.error)) {
      return NextResponse.json({ unavailable: true, needs: "docs/2026-09-26-day-plan.sql" });
    }
    position = Number(current.data?.position ?? 0);
  }

  const { error } = await supabaseAdmin.from("day_plan_order").upsert(
    {
      plan_day: planDay,
      item_key: itemKey,
      role,
      position,
      deferred_until: isDefer ? deferUntil : undefined,
      client_id: clientId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "plan_day,item_key" }
  );

  if (error) {
    if (missingTable(error)) return NextResponse.json({ unavailable: true, needs: "docs/2026-09-26-day-plan.sql" });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, planDay, itemKey, position, role });
}

/**
 * Unpin: back to wherever the score puts it.
 *
 * ‼️ A DELETE, NOT A POSITION OF ZERO. "I have no opinion about this one" and "I want it at the top"
 * are different statements and the table has to be able to tell them apart.
 */
export async function DELETE(request: NextRequest) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const itemKey = new URL(request.url).searchParams.get("itemKey");
  if (!itemKey) return NextResponse.json({ error: "itemKey is required" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("day_plan_order")
    .delete()
    .eq("plan_day", businessDayKey(new Date()))
    .eq("item_key", itemKey);

  if (error) {
    if (missingTable(error)) return NextResponse.json({ unavailable: true });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
