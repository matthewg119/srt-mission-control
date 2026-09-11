// What happens when the offer changes AFTER the prep call step was already done.
//
// ‼️ TWO DOORS, ONE CONSEQUENCE. The offer is locked from the prep call's step thread
// (handleOfferThreadReply) and from the page studio (offerCommand), and SRT's lock came through
// the studio. Before this, neither re-aimed anything: three places said the question set and the
// page candidates were "rebuilt against this" and nothing rebuilt them.
//
// Two mechanisms, and they cover different moments:
//   - pressing [Done] on the prep call re-runs every finished generator the lock now blocks
//     (reaimStaleDependents in delivery-checklist.ts, keyed on blockedBy);
//   - changing the treatment or the terms once that step is ALREADY done lands here, because a
//     reply in a finished step's thread completes nothing and so reaches no hook.
//
// ‼️ THE KEYWORD STEP IS REOPENED, NOT PATCHED. Its runner compares what the stored rows were
// expanded for against the offer as it stands and resets the expansion and the approval when they
// differ. The page candidates and the call sheet follow it through reaimStaleDependents when it is
// approved again. Drafted pages are never redrafted: a draft may already carry somebody's words.

import { supabaseAdmin } from "@/lib/db";

export async function reaimDownstream(
  clientId: string,
  change: { treatmentChanged: boolean; termsChanged: boolean }
): Promise<string[]> {
  if (!change.treatmentChanged && !change.termsChanged) return [];

  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status")
    .eq("client_id", clientId)
    .in("step_key", ["offer_locked", "avatar_harvest", "keyword_set", "pre_call_pages"]);
  const status = new Map(((data ?? []) as Array<Record<string, unknown>>).map((r) => [String(r.step_key), String(r.status)]));

  // Before the step is done there is nothing to re-aim: nothing after it has run, and pressing
  // [Done] re-runs whatever did.
  if (status.get("offer_locked") !== "complete") return [];

  const { stepNumber } = await import("@/config/delivery-steps");
  const { notifyStep } = await import("./step-board");
  const did: string[] = [];
  const ran = (s: string | undefined) => Boolean(s) && s !== "pending" && s !== "blocked";

  // The research brief and its KEYWORDS block are written about the treatment, so a new treatment
  // gets a new prompt. New terms alone do not: the brief does not change enough to re-run it.
  if (change.treatmentChanged && ran(status.get("avatar_harvest"))) {
    const { postResearchPrompt } = await import("./artifacts/deep-research-run");
    const res = await postResearchPrompt(clientId).catch((e) => ({ ok: false, error: (e as Error).message }));
    did.push(
      res.ok
        ? `Step ${stepNumber("avatar_harvest")}'s research prompt was posted again, written about the new offer.`
        : `Step ${stepNumber("avatar_harvest")}'s research prompt could not be posted again: ${res.error ?? "unknown"}.`
    );
  }

  const kw = status.get("keyword_set");
  if (kw === "running") {
    did.push(
      `Step ${stepNumber("keyword_set")} is expanding right now. Say \`offer:\` or \`terms:\` again once ` +
        "its card appears, and it re-runs against the new answer."
    );
  } else if (ran(kw)) {
    const { setDeliveryStep } = await import("./delivery-checklist");
    const res = await setDeliveryStep({
      clientId,
      stepKey: "keyword_set",
      transition: "reopened",
      actor: "the offer changing",
    });
    did.push(
      res.ok
        ? `Step ${stepNumber("keyword_set")}'s keyword set was reopened and re-expands against the new ` +
            `${change.treatmentChanged ? "offer" : "terms"}. Its approval is cleared, because what was ` +
            "approved was a different set."
        : `Step ${stepNumber("keyword_set")} could not be reopened: ${res.error ?? "unknown"}.`
    );
  }

  if (ran(status.get("pre_call_pages"))) {
    await notifyStep(
      clientId,
      "pre_call_pages",
      ":warning: The offer changed after these pages were planned. Nothing here is redrafted, because a " +
        "draft may already carry somebody's words. Once the keyword set is approved again, `plan new` " +
        "re-proposes every page that is not approved yet."
    ).catch(() => {});
    did.push(`Step ${stepNumber("pre_call_pages")} was told. Its drafts are left alone.`);
  }

  if (did.length) {
    await notifyStep(
      clientId,
      "offer_locked",
      [":repeat: *Re-aimed at the new answer:*", ...did.map((d) => `  • ${d}`)].join("\n")
    ).catch(() => {});
  }
  return did;
}
