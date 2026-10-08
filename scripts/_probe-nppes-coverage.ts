/**
 * Does the NPI registry know the owner of the clinics our own crawl could not name? And if it does,
 * can that name actually become a deliverable address?
 *
 *   bun run scripts/_probe-nppes-coverage.ts                 measure the frozen sample
 *   bun run scripts/_probe-nppes-coverage.ts --pick          choose the sample and write it down
 *   bun run scripts/_probe-nppes-coverage.ts --n=10          a quick smoke run over the first 10
 *   bun run scripts/_probe-nppes-coverage.ts --run=<uuid>    a different run's failures
 *
 * ‼️ THIS IS FREE, AND IT IS STILL A MEASUREMENT RATHER THAN AN INTEGRATION. NPPES is a public CMS
 * API with no key, no account and no published quota, so unlike _probe-prospeo-coverage.ts there is
 * no --yes gate: nothing here can spend money. What it buys is the answer to a question that was
 * about to be settled by inference instead of by counting.
 *
 * ‼️ THE SAMPLE IS THE FAILURES, AND IT IS THE CLINICAL FAILURES SPECIFICALLY. Measured on
 * 2026-10-06 against run c74a895d (the 500-record Dallas pull):
 *
 *   qualified on 2026-09-28       101 companies, 78 of them primary_type "Medical spa"
 *   of those, owner name found     25  (25%, the number this rung has to move)
 *   of those, still nameless       76  after the site crawl had its turn (75 with a city and state)
 *
 * The run was re-judged on 2026-10-06 against the widened ICP and 155 more companies were kept, but
 * those are NOT the cohort: 17 beauty salons, 9 nail salons, 5 hair salons and 5 massage therapists
 * against 11 medical spas. NPPES asks for enumeration_type NPI-2, an organisation with a licensed
 * clinician, so a nail salon has no NPI as a matter of law. Measuring there would score the business
 * mix and read as a verdict on the registry. See the note at the top of nppes.ts.
 *
 * ‼️ IT ASKS THROUGH lookupOwner, NOT THROUGH A REBUILT URL, AND THAT HAS TWO CONSEQUENCES WORTH
 * STATING BEFORE THEY ARE DISCOVERED. The matching rules are the part that can be wrong -- the
 * trailing wildcard, matchConfidence's eight-character containment floor, pickOwner skipping type-1
 * individual NPIs, the registry answering 200 with an Errors array instead of a 4xx -- so a probe
 * that reimplements the query stops proving the real thing. Because it is the real path:
 *   1. it WRITES client_datasets rows (kind "nppes.owner", cost 0) through getOrFetch, so after this
 *      runs a row count there is no longer proof that PRODUCTION asked. Use hit_count and fetched_at.
 *   2. it WARMS the 180-day cache, so the production sweep over these same companies is free and
 *      instant. That is a benefit, not a side effect to avoid.
 *
 * ‼️ AND IT PROVES IT CAN REFUSE BEFORE IT REPORTS A SINGLE MATCH. A coverage number from an
 * instrument that has never been seen to say no is not evidence. The control below asks for a
 * business that cannot exist and requires a refusal; the probe exits 1 if it gets a name instead.
 *
 * ‼️ WHAT IT MEASURED, 2026-10-06, over all 75. Recorded here so it is not re-run to re-learn it:
 *
 *   registry named somebody        2 of 75    both exact, one carrying an MD
 *   owner-identified would go      25/101 -> 27/101   (25% -> 27%)
 *   of those 2, permutable         1          the other is on Google Workspace, where the rung refuses
 *
 *   receives mail at all          49 of 75
 *     Google Workspace             20   permute-guess refuses outright
 *     Microsoft 365                16   decisive 93% of the time
 *     another named provider        3
 *     MX present, host unknown     10   still guessable
 *   no MX at all                   26   freeRejects drops these for nothing
 *   domains a guess is allowed on  29   the ceiling BEFORE any name is known
 *
 * So NPPES does not move the 25%, and the reason is the vertical rather than the lookup.
 * docs/2026-09-27-owner-email-vendors.md had already measured both sides and written the rule down:
 * "dental   NPI is excellent and free. Use it. / med spa   NPI is a bonus source at best." It saw 20
 * of 20 dentists in Oklahoma carry an authorized official, against 2 of 14 Dallas med spas with one
 * of those a false positive. This is that same answer at five times the sample, and with zero false
 * positives: matchConfidence's eight-character containment floor rejects the exact pair that fooled
 * the hand sampling (`Sage and Skin Aesthetics` vs `SAGE AND SADDLE COUNSELING` scores weak).
 *
 * The conclusion is therefore NOT to retire the rung. It is to stop asking it about cash-pay
 * aesthetics, which mostly have no organisational NPI, and to keep it for `dentist` where
 * registration is the norm. Unconditional, it costs about half a second of a 240 second tick per
 * nameless lead to find roughly three names per hundred.
 *
 * ‼️ bun run, NOT bunx tsx, for DATABASE_URL and the Supabase keys out of .env.local.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { SQL } from "bun";
import { lookupOwner } from "@/lib/scraper/nppes";
import { mailProviderOf, mxRecords } from "@/lib/scraper/mx";
import { permutations } from "@/lib/scraper/enrich";

type Row = Record<string, unknown>;
interface TagSQL {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]>;
  unsafe(query: string): Promise<Row[]>;
  end(): Promise<void>;
}

/** The 500-record Dallas pull, whose 09-28 cohort is the 25% baseline this rung has to move. */
const DEFAULT_RUN = "c74a895d-4ea0-4d1b-9904-33fb4ace00b4";
const SAMPLE_FILE = "docs/2026-10-06-nppes-sample.txt";

