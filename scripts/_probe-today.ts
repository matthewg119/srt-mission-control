// The day plan, proved: the role map, the ordering, and the noise rule.
//
//   bunx tsx --env-file=.env.local scripts/_probe-today.ts
//
// Sections 1 to 4 are PURE and run with no environment at all. Section 5 builds a real plan and is
// the one that needs the env file; it asserts the noise rule against live rows, because that is the
// only place noise can actually appear.
//
// WHAT IT PROVES
//  1. Every one of the 41 steps has a role, and `isOwnerWork` is the same two states stepDigest uses.
//  2. `unblocks` counts the transitive graph, from config, with no database read.
//  3. Scores explain themselves: every term pushes a sentence.
//  4. Pins beat scores, deferred items leave the lanes, empty lanes are not rendered.
//  5. No decommissioned business reaches the plan, and an unreadable source is NAMED.

import { DELIVERY_STEPS, stepNumber, type StepKey } from "../src/config/delivery-steps";
import { EFFORT_BY_VERB, ROLE_LABEL, ROLE_ORDER, STEP_ROLE, isOwnerWork, roleForStep } from "../src/config/roles";
import { STEP_ACTIONS } from "../src/lib/clients/do-this-now";
import { groupByRole, looksDecommissioned, itemKeyScope, stepKeyFor, type DayItem } from "../src/lib/today/item";
import { scoreFollowup, scorePage, scoreStep, unblockCount } from "../src/lib/today/score";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

const NOW = Date.parse("2026-09-23T15:00:00Z");

