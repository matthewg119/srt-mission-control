/**
 * The auto-planner, proved offline.
 *
 *   bun run scripts/_probe-pull-plan.ts
 *
 * ‼️ OFFLINE, AND THAT IS THE POINT RATHER THAN A CONVENIENCE. This file decides how much money is
 * spent and in which cities. Every assertion below runs with no network, no database and no vendor,
 * so the arithmetic can be wrong here for free instead of wrong in Houston for $1.20.
 *
 * ‼️ AND THE NEGATIVE CHECKS ARE THE ONES THAT MATTER. "Prove a check can fail before trusting that
 * it passed": several assertions below exist only to prove that a null remainder does NOT become a
 * budget, because that is the single most expensive mistake this code could make and it is silent.
 */

import {
  PLAN_CHUNK,
  PLAN_MAX_RECORDS,
  PLAN_MEASURE_USD,
  chunkCostUsd,
  expandBudget,
  parsePullBudgetCommand,
  planCardLines,
  planPull,
  whereFor,
} from "@/lib/scraper/pull-plan";
import { parseMapsCommand } from "@/lib/scraper/maps-command";
import type { PlanRow } from "@/lib/scraper/territory";
import { verticalDef, verticalSlugs } from "@/lib/scraper/verticals";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed += 1;
    return;
  }
  failures.push(name + (detail === undefined ? "" : "  got: " + JSON.stringify(detail)));
}

/** A plan row, with the fields the planner reads and sane defaults for the rest. */
function row(p: Partial<PlanRow> & { key: string; priority: number }): PlanRow {
  return {
    key: p.key,
    label: p.label ?? p.key,
    priority: p.priority,
    matched: p.matched ?? [],
    pulled: p.pulled ?? 0,
    sendable: p.sendable ?? 0,
    remaining: p.remaining === undefined ? null : p.remaining,
    daysOfSupply: p.daysOfSupply ?? null,
    worked: p.worked ?? (p.pulled ?? 0) > 0,
    circleTotal: p.circleTotal === undefined ? null : p.circleTotal,
  };
}

const medspa = verticalDef("medspa");

// ── the command ─────────────────────────────────────────────────────────────────────────────────

const known = verticalSlugs();

{
  const r = parsePullBudgetCommand("pull 2000 medspa", known);
  check("`pull 2000 medspa` parses", r?.ok === true && r.command.count === 2000, r);
  check("...and names the vertical", r?.ok === true && r.command.vertical === "medspa");
}
check(
  "a thousands separator is accepted",
  parsePullBudgetCommand("pull 2,000 medspa", known)?.ok === true
);
check(
  "the other word order works",
  (() => {
    const r = parsePullBudgetCommand("pull medspa 300", known);
    return r?.ok === true && r.command.count === 300 && r.command.vertical === "medspa";
  })()
);
check(
  "a trailing noun is ignored",
  parsePullBudgetCommand("pull 500 dentist leads", known)?.ok === true
);
check(
  "backticked, because Slack formats a command as code",
  parsePullBudgetCommand("`pull 2000 medspa`", known)?.ok === true
);

// ‼️ THE TWO GRAMMARS MAY NOT BOTH CLAIM A MESSAGE. If this returned anything but null, a typed
// `pull maps ...` would be answered by the planner and the explicit pull would be unreachable.
check(
  "`pull maps ...` is left alone for the other parser",
  parsePullBudgetCommand("pull maps medspa | Dallas TX | med spa | limit 300", known) === null
);
check(
  "`pull maps medspa` (the queue form) is left alone too",
  parsePullBudgetCommand("pull maps medspa", known) === null
);
// ‼️ NO COUNT MEANS NOT THIS COMMAND. "pull medspa" is the cell queue form, and inventing a budget
// for it would turn a command that takes the next cell into one that buys an arbitrary number.
check("`pull medspa` with no number is not a plan", parsePullBudgetCommand("pull medspa", known) === null);
check("ordinary chat is not a plan", parsePullBudgetCommand("what did we pull yesterday", known) === null);

