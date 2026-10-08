/**
 * The territory system, checked against the real database.
 *
 *   bun run scripts/_probe-territory.ts
 *
 * ‼️ bun run, NOT bunx tsx. It needs DATABASE_URL and the Supabase service key out of .env.local.
 *
 * ‼️ THE CHECK THIS PROBE EXISTS FOR IS THE MIRROR. docs/2026-10-08-territory-rollups.sql defines
 * `sendable_lead_ships`, which is the per-source shipping rule from `sendableRows` written a second
 * time in SQL, because PostgREST cannot GROUP BY and the alternative is reading every address into
 * a lambda. A mirror is only acceptable while something proves the two agree, and that is check 1:
 * it counts the same run both ways and fails if the numbers differ. Without this, the territory map
 * could report a different sendable count from the CSV that actually ships, and nothing would say so.
 *
 * ‼️ AND IT IS A LIVE PROBE, SO IT ENDS IN `await sql.end()`. Offline probes end in a summary plus
 * process.exit; this one holds a connection.
 */

import { SQL } from "bun";
import { supabaseAdmin } from "@/lib/db";
import { sendableRows } from "@/lib/scraper/listprep";
import { projectUs, regionOf } from "@/lib/geo/us-albers";
import { US_FIT, US_STATES, US_VIEWBOX } from "@/data/us-outline";
import {
  DOT_GRID,
  contactsPerDay,
  matchMetro,
  metroPlan,
  metroRows,
  pullCommands,
  rawPerDay,
  sendsPerDay,
  stateRows,
  territoryDots,
  territoryVertical,
} from "@/lib/scraper/territory";

type Row = Record<string, unknown>;
interface TagSQL {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]>;
  unsafe(query: string): Promise<Row[]>;
  end(): Promise<void>;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. It lives in .env.local; run this with `bun run`, not tsx.");
  process.exit(1);
}
const sql = new SQL(url) as unknown as TagSQL;

let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) console.log("  ok    " + label);
  else {
    failed += 1;
    console.log("  FAIL  " + label + (detail ? "   " + detail : ""));
  }
}

// ── 1. the mirror ───────────────────────────────────────────────────────────────────────────────

console.log("1. the SQL shipping rule against the one in TypeScript");

const runs = (await sql.unsafe(`
  select r.id, r.label, count(s.id) as addresses
  from list_pipeline_runs r
  join sendable_leads s on s.run_id = r.id
  group by r.id, r.label
  order by count(s.id) desc
`)) as Array<Record<string, unknown>>;

if (!runs.length) {
  // ‼️ NOT A PASS. A probe that reports "ok" when it had nothing to compare is the shape of check
  // that makes a broken mirror invisible for a month.
  check("there is a run with addresses to compare", false, "no run has any sendable_leads rows");
} else {
  for (const r of runs) {
    const runId = String(r.id);
    const viaCode = (await sendableRows(runId)).length;
    const viaSql = Number(
      (
        (await sql.unsafe(`
          select count(*) as n
          from sendable_leads
          where run_id = '${runId}'
            and sendable_lead_ships(provider, email_status, suppressed_reason)
        `)) as Array<Record<string, unknown>>
      )[0]?.n ?? -1
    );
    check(
      `run ${runId.slice(0, 8)} agrees: sendableRows ${viaCode}, SQL ${viaSql}`,
      viaCode === viaSql,
      `${r.label ?? ""} has ${r.addresses} addresses in total`
    );
  }

  // ‼️ AND THE CHECK IS PROVED ABLE TO FAIL, which is this repo's own rule. A rule that ignored the
  // guessing providers would answer differently on any run holding a guessed catch-all; if the two
  // agree here as well, this run cannot distinguish them and the agreement above proves less than
  // it looks. That is reported rather than hidden.
  const runId = String(runs[0].id);
  const loose = Number(
    (
      (await sql.unsafe(`
        select count(*) as n
        from sendable_leads
        where run_id = '${runId}'
          and suppressed_reason is null
          and email_status in ('valid', 'catch_all')
      `)) as Array<Record<string, unknown>>
    )[0]?.n ?? -1
  );
  const strict = (await sendableRows(runId)).length;
  if (loose === strict) {
    console.log(
      "  note  this run holds no guessed catch-all address, so the per-source half of the rule is " +
        "not exercised by it. The agreement above still covers suppression and status."
    );
  } else {
    check(
      "the per-source half of the rule is doing work: a status-only rule disagrees",
      loose !== strict,
      `status-only ${loose}, per-source ${strict}`
    );
  }
}

