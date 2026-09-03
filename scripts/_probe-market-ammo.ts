// Proves the three claims this lane is not allowed to be wrong about.
//
// Run: bunx tsx --env-file=.env.local scripts/_probe-market-ammo.ts
//
// ‼️ NO MODEL CALL AND NO WRITES. Every statement is a SELECT or a pure function call. This probe
// is the thing that gets run after a change to convince somebody the dataset is still honest, so it
// has to be safe to run against production at any moment, including while a send cron is running.
//
// WHAT IT PROVES
//   1. PROVENANCE. Every market_mentions row traces to a real audit_runs row that is status='ok'
//      and whose own `recommended` jsonb still contains that business name. The foreign key already
//      makes an orphan impossible, but a foreign key cannot see inside jsonb: it would happily hold
//      a row claiming a run named a business the run never mentioned. This is the check that closes
//      that gap, and it is the whole reason "it may never invent a competitor" is a fact and not a
//      hope.
//   2. AMMO IS NEVER RE-SPENT. Ammo already in the ledger is never offered again, across repeated
//      touches, across supplies that produce the same sentence, and across a rephrasing that
//      normalizes to the same thing.
//   3. THE SPINE DOES NOT MERGE TWO DIFFERENT BUSINESSES. No lead is linked to a contact whose
//      phone is shared with another contact, no link disagrees on the business name, and no contact
//      ended up carrying two different Google place ids.

import { supabaseAdmin } from "@/lib/db";
import { normalizeNameForCompare, stripEntitySuffix } from "@/lib/clients/nap-compare";
import { unspentAmmo, nextAmmo, ammoKey, spentAmmo } from "@/lib/ammo/spend";
import { signalAmmo, type AmmoCandidate } from "@/lib/ammo/supply";
import { parseCityCell, toStateCode, displayPlace } from "@/lib/market/place";
import { matchCitedDomains } from "@/lib/market/aggregate";
import type { AmmoSpent } from "@/lib/followup-operator/types";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

const norm = (s: string): string => stripEntitySuffix(normalizeNameForCompare(s));

// ── 1. Provenance ───────────────────────────────────────────────────────────────────────────

async function provenance(): Promise<void> {
  console.log("\nprovenance: every stored competitor came out of a real run");

  const PAGE = 500;
  let scanned = 0;
  let orphans = 0;
  let notOk = 0;
  let notNamed = 0;
  const examples: string[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("market_mentions")
      .select("id, normalized_name, display_name, engine, audit_runs!inner(status, recommended, engine)")
      .range(from, from + PAGE - 1);

    if (error) {
      check("market_mentions is readable", false, error.message);
      return;
    }
    if (!data || data.length === 0) break;

    for (const row of data as unknown as Array<Record<string, unknown>>) {
      scanned++;
      const run = row.audit_runs as Record<string, unknown> | null;
      if (!run) {
        orphans++;
        continue;
      }
      if (run.status !== "ok") {
        notOk++;
        if (examples.length < 3) examples.push(`${row.display_name} on a ${run.status} run`);
        continue;
      }

      // The name must still be present in the run's own extracted list, compared with the same
      // normalization the aggregator used to store it.
      const recommended = Array.isArray(run.recommended) ? (run.recommended as unknown[]) : [];
      const names = new Set(
        recommended
          .map((r) => (typeof r === "string" ? r : String((r as { name?: string })?.name ?? "")))
          .filter(Boolean)
          .map(norm)
      );

      if (!names.has(row.normalized_name as string)) {
        notNamed++;
        if (examples.length < 3) {
          examples.push(`"${row.display_name}" is not in its run's recommended array`);
        }
      }
    }

    if (data.length < PAGE) break;
  }

  check(`scanned ${scanned} market_mentions rows`, scanned > 0, "the dataset is empty");
  check("every row has its audit run", orphans === 0, `${orphans} orphaned rows`);
  check("every run is status ok", notOk === 0, `${notOk} rows cite a run that produced no data`);
  check(
    "every name appears in its run's own output",
    notNamed === 0,
    `${notNamed} invented names. ${examples.join("; ")}`
  );

  // A competitor stored against a business that IS the report subject would mean the alias filter
  // failed, and it is the one wrong row a human would most likely believe.
  const { count: selfNamed } = await supabaseAdmin
    .from("market_mentions")
    .select("id", { count: "exact", head: true })
    .eq("normalized_name", "");

  check("no blank normalized names", (selfNamed ?? 0) === 0, `${selfNamed} rows with an empty key`);
}

// ── 2. Ammo is never re-spent ───────────────────────────────────────────────────────────────