// ‼️ RETURNING A REFUSAL IS AS MUCH A CLAIM ON A MESSAGE AS RETURNING A COMMAND: both stop it
// reaching the assistant. This channel is a chat surface too, so a pull-shaped SENTENCE has to fall
// through, and only a bare one-word vertical may be refused by name.
check(
  "a pull-shaped sentence falls through to the assistant",
  parsePullBudgetCommand("pull 20 of those into a list", known) === null
);
check(
  "so does a sentence with the number last",
  parsePullBudgetCommand("pull the top ones from 2024", known) === null
);
{
  const r = parsePullBudgetCommand("pull 2000 plumber", known);
  check("but a bare unknown vertical is refused by name", r?.ok === false, r);
}

{
  const r = parsePullBudgetCommand("pull 2000 plumber", known);
  check("an unknown vertical is refused by name", r?.ok === false && /plumber/.test(r.reason), r);
}
{
  const r = parsePullBudgetCommand("pull 99999 medspa", known);
  check("a count over the cap is refused", r?.ok === false && /cap/.test(r.reason), r);
  check("...and the refusal says why the cap exists", r?.ok === false && /TIME/.test(r.reason));
}
check(
  "the cap itself is accepted",
  parsePullBudgetCommand("pull " + PLAN_MAX_RECORDS + " medspa", known)?.ok === true
);

// ── the arithmetic, against the measured Dallas numbers ─────────────────────────────────────────
//
// Ground truth, 2026-10-09 and not to be re-derived: the Dallas 30km circle holds 1,990 for the five
// med spa categories, 1,750 have been pulled, so 240 are left and ONE chunk finishes the metro.

{
  const plan = planPull({
    vertical: "medspa",
    requested: 2000,
    def: medspa,
    rows: [
      row({ key: "dfw", label: "Dallas-Fort Worth", priority: 1, pulled: 1750, remaining: 240, circleTotal: 1990 }),
      row({ key: "houston", label: "Houston", priority: 2 }),
      row({ key: "phoenix", label: "Phoenix-Scottsdale", priority: 3 }),
    ],
  });

  const pulls = plan.steps.filter((s) => s.kind === "pull");
  check("Dallas gets exactly ONE chunk, not four", pulls.length === 1, pulls.map((p) => p.command));
  check("...of 240, which is what is left", pulls[0]?.limit === 240, pulls[0]?.limit);
  check("...starting at offset 1750", pulls[0]?.offset === 1750, pulls[0]?.offset);
  check(
    "...and the command is the one a person would have typed",
    pulls[0]?.command === "pull maps medspa | Dallas TX | med spa | limit 240 | offset 1750",
    pulls[0]?.command
  );
  // ‼️ THE COMMAND HAS TO ROUND-TRIP, because batch_label is what mapsPullHistory re-parses into a
  // paging depth. A label the lane cannot read back gives every chunk a depth of zero forever.
  const back = parseMapsCommand(pulls[0]?.command ?? "");
  check("...and parseMapsCommand reads it back", back.ok === true, back.ok ? null : back.reason);
  check(
    "...to the same limit and offset",
    back.ok && back.command.limit === 240 && back.command.offset === 1750
  );

  check("Dallas is left at zero afterwards", plan.metros[0]?.leftAfter === 0, plan.metros[0]);

  // Houston is next and has never been counted, so it is MEASURED rather than guessed at.
  const measures = plan.steps.filter((s) => s.kind === "measure");
  check("the next unmeasured metro is measured", measures.length >= 1 && measures[0].metroKey === "houston", measures);
  check("...for one task fee plus one record", Math.abs(measures[0].costUsd - PLAN_MEASURE_USD) < 1e-9);
  check("...and the card cannot claim what is left there", plan.metros[1]?.leftAfter === null);

  const reservations = plan.steps.filter((s) => s.kind === "pull_budget");
  check("the rest of the budget is RESERVED, not allocated", reservations.length === 1, reservations);
  check("...for 1,760 records", reservations[0]?.budget === 1760, reservations[0]?.budget);
  check("...and the reservation itself is free", reservations[0]?.costUsd === 0);

  check("allocated is only what is really placed", plan.allocated === 240, plan.allocated);
  check("reserved is the rest", plan.reserved === 1760, plan.reserved);
  check("nothing is unplaced", plan.unplaced === 0, plan.unplaced);
  check(
    "the quoted cost is the chunk plus the measurement, and nothing for the reservation",
    Math.abs(plan.totalCostUsd - (chunkCostUsd(240) + PLAN_MEASURE_USD)) < 1e-9,
    plan.totalCostUsd
  );
  check("the outcome is a plan", plan.outcome.kind === "plan", plan.outcome);
}

