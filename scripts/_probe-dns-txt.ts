// Probe: checkRecord, with the Search-Console-writes-its-own-TXT case.
//
//   bunx tsx --env-file=.env.local scripts/_probe-dns-txt.ts
//
// Two halves. The first is pure and offline: a fake resolver, so every branch is exercised without
// depending on what any real domain happens to be doing today. The second points the real resolver
// at srtagency.com, which has a live Search Console TXT and no hub CNAMEs, and is the case that
// motivated the change.
//
// ‼️ THE REGRESSION THIS FILE EXISTS TO CATCH IS THE CNAME ONE. Teaching the TXT path to accept a
// record it was never given the value for is correct, because Google owns the
// google-site-verification= namespace and the shape IS the evidence. Doing the same to a CNAME
// would be wrong in a way nothing else would notice: there is no correct SHAPE for a CNAME, only
// the specific per-domain target Vercel issued, so a "looks like a CNAME" check would tick green on
// a record pointing at somebody else's project. Case 5 is the one to keep.

import dns from "dns/promises";
import { checkRecord, dnsRecordByKey } from "../src/lib/clients/dns-records";

const TXT = dnsRecordByKey("txt_verify")!;
const CNAME = dnsRecordByKey("cname_hub")!;

let failures = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}`);
  if (!ok) console.log(`          want ${JSON.stringify(want)}\n          got  ${JSON.stringify(got)}`);
}

// ── A fake resolver, swapped in for the offline half ────────────────────────────────────────────
const realTxt = dns.resolveTxt;
const realCname = dns.resolveCname;

function fakeTxt(answers: string[][] | Error) {
  (dns as { resolveTxt: unknown }).resolveTxt = async () => {
    if (answers instanceof Error) throw answers;
    return answers;
  };
}
function fakeCname(answers: string[] | Error) {
  (dns as { resolveCname: unknown }).resolveCname = async () => {
    if (answers instanceof Error) throw answers;
    return answers;
  };
}

const GOOGLE = "google-site-verification=Xy7pQm2LkR8vNc0dTfA1sB4hJ6wE9zU3";

async function offline() {
  console.log("\nOFFLINE, fake resolver\n");

  // 1. The whole point. No stored value, a live google-site-verification record on the domain.
  fakeTxt([["v=spf1 include:_spf.google.com ~all"], [GOOGLE]]);
  const learned = await checkRecord(TXT, "clinic.com", null);
  check("1 no value + live google TXT -> verified", learned.status, "verified");
  check("1 and it reports what it saw back", learned.learnedValue, GOOGLE);

  // 2. ‼️ Resolves, but carries no verification record. PENDING, never mismatch: nothing was ever
  //    claimed for this row, so there is nothing for the world to disagree with.
  fakeTxt([["v=spf1 include:_spf.google.com ~all"], ["v=DMARC1; p=none"]]);
  const bare = await checkRecord(TXT, "clinic.com", null);
  check("2 no value + no verification TXT -> pending, NOT mismatch", bare.status, "pending");
  check("2 and nothing is learned", bare.learnedValue, null);

  // 3. Resolver down. not_found, which recheckDnsRecords never stores, so an outage changes nothing.
  fakeTxt(new Error("ENOTFOUND"));
  check("3 no value + resolver throws -> not_found", (await checkRecord(TXT, "clinic.com", null)).status, "not_found");

  // 4. A stored value still takes the exact-compare path, both directions.
  fakeTxt([[GOOGLE]]);
  check("4 stored value that matches -> verified", (await checkRecord(TXT, "clinic.com", GOOGLE)).status, "verified");
  check("4 stored value that does not -> mismatch", (await checkRecord(TXT, "clinic.com", "google-site-verification=nope")).status, "mismatch");

  // 5. ‼️ THE REGRESSION. A CNAME with no stored target stays pending and issues no query. It must
  //    NOT learn a target off the wire: the record below resolves perfectly and is still wrong.
  fakeCname(["some-other-project.vercel-dns-017.com"]);
  const cnameNoTarget = await checkRecord(CNAME, "learn.clinic.com", null);
  check("5 CNAME with no target -> pending", cnameNoTarget.status, "pending");
  check("5 CNAME never learns a target", cnameNoTarget.learnedValue ?? null, null);

  // 6. CNAME exact compare, unchanged, including the trailing root dot Vercel returns.
  fakeCname(["4fddd1b501fe6565.vercel-dns-017.com."]);
  check("6 CNAME matches through the root dot -> verified", (await checkRecord(CNAME, "learn.clinic.com", "4fddd1b501fe6565.vercel-dns-017.com")).status, "verified");
  check("6 CNAME pointing elsewhere -> mismatch", (await checkRecord(CNAME, "learn.clinic.com", "cname.vercel-dns.com")).status, "mismatch");

  (dns as { resolveTxt: unknown }).resolveTxt = realTxt;
  (dns as { resolveCname: unknown }).resolveCname = realCname;
}

// ── The real resolver, against SRT's own domain ─────────────────────────────────────────────────
async function live() {
  console.log("\nLIVE, real resolver, srtagency.com\n");
  const domain = "srtagency.com";

  // ‼️ A dev box frequently has NO working resolver: under a sandbox dns.getServers() reads
  // 127.0.0.1 and every query is ECONNREFUSED, which checkRecord correctly reports as not_found
  // and recheckDnsRecords correctly declines to store. That is right, and it also means this half
  // proves nothing unless we point at a resolver that answers. Production is unaffected: Vercel's
  // lambdas have a working resolver and this branch never fires there.
  try {
    await dns.resolveTxt(domain);
  } catch {
    console.log("  (local resolver is dead, falling back to 8.8.8.8 so this half means something)\n");
    dns.setServers(["8.8.8.8"]);
  }

  const txt = await checkRecord(TXT, domain, null);
  console.log(`  TXT   @            ${txt.status}${txt.learnedValue ? `  learned: ${txt.learnedValue}` : ""}`);
  console.log(`        observed:    ${txt.observed ?? "(none)"}`);

  const hub = await checkRecord(CNAME, `learn.${domain}`, "cname.vercel-dns.com");
  console.log(`  CNAME learn.       ${hub.status}`);

  console.log(
    txt.status === "verified"
      ? "\n  Expected: the TXT reads verified with no value stored. That is the whole fix."
      : "\n  NOTE: no google-site-verification TXT on this domain right now, so this half proves nothing."
  );
}

async function main() {
  await offline();
  await live();

  console.log(failures ? `\n${failures} FAILED\n` : "\nall offline checks passed\n");
  process.exit(failures ? 1 : 0);
}

main();