/**
 * The owner-identified rate this rung has to beat, measured on the same run's clinical cohort.
 *
 * ‼️ A LITERAL, BECAUSE THE QUERY THAT PRODUCED IT CANNOT BE RE-RUN FOR THE SAME ANSWER. The moment
 * NPPES writes a name, owner_name stops being empty and the cohort this number describes no longer
 * exists. Re-deriving it later would quietly measure the after-state and report it as the before.
 */
const BASELINE_WITH_NAME = 25;
const BASELINE_QUALIFIED = 101;

const dbUrl = process.env.DATABASE_URL;
const argv = process.argv.slice(2);
const pick = argv.includes("--pick");
const n = Number(argv.find((a) => a.startsWith("--n="))?.slice(4) ?? 500);
const runId = argv.find((a) => a.startsWith("--run="))?.slice(6) ?? DEFAULT_RUN;

if (!dbUrl) {
  console.error("DATABASE_URL is not set in .env.local.");
  process.exit(1);
}
// Interpolated into SQL below, so it is validated rather than trusted. Same guard as requalify-run.ts.
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
  console.error(`--run must be a uuid. Got "${runId}".`);
  process.exit(1);
}

interface Target {
  id: string;
  businessName: string;
  city: string | null;
  state: string | null;
  domain: string | null;
}

const sql = new SQL(dbUrl) as unknown as TagSQL;

/**
 * The companies the crawl was asked about and could not name.
 *
 * `enriched_at is not null` is the part that makes this the failures: it is stage 4's exit stamp,
 * written on a miss as well as a hit, so a row carrying it was genuinely offered to the site crawl.
 * A qualified row without it was never asked and belongs to no cohort yet.
 */
async function queryCohort(): Promise<Target[]> {
  const rows = (await sql.unsafe(`
    select id, business_name, city, state, domain
    from raw_leads
    where run_id = '${runId}'
      and qualify_keep
      and enriched_at is not null
      and coalesce(owner_name, '') = ''
      and city is not null
      and state is not null
    order by business_name
  `)) as Array<Record<string, string | null>>;
  return rows.map((r) => ({
    id: String(r.id),
    businessName: String(r.business_name ?? ""),
    city: r.city,
    state: r.state,
    domain: r.domain,
  }));
}