// ‼️ THE CHECK THIS WHOLE FILE EXISTS FOR. A metro nobody has counted must never be given a chunk
// list. If this fails, a plan is buying 300 records in a city that might hold 40.
{
  const plan = planPull({
    vertical: "medspa",
    requested: 3000,
    def: medspa,
    rows: [row({ key: "houston", label: "Houston", priority: 2 })],
  });
  check(
    "an unmeasured metro gets NO pull chunks",
    plan.steps.filter((s) => s.kind === "pull").length === 0,
    plan.steps
  );
  check("...it gets a measure step instead", plan.steps.some((s) => s.kind === "measure"));
  check("...and allocated stays zero", plan.allocated === 0, plan.allocated);
}

// ‼️ SIXTEEN UNMEASURED METROS BUY ONE MEASUREMENT, NOT SIXTEEN. A reservation takes the whole
// remaining budget, so a second measurement in the same pass would be a purchase with nothing left
// to spend behind it. Reaching the later metros is the WALK's job, through the leftover cascade
// below, not this pass's.
{
  const rows = Array.from({ length: 16 }, (_, i) =>
    row({ key: "m" + i, label: "Metro " + i, priority: i + 1 })
  );
  const plan = planPull({ vertical: "medspa", requested: 5000, def: medspa, rows });
  check("sixteen unmeasured metros buy ONE measurement", plan.measuring === 1, plan.measuring);
  check(
    "...so the card quotes one task fee and nothing else",
    Math.abs(plan.totalCostUsd - PLAN_MEASURE_USD) < 1e-9,
    plan.totalCostUsd
  );
  check("...and the whole budget is reserved against it", plan.reserved === 5000, plan.reserved);
  check("...with nothing reported as unplaced", plan.unplaced === 0, plan.unplaced);
}

// The leftover cascade, which is what the walk does after a measurement comes back small. Houston
// turned out to hold 400 of the 1,760 reserved, so the other 1,360 must find somewhere to go.
{
  const afterHouston = planPull({
    vertical: "medspa",
    requested: 1360,
    def: medspa,
    rows: [
      // Houston, just expanded and therefore fully allocated.
      row({ key: "houston", label: "Houston", priority: 2, pulled: 400, remaining: 0, circleTotal: 400 }),
      row({ key: "phoenix", label: "Phoenix-Scottsdale", priority: 3 }),
    ],
  });
  check("a leftover measures the NEXT metro", afterHouston.measuring === 1, afterHouston.measuring);
  check(
    "...and that metro is the next one in priority order",
    afterHouston.steps[0]?.metroKey === "phoenix",
    afterHouston.steps[0]
  );
  check("...carrying the leftover forward", afterHouston.reserved === 1360, afterHouston.reserved);

  // With the measurement allowance used up, the leftover is reported rather than spent.
  const noAllowance = planPull({
    vertical: "medspa",
    requested: 1360,
    def: medspa,
    maxMeasures: 0,
    rows: [
      row({ key: "houston", label: "Houston", priority: 2, pulled: 400, remaining: 0, circleTotal: 400 }),
      row({ key: "phoenix", label: "Phoenix-Scottsdale", priority: 3 }),
    ],
  });
  check(
    "a leftover with no measurement allowance left buys nothing",
    noAllowance.steps.length === 0,
    noAllowance.steps
  );
  check("...and says so rather than reporting exhaustion", noAllowance.outcome.kind === "nothing_to_do");
}

// A measured EMPTY metro is skipped. This is the only place zero means finished.
{
  const plan = planPull({
    vertical: "medspa",
    requested: 600,
    def: medspa,
    rows: [
      row({ key: "dfw", label: "Dallas-Fort Worth", priority: 1, pulled: 1990, remaining: 0, circleTotal: 1990 }),
      row({ key: "houston", label: "Houston", priority: 2, pulled: 0, remaining: 800, circleTotal: 800 }),
    ],
  });
  check("a finished metro is skipped", plan.metros[0].allocated === 0, plan.metros[0]);
  check("...and the budget goes to the next one", plan.metros[1].allocated === 600, plan.metros[1]);
  check("...in two chunks of 300", plan.steps.filter((s) => s.kind === "pull").length === 2);
  check("...the second starting at 300", plan.steps[1]?.offset === 300, plan.steps[1]);
}