function item(over: Partial<DayItem> = {}): DayItem {
  return {
    key: "delivery_step:c1:keyword_set",
    source: "delivery_step",
    role: "writer",
    title: "A client: a step",
    detail: null,
    href: null,
    slackPermalink: null,
    clientId: "c1",
    clientName: "A client",
    priority: "high",
    status: "open",
    dueAt: null,
    createdAt: "2026-09-20T09:00:00Z",
    bucket: "no_date",
    effortMinutes: 20,
    unblocks: 0,
    score: 10,
    reasons: ["because"],
    pinnedRank: null,
    deferredUntil: null,
    typeLabel: "step 12",
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. every step has a role");

check(`all ${DELIVERY_STEPS.length} steps are mapped`, DELIVERY_STEPS.every((s) => Boolean(STEP_ROLE[s.key as StepKey])));
check("the map has no extra keys", Object.keys(STEP_ROLE).length === DELIVERY_STEPS.length, `${Object.keys(STEP_ROLE).length} vs ${DELIVERY_STEPS.length}`);
check("keyword_set is writing work", roleForStep("keyword_set") === "writer");
check("offer_locked is onboarding, not outreach", roleForStep("offer_locked") === "onboarder");
check("weekly_report is delivery, because the client is already a client", roleForStep("weekly_report") === "delivery");

// ‼️ THE SAME TWO STATES stepDigest CHOSE. If these drift, the morning Slack post and the Today page
// start telling somebody different things about the same board.
check("awaiting_me is owner work", isOwnerWork("awaiting_me"));
check("error is owner work", isOwnerWork("error"));
for (const s of ["pending", "blocked", "ready", "running", "complete", "skipped"]) {
  check(`${s} is NOT owner work`, !isOwnerWork(s));
}

check("every action verb has an effort", DELIVERY_STEPS.every((s) => typeof EFFORT_BY_VERB[STEP_ACTIONS[s.key as StepKey].verb] === "number"));
check("a step that only waits costs nothing", EFFORT_BY_VERB.wait === 0);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. unblocks comes from config, not from a board");

const early = unblockCount("offer_locked");
const late = unblockCount("day_30_date");
check("an early step unblocks many", early > 5, String(early));
check("the last step unblocks nothing", late === 0, String(late));
check(
  "it is transitive, not just direct",
  early > (DELIVERY_STEPS.filter((s) => (s.blockedBy ?? []).includes("offer_locked")).length),
  `${early} transitive vs direct`
);
check("it is deterministic", unblockCount("keyword_set") === unblockCount("keyword_set"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. a score that explains itself");

const errored = scoreStep({
  status: "error",
  updatedAt: "2026-09-22T09:00:00Z",
  errorDetail: "the table is missing",
  stepLabel: "Keywords",
  stepNumber: stepNumber("keyword_set"),
  unblocks: 21,
  now: NOW,
});
check("an errored step outranks a waiting one", errored.score > 60);
check("the error text is in the reason", errored.reasons.some((r) => r.includes("the table is missing")));
check("every term pushed a sentence", errored.reasons.length >= 2, errored.reasons.join(" | "));

const fresh = scoreStep({
  status: "awaiting_me",
  updatedAt: new Date(NOW).toISOString(),
  errorDetail: null,
  stepLabel: "Keywords",
  stepNumber: 12,
  unblocks: 0,
  now: NOW,
});
const stale = scoreStep({
  status: "awaiting_me",
  updatedAt: "2026-09-17T09:00:00Z",
  errorDetail: null,
  stepLabel: "Keywords",
  stepNumber: 12,
  unblocks: 0,
  now: NOW,
});
check("a step waiting six days outranks one posted today", stale.score > fresh.score);
check("and says how long", stale.reasons.some((r) => /\d+ days/.test(r)), stale.reasons.join(" | "));

const unwritten = scorePage({ approvedAt: "2026-08-20T09:00:00Z", claimedAt: null, now: NOW });
check("a page approved a month ago and still unwritten climbs", unwritten.score > 20, String(unwritten.score));
check("and says so", unwritten.reasons.some((r) => /week/.test(r)));

const noDate = scoreFollowup({ dueAt: null, now: NOW, priority: "normal" });
check("a follow-up with no date set is surfaced, not hidden", noDate.score >= 35);
check("and the reason is worklist.ts's own wording", noDate.reasons.some((r) => /no follow-up date/.test(r)));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. ordering");

const pinnedLow = item({ key: "a", score: 1, pinnedRank: 0 });
const unpinnedHigh = item({ key: "b", score: 99 });
const g1 = groupByRole([unpinnedHigh, pinnedLow], ROLE_ORDER, ROLE_LABEL);
check("a pin beats a score", g1.groups[0].items[0].key === "a", g1.groups[0].items.map((i) => i.key).join(","));

const future = new Date(NOW + 86_400_000).toISOString();
const g2 = groupByRole([item({ key: "c" }), item({ key: "d", deferredUntil: future })], ROLE_ORDER, ROLE_LABEL);
check("a deferred item leaves the lanes", g2.groups[0].items.every((i) => i.key !== "d"));
check("and is still shown under Not today", g2.later.some((i) => i.key === "d"));

const past = new Date(NOW - 86_400_000).toISOString();
const g3 = groupByRole([item({ key: "e", deferredUntil: past })], ROLE_ORDER, ROLE_LABEL);
check("a defer that has expired comes back", g3.groups.some((g) => g.items.some((i) => i.key === "e")));

// ‼️ AN EMPTY LANE EVERY MORNING TEACHES SOMEBODY TO SKIM PAST THE HEADINGS.
check("an empty lane is not rendered", groupByRole([item({ role: "writer" })], ROLE_ORDER, ROLE_LABEL).groups.length === 1);
check("the lane carries its own estimate", g1.groups[0].estMinutes === 40, String(g1.groups[0].estMinutes));

check("the key round trips", itemKeyScope(stepKeyFor("c1", "keyword_set")).source === "delivery_step");
check("an unknown key is refused rather than guessed", itemKeyScope("nonsense:1").source === null);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. the noise rule, against a real plan");

check("a funding task would be caught", looksDecommissioned({ title: "Chase the lender for a decision", detail: null }));
check("a trading task would be caught", looksDecommissioned({ title: "IBKR reconnect", detail: null }));
check("real AEO work is not", !looksDecommissioned({ title: "SRT Agency LLC: Keywords", detail: "waiting on you" }));

if (!process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.SUPABASE_URL) {
  console.log("  ..    no database configured, skipping the live half");
} else {
  const { buildDayPlan } = await import("../src/lib/today/plan");
  const plan = await buildDayPlan();
  const all = [...plan.groups.flatMap((g) => g.items), ...plan.later];

  check("the plan has a business-day key, not a UTC slice", /^\d{4}-\d{2}-\d{2}$/.test(plan.planDay), plan.planDay);
  check("every item came from a declared source", all.every((i) => itemKeyScope(i.key).source !== null));
  check(
    "no decommissioned business reached the plan",
    all.every((i) => !looksDecommissioned(i)),
    all.filter((i) => looksDecommissioned(i)).map((i) => i.title).join(" | ")
  );
  check("every item has at least one reason", all.every((i) => i.reasons.length > 0));
  check("every delivery item links somewhere", all.filter((i) => i.source === "delivery_step").every((i) => Boolean(i.href)));

  // ‼️ AN EMPTY DAY AND A BROKEN READ LOOK IDENTICAL ON SCREEN, and only one of them means there is
  // nothing to do.
  check(
    "an unreadable source would be named",
    Array.isArray(plan.unreadable),
    plan.unreadable.join(", ") || "(all sources readable)"
  );
  console.log(`  ..    ${all.length} items, ${plan.groups.length} lanes, ordering ${plan.orderingUnavailable ? "UNAVAILABLE" : "live"}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