function writeFrozen(targets: Target[]): void {
  const body = [
    `# The frozen NPPES cohort: companies in run ${runId} that were qualified, offered to the site`,
    "# crawl, and left with no owner name. Written " + new Date().toISOString().slice(0, 10) + ".",
    "#",
    "# ‼️ RE-DERIVING THIS IS A DIFFERENT COHORT. The predicate keys on owner_name being empty, so",
    "# every name this rung finds removes a row from it. Frozen so a re-run stays paired.",
    "#",
    "# id\tbusiness_name\tcity\tstate\tdomain",
    ...targets.map((t) =>
      [t.id, t.businessName, t.city ?? "", t.state ?? "", t.domain ?? ""].join("\t")
    ),
  ].join("\n");
  writeFileSync(SAMPLE_FILE, body + "\n");
}

function loadFrozen(): Target[] | null {
  if (!existsSync(SAMPLE_FILE)) return null;
  const out: Target[] = [];
  for (const line of readFileSync(SAMPLE_FILE, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [id, businessName, city, state, domain] = line.split("\t");
    if (!id || !businessName) continue;
    out.push({
      id,
      businessName,
      city: city || null,
      state: state || null,
      domain: domain || null,
    });
  }
  return out.length ? out : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The two controls.
//
// ‼️ BOTH DIRECTIONS, AND THE POSITIVE ONE IS THE ONE THAT NEARLY GOT SKIPPED. A refusal control
// alone is passed perfectly by a rung that can only ever return null -- wrong credentials, a changed
// endpoint, a regex that matches nothing -- and such a rung reports 0% coverage, which reads as
// "this vertical has no NPIs" and would retire the idea on the strength of a bug. So the probe also
// has to be seen finding somebody it is known to be able to find, before any count is believed.
// ─────────────────────────────────────────────────────────────────────────────
const CONTROL_NAME = "Zzqx Nonexistent Aesthetics Institute";
const control = await lookupOwner({ businessName: CONTROL_NAME, city: "Dallas", state: "TX" });
if (control) {
  console.error(
    "NEGATIVE CONTROL FAILED. The registry returned a name for a business that cannot exist:\n" +
      `  asked for : ${CONTROL_NAME}\n` +
      `  matched   : ${control.organizationName} -> ${control.firstName} ${control.lastName} (${control.confidence})\n` +
      "A coverage number from an instrument that cannot refuse is not evidence. Stopping."
  );
  await sql.end();
  process.exit(1);
}

/**
 * A real NPI-2 organisation in the same city and vertical as the cohort.
 *
 * Registered as "SKIN CANCER CONSULTANTS PA", so it also exercises the LEGAL_SUFFIXES strip and
 * lands on `exact` rather than `strong`. Verified 2026-10-06: NPI 1164724837, Priya Zeikus, MD.
 */
const POSITIVE_NAME = "Skin Cancer Consultants";
const positive = await lookupOwner({ businessName: POSITIVE_NAME, city: "Dallas", state: "TX" });
if (!positive) {
  console.error(
    "POSITIVE CONTROL FAILED. The registry did not name the owner of a business it is known to:\n" +
      `  asked for : ${POSITIVE_NAME} (Dallas, TX)\n` +
      "  expected  : Priya Zeikus, exact, NPI 1164724837\n" +
      "Either the lookup is broken or that registration changed. Until this passes, a zero in the\n" +
      "report below cannot be read as \"these businesses have no NPI\". Stopping."
  );
  await sql.end();
  process.exit(1);
}
console.log(
  `controls ok: "${CONTROL_NAME}" was refused, and ${POSITIVE_NAME} resolved to ` +
    `${positive.firstName} ${positive.lastName} (${positive.confidence}). ` +
    "A hit and a miss are both reportable.\n"
);

// ─────────────────────────────────────────────────────────────────────────────
// The cohort.
// ─────────────────────────────────────────────────────────────────────────────
let targets: Target[];
if (pick) {
  targets = await queryCohort();
  writeFrozen(targets);
  console.log(`wrote ${targets.length} companies to ${SAMPLE_FILE}`);
} else {
  const frozen = loadFrozen();
  if (frozen) {
    targets = frozen;
    console.log(`measuring the frozen cohort from ${SAMPLE_FILE}`);
  } else {
    targets = await queryCohort();
    writeFrozen(targets);
    console.log(`no frozen cohort yet, so one was chosen and written to ${SAMPLE_FILE}`);
  }
}
targets = targets.slice(0, Math.max(1, Math.min(500, n)));

console.log(
  `\nAsking the NPI registry about ${targets.length} companies the site crawl could not name.\n`
);

interface Outcome {
  businessName: string;
  domain: string | null;
  /** The name the registry gave, already through pickOwner's rules. */
  ownerName: string | null;
  confidence: "exact" | "strong" | null;
  matchedOrg: string | null;
  credential: string | null;
  /** What runs this domain's mail, which decides whether a name can be permuted at all. */
  mailProvider: string | null;
  /**
   * Does the domain receive mail at all.
   *
   * ‼️ SEPARATE FROM mailProvider, BECAUSE null THERE MEANS TWO OPPOSITE THINGS. mailProviderOf
   * returns null both for a domain with no MX records AND for one whose MX is simply not in
   * detectMailProvider's list -- a small host, cPanel, self-hosted. The first cannot be mailed at
   * all; the second is perfectly mailable and permute-guess allows it, since the only provider that
   * rung refuses is Google Workspace. Reporting them as one number ("no mx") understated the
   * permutable ceiling by a factor of about ten on the first run of this probe.
   */
  mx: "none" | "present" | "undetermined";
  /** How many addresses permutations() would actually build from this name and domain. */
  permutable: number;
}

const outcomes: Outcome[] = [];

for (const t of targets) {
  let owner = null as Awaited<ReturnType<typeof lookupOwner>>;
  try {
    owner = await lookupOwner({ businessName: t.businessName, city: t.city, state: t.state });
  } catch {
    // lookupOwner swallows its own failures and returns null; this is belt and braces.
  }

  // The mail side is asked for every company, found or not, because the ceiling it describes is a
  // property of the domain. dns.mx is cached, so the second call here is a hit.
  let mailProvider: string | null = null;
  let mx: Outcome["mx"] = "none";
  if (t.domain) {
    try {
      const records = await mxRecords(t.domain);
      if (records === null) mx = "undetermined";
      else if (!records.length) mx = "none";
      else {
        mx = "present";
        mailProvider = await mailProviderOf(t.domain);
      }
    } catch {
      mx = "undetermined";
    }
  } else {
    mx = "undetermined";
  }

  const ownerName = owner ? owner.firstName + " " + owner.lastName : null;
  // The three things that all have to hold for a name to become a candidate address: a name, a
  // domain that receives mail, and a provider permute-guess is willing to guess at. The no-MX half
  // matters because freeRejects throws those away for nothing before MillionVerifier ever sees them.
  const permutable =
    ownerName && t.domain && mx === "present" && mailProvider !== "Google Workspace"
      ? permutations(ownerName, t.domain).length
      : 0;

  outcomes.push({
    businessName: t.businessName,
    domain: t.domain,
    ownerName,
    confidence: owner?.confidence ?? null,
    matchedOrg: owner?.organizationName ?? null,
    credential: owner?.credential ?? null,
    mailProvider,
    mx,
    permutable,
  });

  const verdict = owner ? `${owner.confidence.padEnd(6)} ${ownerName}` : "-";
  const mailLabel =
    mx === "none" ? "no MX" : mx === "undetermined" ? "MX?" : mailProvider ?? "other host";
  console.log(
    `  ${t.businessName.slice(0, 34).padEnd(34)} ${verdict.padEnd(32)} ` +
      `${mailLabel.padEnd(18)}${permutable ? String(permutable) + " addr" : ""}`
  );

  // The cache is the only rate limit CMS publishes, so be polite on the uncached pass.
  await new Promise((r) => setTimeout(r, 400));
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: does the registry know them.
// ─────────────────────────────────────────────────────────────────────────────
const named = outcomes.filter((o) => o.ownerName);
const exact = named.filter((o) => o.confidence === "exact");
const strong = named.filter((o) => o.confidence === "strong");
const credentialed = named.filter((o) => o.credential);

console.log("\n─── does the NPI registry know the owners our crawl could not name ───");
console.log(`  asked                       ${outcomes.length}`);
console.log(`  registry named somebody     ${named.length}`);
console.log(`    exact name match          ${exact.length}`);
console.log(`    strong (containment)      ${strong.length}`);
console.log(`    carries a credential      ${credentialed.length}`);
console.log(`  no NPI, or no match         ${outcomes.length - named.length}`);

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: could those names ship. A name nothing can be built from is not a win.
// ─────────────────────────────────────────────────────────────────────────────
const receivesMail = outcomes.filter((o) => o.mx === "present");
const noMx = outcomes.filter((o) => o.mx === "none");
const undetermined = outcomes.filter((o) => o.mx === "undetermined");
const workspace = receivesMail.filter((o) => o.mailProvider === "Google Workspace");
const microsoft = receivesMail.filter((o) => (o.mailProvider ?? "").startsWith("Microsoft"));
const knownOther = receivesMail.filter(
  (o) =>
    o.mailProvider &&
    o.mailProvider !== "Google Workspace" &&
    !o.mailProvider.startsWith("Microsoft")
);
const unrecognised = receivesMail.filter((o) => !o.mailProvider);
const namedOnWorkspace = named.filter((o) => o.mailProvider === "Google Workspace");
const shippable = outcomes.filter((o) => o.permutable > 0);
const guessableDomains = receivesMail.filter((o) => o.mailProvider !== "Google Workspace");

console.log("\n─── and could a name become an address: who runs the mail ───");
console.log(`  receives mail at all        ${receivesMail.length} of ${outcomes.length}`);
console.log(`    Google Workspace          ${workspace.length}   <- permute-guess refuses outright`);
console.log(`    Microsoft 365             ${microsoft.length}   <- decisive 93% of the time`);
console.log(`    another named provider    ${knownOther.length}`);
console.log(`    MX present, host unknown  ${unrecognised.length}   <- still guessable`);
console.log(`  no MX, cannot be mailed     ${noMx.length}   <- freeRejects drops these for $0`);
console.log(`  could not be asked          ${undetermined.length}`);
console.log(`\n  domains a guess is allowed on ${guessableDomains.length}   <- the ceiling, before any name`);
console.log(`  named AND on Workspace        ${namedOnWorkspace.length}   <- found, and still unusable`);
console.log(`  names permutations can use    ${shippable.length}   <- the ceiling, after the names`);

// ─────────────────────────────────────────────────────────────────────────────
// What it means against the baseline. Counts above, rates here, denominators named.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n─── against the measured baseline ───");
console.log(
  `  before: ${BASELINE_WITH_NAME} of ${BASELINE_QUALIFIED} qualified companies had an owner name ` +
    `(${Math.round((BASELINE_WITH_NAME / BASELINE_QUALIFIED) * 100)}%)`
);
const after = BASELINE_WITH_NAME + named.length;
console.log(
  `  after : ${after} of ${BASELINE_QUALIFIED} if every name above is kept ` +
    `(${Math.round((after / BASELINE_QUALIFIED) * 100)}%)`
);
console.log(
  `  of that gain, ${shippable.length} can be turned into an address and ` +
    `${named.length - shippable.length} cannot.`
);

console.log(
  "\nRead the second number, not the first. permute-guess has been asked about exactly TWO companies\n" +
    "in this run's whole history and shipped none of them, so the rung is untested rather than proven.\n" +
    "A big name count with a small permutable count means the bottleneck moved rather than cleared."
);

await sql.end();