// The budget, not the metro, is what runs out.
{
  const plan = planPull({
    vertical: "medspa",
    requested: 100,
    def: medspa,
    rows: [row({ key: "houston", label: "Houston", priority: 2, pulled: 0, remaining: 5000, circleTotal: 5000 })],
  });
  check("a budget smaller than a chunk buys one short chunk", plan.steps.length === 1, plan.steps);
  check("...of exactly the budget", plan.steps[0]?.limit === 100, plan.steps[0]);
  check("...and 4,900 are left afterwards", plan.metros[0].leftAfter === 4900, plan.metros[0]);
}

// ‼️ EXHAUSTION NEEDS EVERY CIRCLE MEASURED. Declaring a vertical finished while fifteen metros have
// never been counted would stop the lane buying leads that are there.
{
  const allEmpty = planPull({
    vertical: "medspa",
    requested: 1000,
    def: medspa,
    rows: [
      row({ key: "dfw", label: "Dallas", priority: 1, pulled: 1990, remaining: 0, circleTotal: 1990 }),
      row({ key: "houston", label: "Houston", priority: 2, pulled: 400, remaining: 0, circleTotal: 400 }),
    ],
  });
  check("all measured and empty is exhaustion", allEmpty.outcome.kind === "metros_exhausted", allEmpty.outcome);

  const oneUnmeasured = planPull({
    vertical: "medspa",
    requested: 1000,
    def: medspa,
    rows: [
      row({ key: "dfw", label: "Dallas", priority: 1, pulled: 1990, remaining: 0, circleTotal: 1990 }),
      row({ key: "houston", label: "Houston", priority: 2 }),
    ],
  });
  check(
    "one unmeasured metro is NOT exhaustion",
    oneUnmeasured.outcome.kind === "plan",
    oneUnmeasured.outcome
  );

  // And with measuring switched off it has to say the budget could not be spent, never "finished".
  const noMeasure = planPull({
    vertical: "medspa",
    requested: 1000,
    def: medspa,
    maxMeasures: 0,
    rows: [
      row({ key: "dfw", label: "Dallas", priority: 1, pulled: 1990, remaining: 0, circleTotal: 1990 }),
      row({ key: "houston", label: "Houston", priority: 2 }),
    ],
  });
  check(
    "with measuring off it reports nothing to do, not exhaustion",
    noMeasure.outcome.kind === "nothing_to_do",
    noMeasure.outcome
  );
  check(
    "...and says the circles are unmeasured",
    noMeasure.outcome.kind === "nothing_to_do" && /never had their circle measured/.test(noMeasure.outcome.reason)
  );
}

// ── expanding a reservation ─────────────────────────────────────────────────────────────────────

{
  // The failure the whole deferral exists to prevent: a metro that turns out to hold 40.
  const small = expandBudget({
    vertical: "medspa",
    query: "med spa",
    where: "Houston TX",
    metroKey: "houston",
    metroLabel: "Houston",
    totalCount: 40,
    alreadyPulled: 0,
    budget: 1760,
    startSeq: 2,
  });
  check("a metro holding 40 gets one chunk of 40", small.length === 1 && small[0].limit === 40, small);
  check("...not a chunk of 300", small.every((s) => (s.limit ?? 0) <= 40));

  const big = expandBudget({
    vertical: "medspa",
    query: "med spa",
    where: "Houston TX",
    metroKey: "houston",
    metroLabel: "Houston",
    totalCount: 5000,
    alreadyPulled: 0,
    budget: 1000,
    startSeq: 2,
  });
  check("a big metro is capped by the BUDGET", big.reduce((a, s) => a + (s.limit ?? 0), 0) === 1000, big.length);
  check("...in chunks of " + PLAN_CHUNK, big.filter((s) => s.limit === PLAN_CHUNK).length === 3, big.map((b) => b.limit));
  check("...the last one being the remainder", big[big.length - 1]?.limit === 100, big[big.length - 1]);
  // ‼️ OFFSETS COMPARED AS AN ORDERING, NOT AS A LIST OF LITERALS. The thing being asserted is that
  // each chunk starts where the last one ended, which is what makes a pull continue rather than
  // re-buy the top of the list.
  check(
    "...and every offset is the previous offset plus the previous limit",
    big.every((s, i) => i === 0 || s.offset === (big[i - 1].offset ?? 0) + (big[i - 1].limit ?? 0)),
    big.map((b) => [b.offset, b.limit])
  );

  const exhausted = expandBudget({
    vertical: "medspa",
    query: "med spa",
    where: "Houston TX",
    metroKey: "houston",
    metroLabel: "Houston",
    totalCount: 300,
    alreadyPulled: 300,
    budget: 1000,
    startSeq: 2,
  });
  check("a metro already fully pulled expands to nothing", exhausted.length === 0, exhausted);

  // The expanded steps must sort AFTER the reservation and before whatever followed it, or the walk
  // runs them in the wrong order.
  check("expanded chunks sort after their reservation", big.every((s) => s.seq > 2), big.map((b) => b.seq));
  check("...and before the next whole step", big.every((s) => s.seq < 3), big.map((b) => b.seq));
}