// ── 2. the stage ladder is total ────────────────────────────────────────────────────────────────

console.log("\n2. every lead lands on exactly one rung");

const ladder = (await sql.unsafe(`
  select
    (select count(*) from raw_leads) as rows_total,
    (select count(*) from territory_lead_stage) as view_rows,
    (select count(*) from territory_lead_stage
      where stage in ('pulled','dropped','call','qualified','sendable','emailed')) as on_a_rung,
    (select count(*) from territory_lead_stage where stage = 'call') as call_rung,
    (select count(*) from territory_lead_stage where stage in ('sendable','emailed')) as with_address
`)) as Array<Record<string, unknown>>;
const L = ladder[0];
check("the view has one row per raw lead", Number(L.view_rows) === Number(L.rows_total), JSON.stringify(L));
check("no lead falls off the ladder", Number(L.on_a_rung) === Number(L.rows_total), JSON.stringify(L));
// ‼️ A LEAD CANNOT BE COUNTED TWICE, and that is not obvious: a lead can carry several addresses
// (info@ and the owner's), so a view that joined sendable_leads row-to-row would report more
// sendable leads than it pulled. The aggregate-then-join in section C of the migration is what
// prevents it, and this is the assertion that would catch its removal.
check(
  "leads with an address never outnumber leads pulled",
  Number(L.with_address) <= Number(L.rows_total),
  JSON.stringify(L)
);
check("the call rung is not empty, so the route column is being written", Number(L.call_rung) > 0, JSON.stringify(L));

// ── 3. the dots ─────────────────────────────────────────────────────────────────────────────────

console.log("\n3. the dots, and the projection under them");

const exact = await territoryDots("medspa", DOT_GRID.metro);
const clustered = await territoryDots("medspa", DOT_GRID.national);
const exactLeads = exact.reduce((n, d) => n + d.n, 0);
const clusteredLeads = clustered.reduce((n, d) => n + d.n, 0);

check("clustering does not lose leads", exactLeads === clusteredLeads, `${exactLeads} vs ${clusteredLeads}`);
check("clustering actually clusters", clustered.length < exact.length, `${clustered.length} vs ${exact.length}`);
check("every dot carries a stage", exact.every((d) => d.stage.length > 0));
check(
  "every dot projects onto the map",
  exact.every((d) => projectUs(d.lat, d.lon, US_FIT) !== null),
  String(exact.filter((d) => projectUs(d.lat, d.lon, US_FIT) === null).length) + " did not"
);
check(
  "and lands inside the frame",
  exact.every((d) => {
    const p = projectUs(d.lat, d.lon, US_FIT)!;
    return p.x >= 0 && p.x <= US_VIEWBOX.width && p.y >= 0 && p.y <= US_VIEWBOX.height;
  })
);

// Known coordinates, so the projection is checked against the world rather than against itself.
// ‼️ THE TOLERANCE IS GENEROUS ON PURPOSE. This is asserting "Dallas is in north Texas", not a
// geodetic result: a tight tolerance would turn a cosmetic change to the frame into a red probe.
const texas = US_STATES.find((s) => s.name === "Texas")!;
const dallas = projectUs(32.7767, -96.797, US_FIT)!;
check(
  "Dallas lands near the Texas label",
  Math.hypot(dallas.x - texas.labelX, dallas.y - texas.labelY) < 90,
  `${dallas.x.toFixed(0)},${dallas.y.toFixed(0)} vs ${texas.labelX},${texas.labelY}`
);
const seattle = projectUs(47.6062, -122.3321, US_FIT)!;
const miami = projectUs(25.7617, -80.1918, US_FIT)!;
check("Seattle is up and to the left of Miami", seattle.x < miami.x && seattle.y < miami.y);
check("Honolulu is in the Hawaii inset, not in the Pacific", regionOf(21.3069, -157.8583) === "hawaii");
check("Anchorage is in the Alaska inset", regionOf(61.2181, -149.9003) === "alaska");
// ‼️ THE REFUSAL IS CHECKED TOO. A projection that answered for Shenzhen would put a dot on Nevada.
check("a coordinate off the map is refused rather than placed", projectUs(51.5, -0.12, US_FIT) === null);
check("a null coordinate is refused", projectUs(null, null, US_FIT) === null);
check("0,0 is refused", regionOf(0, 0) === null);