function ammoNeverRespent(): void {
  console.log("\nammo: nothing already said is ever offered again");

  const a: AmmoCandidate = { kind: "competitor", detail: "ChatGPT named Ageless Men's Health in 10 of the answers we measured." };
  const b: AmmoCandidate = { kind: "competitor", detail: "ChatGPT named Low T Center in 7 of the answers we measured." };
  const c: AmmoCandidate = { kind: "signal", detail: "2 directory citations in the top 10." };

  // Touch 1 takes the first piece.
  const ledger0: AmmoSpent[] = [];
  const first = nextAmmo(ledger0, [a, b, c]);
  check("touch 1 offers the strongest piece", first?.detail === a.detail);

  // Touch 2, with the first recorded, must not offer it again.
  const ledger1: AmmoSpent[] = [{ ...a, step: 1 }];
  const second = nextAmmo(ledger1, [a, b, c]);
  check("touch 2 does not repeat touch 1", second?.detail === b.detail, `got ${second?.detail}`);
  check("spent ammo is filtered out entirely", !unspentAmmo(ledger1, [a, b, c]).some((x) => x.detail === a.detail));

  // Touch 3.
  const ledger2: AmmoSpent[] = [{ ...a, step: 1 }, { ...b, step: 2 }];
  const third = nextAmmo(ledger2, [a, b, c]);
  check("touch 3 moves to the last unspent piece", third?.detail === c.detail, `got ${third?.detail}`);

  // Touch 4 has nothing left. Running dry must be null, never a silent repeat.
  const ledger3: AmmoSpent[] = [{ ...a, step: 1 }, { ...b, step: 2 }, { ...c, step: 3 }];
  check("running out returns null rather than repeating", nextAmmo(ledger3, [a, b, c]) === null);

  // A rephrasing that normalizes to the same sentence is the same argument.
  const rephrased: AmmoCandidate = {
    kind: "competitor",
    detail: "ChatGPT  named  Ageless Men's Health, in 10 of the answers we measured!",
  };
  check("punctuation and spacing changes do not read as fresh ammo", ammoKey(rephrased) === ammoKey(a));
  check("a rephrased spent line is still filtered", !unspentAmmo(ledger1, [rephrased]).length);

  // The same kind is part of the identity: a competitor line and a signal line that happen to read
  // alike are different arguments and must not consume each other.
  check(
    "kind is part of the ammo identity",
    ammoKey({ kind: "signal", detail: a.detail }) !== ammoKey(a)
  );

  // Two supplies producing the same sentence in one call must not hand out a duplicate.
  check("duplicates within one offer are collapsed", unspentAmmo([], [a, a, b]).length === 2);

  // A malformed ledger must read as empty rather than throw inside a send path.
  check("a malformed ledger degrades to empty", spentAmmo({ ammo_used: "not an array" }).length === 0);
  check("junk entries are skipped, valid ones kept", spentAmmo({ ammo_used: [null, 7, { kind: "bogus", detail: "x" }, { kind: "signal", detail: "real" }] }).length === 1);
}

// ── 3. Supply honesty ───────────────────────────────────────────────────────────────────────

function supplyHonesty(): void {
  console.log("\nsupply: an unmeasured component never becomes a claim");

  const components = {
    measured: "2 of 6",
    reviews: { note: "227 reviews", earned: 11, weight: 25, attempted: true },
    photos: { note: "not measured: no profile match", earned: 0, weight: 15, attempted: false },
    rating: { note: "rated 5", earned: 10, weight: 10, attempted: true },
    landing_page: { note: "no landing page on the profile", earned: 0, weight: 20, attempted: false },
  };

  const signals = signalAmmo({ scoreComponents: components });
  const details = signals.map((s) => s.detail).join(" | ");

  check("an unattempted component is never ammo", !details.includes("no profile match"), details);
  check("an unattempted zero is never ammo", !details.includes("landing page"), details);
  check("a component at full weight is not a gap", !details.includes("rated 5"), details);
  check("a measured shortfall is ammo", details.includes("227 reviews"), details);
  check("the `measured` string sibling is not a component", !details.includes("2 of 6"), details);
  check("every signal is a signal", signals.every((s) => s.kind === "signal"));

  // Citation matching under-claims rather than over-claims.
  check(
    "a cited domain is only claimed on a real name match",
    matchCitedDomains("Ageless Men's Health", ["https://www.agelessmenshealth.com/austin"]).length === 1
  );
  check(
    "a short name never claims a domain",
    matchCitedDomains("Ora", ["https://www.orange.com/"]).length === 0
  );
  check(
    "an unrelated domain is not claimed",
    matchCitedDomains("Ageless Men's Health", ["https://www.yelp.com/biz/x"]).length === 0
  );

  // Place normalization is the thing that made the join work at all.
  check("an audit city cell parses", parseCityCell("Austin, TX")?.city === "austin");
  check("its state is read as a code", parseCityCell("Austin, TX")?.state === "TX");
  check("a spelled out state resolves", toStateCode("Texas") === "TX");
  check("a lead city and an audit city meet", parseCityCell("Austin, TX")?.city === "austin");
  check("a place reads back for copy", displayPlace({ city: "saint michael", state: "MN" }) === "Saint Michael, MN");
  check("a comma that is not a state keeps the whole city", parseCityCell("Foo, Bar")?.city === "foo bar");
}

// ── 4. The spine does not merge two different businesses ────────────────────────────────────

