// Probe: does isOwnDomain() tell a business's own website from a profile on somebody else's
// platform? No network, no key — run it in a second.
//
//   bunx tsx scripts/_probe-own-domain.ts
//
// WHY THIS IS KEPT. The first cut of isOwnDomain was a blocklist of known platform hosts, and a
// live research run on "Hernandez Auto Repair" returned surecritic.com and carfax.com — neither
// on the list, both confidently reported as the business's own site. The pipeline upgrades a
// `declared` run to a real crawl on that verdict, so it would have fetched SureCritic and then
// reported ITS site_signals and ITS robots.txt to the prospect as facts about their business.
//
// Every URL below is one a real research call actually returned. Add to it whenever a run
// surfaces a host that fools the check.

import { isOwnDomain } from "../src/lib/audit-engine/claude-research";

const cases: Array<[url: string, businessName: string | null, expected: boolean]> = [
  // --- from the live "Hernandez Auto Repair" run -----------------------------
  ["https://hdzautorepair.com/", "Hernandez Auto Repair", true],
  ["https://www.surecritic.com/reviews/hernandez-auto-repair", "Hernandez Auto Repair", false],
  ["https://www.carfax.com/Reviews-Hernandez-Auto-Repair-Lake-Forest-CA_REYIP0QXK3", "Hernandez Auto Repair", false],
  ["https://reviews.birdeye.com/hernandez-auto-repair-156045351773844", "Hernandez Auto Repair", false],
  ["https://nextdoor.com/pages/hernandez-auto-repair-chicago-il/", "Hernandez Auto Repair", false],
  ["https://www.yelp.com/biz/hernandez-auto-repair-chicago", "Hernandez Auto Repair", false],
  ["https://www.bbb.org/us/il/chicago/profile/auto-repair/hernandez-auto-repair-0654-88362445", "Hernandez Auto Repair", false],

  // --- from the live "Katz's Delicatessen" run -------------------------------
  ["https://katzsdelicatessen.com/", "Katz's Delicatessen", true],
  ["https://www.facebook.com/katzsdeli", "Katz's Delicatessen", false],
  ["https://www.instagram.com/katzsdeli/", "Katz's Delicatessen", false],
  ["https://maps.apple.com/place?place-id=IBB4C75E7EBE40E08", "Katz's Delicatessen", false],
  ["https://www.tripadvisor.com/Restaurant_Review-g60763-d425787-Reviews-Katz_s_Deli-New_York_City_New_York.html", "Katz's Delicatessen", false],

  // --- shape handling --------------------------------------------------------
  ["https://hdz-auto-repair.com", "Hernandez Auto Repair", true], // hyphens
  ["https://www.jbrcraneservices.com", "JBR Crane Services, LLC", true], // LLC + comma stripped
  ["https://shop.katzsdelicatessen.com", "Katz's Delicatessen", true], // subdomain of theirs

  // --- refuses rather than guesses -------------------------------------------
  // No distinctive token survives the generic-word filter, so there is nothing to match on.
  // Staying `declared` is the cheap failure; crawling a stranger's site is not.
  ["https://bestlocalservices.com", "The Best Local Services", false],
  ["https://anything.com", null, false],
  ["not a url", "Hernandez Auto Repair", false],
  ["https://localhost", "Hernandez Auto Repair", false],
];

let failed = 0;
for (const [url, name, expected] of cases) {
  const got = isOwnDomain(url, name);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "  pass" : "! FAIL"}  got=${String(got).padEnd(5)} want=${String(expected).padEnd(5)} ${url}`);
}

console.log(failed === 0 ? `\n✅ all ${cases.length} cases pass` : `\n❌ ${failed}/${cases.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