/**
 * Is a projected point inside a projected state?
 *
 * ‼️ THIS IS THE ONE CHECK THAT PROVES THE OUTLINES AND THE DOTS AGREE. Everything else here
 * tests one or the other. If the generator and `projectUs` ever disagreed by a constant, every dot
 * would sit a few pixels off its state: the map would look plausible, the numbers would be right,
 * and "north Dallas is unworked" would be pointing at the wrong neighbourhood. A ray cast through
 * the `d` string the page actually renders is the only thing that catches it.
 *
 * Even-odd ray casting over every subpath, which is what an SVG path with multiple rings means. The
 * parser is deliberately dumb: these strings are generated by one function in one shape
 * (M x,y L x,y ... Z), so a general path parser would be more code and less certainty.
 */
function insideStatePath(d: string, px: number, py: number): boolean {
  let crossings = 0;
  for (const sub of d.split("M").filter((s) => s.trim().length > 0)) {
    const pts = sub
      .replace(/Z\s*$/, "")
      .split("L")
      .map((pair) => pair.trim().split(",").map(Number))
      .filter((p) => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      if (y1 === y2) continue;
      if (py < Math.min(y1, y2) || py >= Math.max(y1, y2)) continue;
      const xAt = x1 + ((py - y1) / (y2 - y1)) * (x2 - x1);
      if (xAt > px) crossings += 1;
    }
  }
  return crossings % 2 === 1;
}

console.log("\n3b. the dots land inside the outlines, which is the only proof the two agree");

const txPath = US_STATES.find((s) => s.name === "Texas")!.d;
check("Dallas is INSIDE the Texas outline", insideStatePath(txPath, dallas.x, dallas.y), `${dallas.x.toFixed(1)},${dallas.y.toFixed(1)}`);
check("Miami is NOT inside Texas", !insideStatePath(txPath, miami.x, miami.y));

// ‼️ AND IT IS CHECKED OVER THE REAL DATA, NOT JUST ONE CITY. Every stored med spa lead is in
// the Dallas metro, so all of them must fall inside Texas. One off-by-a-constant and this goes red
// for all 550 at once rather than for a sample.
const txDots = exact.filter((d) => d.lon > -106 && d.lon < -93 && d.lat > 25 && d.lat < 37);
const txInside = txDots.filter((d) => {
  const p = projectUs(d.lat, d.lon, US_FIT)!;
  return insideStatePath(txPath, p.x, p.y);
}).length;
check(
  "every Texas-coordinate cluster lands inside the Texas outline",
  txDots.length > 0 && txInside === txDots.length,
  `${txInside} of ${txDots.length}`
);

// A second state, so the check is not accidentally passing on one lucky polygon.
const flPath = US_STATES.find((s) => s.name === "Florida")!.d;
check("Miami is inside the Florida outline", insideStatePath(flPath, miami.x, miami.y));
check("and Seattle is not", !insideStatePath(flPath, seattle.x, seattle.y));

// ── 4. the state layer ──────────────────────────────────────────────────────────────────────────

console.log("\n4. the state layer, with TX and Texas merged");

const states = await stateRows("medspa");
check("Texas appears once, not twice", states.rows.filter((s) => s.name === "Texas").length === 1);
const raw = (await sql.unsafe(`
  select count(*) as n from raw_leads where vertical_slug = 'medspa' and state in ('TX', 'Texas')
`)) as Array<Record<string, unknown>>;
check(
  "and the merged bucket holds both spellings",
  (states.rows.find((s) => s.name === "Texas")?.pulled ?? 0) === Number(raw[0].n),
  `${states.rows.find((s) => s.name === "Texas")?.pulled} vs ${raw[0].n}`
);
check("a state name is never an unrecognised code", states.rows.every((s) => s.name.length > 2));
// ‼️ THE UNPLACED ROWS ARE COUNTED, NOT SWALLOWED. 20 of the stored 550 carry no state at all.
console.log(`  note  ${states.unplaced} leads have no usable state and are reported separately.`);
check("every state outline has a name the rollup could match", US_STATES.every((s) => s.name.length > 1));

