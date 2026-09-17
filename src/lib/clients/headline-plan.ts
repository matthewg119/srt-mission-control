// The join between the seven headlines somebody kept and the seven plan rows that were built from them.
//
// ‼️ THE KEYWORD IS THE JOIN, NOT THE ORDER. Both sides are seven rows and it is tempting to zip them,
// but selectOfferPlan ranks the supports and framePages may reorder them, so position N on one side is
// not position N on the other. Every pre-call headline carries the id of the keyword it was written for
// and every plan row carries target_keyword_id, so the match is exact and a row that somehow has no
// partner is left alone and reported rather than paired with whatever was next.
//
// ‼️ IT RUNS AFTER THE PLAN EXISTS AND IT IS NOT THE PLAN'S BUSINESS TO CALL IT. proposePreCallPlan is
// reached from three directions (the runner, a keyword button, `plan new`) and only one of them started
// from a headline pick. So the pick calls this once the plan has been proposed, and a plan proposed any
// other way simply has no headlines to bind, which is the behaviour it had before this lane existed.

import { supabaseAdmin } from "@/lib/db";
import { approveHeadlineForPage } from "./client-headlines";

export interface BoundHeadline {
  planRowId: string;
  headline: string;
}

/**
 * Write each approved pre-call headline onto the plan row built from its keyword.
 *
 * Returns what it bound. Failure is per row: one plan row with no headline is a page that gets its H1
 * written the ordinary way at draft time, not a reason to leave the other six unbound.
 */
export async function bindHeadlinesToPlan(
  clientId: string,
  by: string
): Promise<{ bound: BoundHeadline[]; unmatched: number }> {
  const [{ data: heads }, { data: plan }] = await Promise.all([
    supabaseAdmin
      .from("client_headlines")
      .select("id, headline, keyword_id, used_page_id")
      .eq("client_id", clientId)
      .eq("origin", "pre_call")
      .eq("approved", true)
      .is("dropped_at", null),
    supabaseAdmin
      .from("page_plan")
      .select("id, target_keyword_id, headline, role")
      .eq("client_id", clientId)
      .not("role", "is", null),
  ]);

  const rows = (plan ?? []) as Array<{ id: string; target_keyword_id: string | null; headline: string | null }>;
  const byKeyword = new Map<string, string>();
  for (const r of rows) {
    if (r.target_keyword_id && !r.headline) byKeyword.set(r.target_keyword_id, r.id);
  }

  const bound: BoundHeadline[] = [];
  let unmatched = 0;
  for (const h of (heads ?? []) as Array<{ id: string; headline: string; keyword_id: string | null; used_page_id: string | null }>) {
    if (h.used_page_id) continue;
    const planRowId = h.keyword_id ? byKeyword.get(h.keyword_id) : undefined;
    if (!planRowId) {
      unmatched++;
      continue;
    }
    const res = await approveHeadlineForPage({ clientId, headlineId: h.id, planRowId, by });
    if (res.ok) {
      bound.push({ planRowId, headline: h.headline });
      byKeyword.delete(h.keyword_id as string);
    } else {
      unmatched++;
      console.error(`[headline-plan] ${h.id} not bound: ${res.error}`);
    }
  }

  return { bound, unmatched };
}