// ── the place string ────────────────────────────────────────────────────────────────────────────
//
// ‼️ THE ANCHOR CITY, NOT THE LABEL. "Dallas-Fort Worth,United States" is not a place and the
// geocoder refuses it, which would fail the pull AFTER a card had been posted.
check("dfw resolves to its anchor city", whereFor("dfw", "Dallas-Fort Worth") === "Dallas TX", whereFor("dfw", "x"));
check("houston resolves to Houston TX", whereFor("houston", "Houston") === "Houston TX");
check("an unknown key falls back to the label", whereFor("nowhere", "Nowhere") === "Nowhere");

// ── the card ────────────────────────────────────────────────────────────────────────────────────

{
  const plan = planPull({
    vertical: "medspa",
    requested: 2000,
    def: medspa,
    rows: [
      row({ key: "dfw", label: "Dallas-Fort Worth", priority: 1, pulled: 1750, remaining: 240, circleTotal: 1990 }),
      row({ key: "houston", label: "Houston", priority: 2 }),
    ],
  });
  const card = planCardLines(plan, { verticalLabel: "Med spa and aesthetics", verifierCreditsLeft: 10500 }).join("\n");

  check("the card names the metros", /Dallas-Fort Worth/.test(card) && /Houston/.test(card));
  check("the card names the cost", /Cost:/.test(card) && /\$/.test(card));
  check("the card names the chunk count", /Chunks:/.test(card));
  check("the card says what is left after", /left after: 0/.test(card), card);
  check("the card says nothing is bought until a reaction", /Nothing is bought until you react/.test(card));
  check("the card says a circle is being measured first", /never had its circle counted/.test(card));
  check("the card names the MillionVerifier budget", /MillionVerifier/.test(card));
  // ‼️ NO EM DASHES IN ANYTHING THE SYSTEM GENERATES. Standing rule, and a card is copy.
  check("the card has no em dash", !card.includes("—"), card.match(/.{0,30}—.{0,30}/)?.[0]);
}

// ‼️ PROVE THE CHECKS CAN FAIL. Every assertion above passing means nothing unless a wrong planner
// would have been caught, so this builds the exact mistake the design forbids and asserts it IS
// different from what the real planner does.
{
  const rows = [row({ key: "houston", label: "Houston", priority: 2 })];
  const real = planPull({ vertical: "medspa", requested: 900, def: medspa, rows });
  const naive = planPull({
    vertical: "medspa",
    requested: 900,
    def: medspa,
    // The mistake: reading "not measured" as "holds what Dallas holds".
    rows: [row({ key: "houston", label: "Houston", priority: 2, remaining: 1990, circleTotal: 1990 })],
  });
  check(
    "the guess-the-circle version WOULD have bought records",
    naive.steps.filter((s) => s.kind === "pull").length === 3,
    naive.steps.length
  );
  check(
    "...and the real planner buys none of them",
    real.steps.filter((s) => s.kind === "pull").length === 0
  );
}

// ── report ──────────────────────────────────────────────────────────────────────────────────────

console.log("");
console.log("pull plan probe: " + passed + " passed, " + failures.length + " failed");
for (const f of failures) console.log("  FAIL  " + f);
console.log("");
process.exit(failures.length === 0 ? 0 : 1);