// ── 5. the plan arithmetic ──────────────────────────────────────────────────────────────────────

console.log("\n5. the plan, which is what makes it a territory system");

const metros = await metroRows("medspa");
const plan = metroPlan(metros);

check("the plan lists every metro, worked or not", plan.length === 16, String(plan.length));
check("it is in priority order", plan.every((p, i) => i === 0 || plan[i - 1].priority <= p.priority));
check("Dallas is matched to dfw from the stored string `Dallas TX`", matchMetro("Dallas TX") === "dfw");
check("Fort Worth matches the same metro", matchMetro("Fort Worth TX") === "dfw");
// ‼️ A COORDINATE TRIPLE MATCHES NOTHING, ON PURPOSE. Guessing which named metro a 40km circle sits
// in is how a cell pull lands in the wrong column and a metro reads as worked when it is not.
check("a cell coordinate matches no named metro", matchMetro("32.7767,-96.7970,40") === null);
check("an empty metro matches nothing", matchMetro(null) === null && matchMetro("") === null);
check("an unrelated city matches nothing", matchMetro("Bangor ME") === null);

const dfw = plan.find((p) => p.key === "dfw")!;
check("DFW reads as worked", dfw.worked, JSON.stringify(dfw));
check("and carries a remaining count, because its circle was measured", dfw.remaining !== null, JSON.stringify(dfw));
check("so it has days of supply", dfw.daysOfSupply !== null, JSON.stringify(dfw));
check("an unworked metro has no days of supply rather than zero", plan.find((p) => !p.worked)?.daysOfSupply === null);

check("sends a day is the mailbox arithmetic", sendsPerDay() === 1350, String(sendsPerDay()));
check("contacts a day is sends over the sequence", contactsPerDay() === 450, String(contactsPerDay()));
const rpd = rawPerDay();
check(
  "raw records a day brackets the measured rate",
  rpd.low === 3462 && rpd.high === 5000,
  JSON.stringify(rpd)
);
// ‼️ THE LOW RATE PRODUCES THE HIGH RECORD COUNT. Getting this backwards is the mistake that plans
// a day's supply off the optimistic end and leaves 30 mailboxes with nothing to send.
check("a worse sendable rate needs MORE records, not fewer", rpd.high > rpd.low);

const def = territoryVertical("medspa")!;
const cmds = pullCommands(def, "Houston", 0);
check("the plan generates four chunked commands", cmds.length === 4, JSON.stringify(cmds));
check("each is 300 rows, never 3000", cmds.every((c) => /limit 300 /.test(c)), JSON.stringify(cmds));
check("the offsets walk", cmds[1].includes("offset 300") && cmds[3].includes("offset 900"), JSON.stringify(cmds));
check("they name the vertical and a real anchor city", cmds[0].includes("medspa") && cmds[0].includes("Houston TX"));
// ‼️ CONTINUING FROM WHAT IS PULLED IS THE WHOLE REASON THE OFFSET IS AN ARGUMENT. A command set
// that always started at 0 would re-buy the top of a metro it had already paid for.
const resume = pullCommands(def, "Dallas-Fort Worth", 550);
check("a part-pulled metro resumes rather than re-buying", resume[0].includes("offset 550"), JSON.stringify(resume));

// ── 6. nothing on the page needs a table that does not exist ────────────────────────────────────

console.log("\n6. the page's reads all resolve");

for (const fn of ["territory_dots", "territory_metro_rollup", "territory_state_rollup"]) {
  const { error } = await supabaseAdmin.rpc(fn, { p_vertical: "medspa" });
  check(`${fn} is reachable through PostgREST`, !error, error?.message);
}
const cells = (await sql.unsafe(`select count(*) as n from scraper_cells`)) as Array<Record<string, unknown>>;
console.log(
  `  note  scraper_cells holds ${cells[0].n} rows. Zero means the national crawl has never been run, ` +
    "which is a real state the page reports rather than an error."
);

console.log(failed ? `\n${failed} check(s) FAILED.` : "\nAll checks passed.");
await sql.end();