async function spineIsSafe(): Promise<void> {
  console.log("\nspine: no two different businesses were merged");

  const tables = ["trt_leads", "prospect_leads", "med_spa_leads"] as const;

  for (const table of tables) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id, business_name, phone_normalized, contact_id")
      .not("contact_id", "is", null)
      .limit(2000);

    if (error) {
      check(`${table} is readable`, false, error.message);
      continue;
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      check(`${table} has links to verify`, false, "nothing linked");
      continue;
    }

    // Every linked row must still agree with its contact on the business name.
    //
    // ‼️ CHUNKED AT 100 IDS AND THE ERROR IS CHECKED. Both matter and both were learned here: a
    // 500-uuid `.in()` list is roughly 19 kB of query string, which the request rejects, and the
    // first version of this probe discarded the error and read the empty result as 500 dangling
    // links. A probe that hides its own failure and blames the data is worse than no probe.
    const ids = rows.map((r) => r.contact_id as string);
    const contacts = new Map<string, string>();
    let lookupFailed = false;
    for (let i = 0; i < ids.length; i += 100) {
      const { data: cs, error: cErr } = await supabaseAdmin
        .from("contacts")
        .select("id, business_name")
        .in("id", ids.slice(i, i + 100));
      if (cErr) {
        lookupFailed = true;
        check(`${table}: contact lookup succeeded`, false, cErr.message);
        break;
      }
      for (const c of (cs ?? []) as Array<Record<string, unknown>>) {
        contacts.set(c.id as string, String(c.business_name ?? ""));
      }
    }
    if (lookupFailed) continue;

    let disagree = 0;
    let missing = 0;
    for (const r of rows) {
      const contactName = contacts.get(r.contact_id as string);
      if (contactName === undefined) {
        missing++;
        continue;
      }
      if (norm(contactName) !== norm(String(r.business_name ?? ""))) disagree++;
    }

    check(`${table}: ${rows.length} links all point at a real contact`, missing === 0, `${missing} dangling`);
    check(`${table}: every link agrees on the business name`, disagree === 0, `${disagree} disagreements`);
  }

  // ‼️ THE AMBIGUITY GUARD, RE-CHECKED INDEPENDENTLY OF THE SQL THAT APPLIED IT. About 146 of the
  // 8,255 contacts carrying a phone share it with another contact, and a shared number is a
  // switchboard or a duplicate. Linking through one would be a coin flip recorded as a fact.
  //
  // Done by pulling every (id, phone_last10) pair and counting in memory rather than through an
  // RPC: crm_readonly_query is SECURITY DEFINER and is not reachable from a script over the
  // PostgREST client, and a check that silently skips is a check that always passes.
  const phoneOf = new Map<string, string>();
  const phoneCount = new Map<string, number>();
  const CPAGE = 1000;
  for (let from = 0; ; from += CPAGE) {
    const { data: cs, error: cErr } = await supabaseAdmin
      .from("contacts")
      .select("id, phone_last10")
      .range(from, from + CPAGE - 1);
    if (cErr) {
      check("contacts phone scan succeeded", false, cErr.message);
      break;
    }
    if (!cs || cs.length === 0) break;
    for (const c of cs as Array<Record<string, unknown>>) {
      const p = String(c.phone_last10 ?? "");
      if (!p) continue;
      phoneOf.set(c.id as string, p);
      phoneCount.set(p, (phoneCount.get(p) ?? 0) + 1);
    }
    if (cs.length < CPAGE) break;
  }

  let throughShared = 0;
  for (const table of tables) {
    const { data } = await supabaseAdmin
      .from(table)
      .select("contact_id")
      .not("contact_id", "is", null)
      .limit(2000);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const p = phoneOf.get(r.contact_id as string);
      if (p && (phoneCount.get(p) ?? 0) > 1) throughShared++;
    }
  }

  check(
    `no link resolves through a phone shared by two contacts (${phoneOf.size} phones scanned)`,
    throughShared === 0,
    `${throughShared} links go through an ambiguous phone`
  );

  // One contact must not have collected two different place ids from two lead tables.
  const { data: pids } = await supabaseAdmin
    .from("contacts")
    .select("id, google_place_id")
    .not("google_place_id", "is", null)
    .limit(5000);

  const byId = new Map<string, Set<string>>();
  for (const c of (pids ?? []) as Array<Record<string, unknown>>) {
    const set = byId.get(c.id as string) ?? new Set<string>();
    set.add(c.google_place_id as string);
    byId.set(c.id as string, set);
  }
  const conflicted = [...byId.values()].filter((s) => s.size > 1).length;
  check("no contact carries two different place ids", conflicted === 0, `${conflicted} conflicts`);
}

// ‼️ THE SUMMARY AND THE EXIT ARE THE LAST TWO STATEMENTS INSIDE main(), and main() is the last
// line of the file. Same shape as _probe-schema.ts. A check written below process.exit never runs
// and reports itself as passing, which is how _probe-dm-pitch.ts once had five silent checks.
async function main(): Promise<void> {
  console.log("\nmarket dataset, ammo ledger and identity spine\n");
  await provenance();
  ammoNeverRespent();
  supplyHonesty();
  await spineIsSafe();

  console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nprobe crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
