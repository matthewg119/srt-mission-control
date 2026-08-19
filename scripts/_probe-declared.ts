// Probe for the no-website ("declared") classification path, WITHOUT spending an OpenAI call.
//
// researchViaSearch needs OPENAI_API_KEY to build the third-party profile. This stands in a
// hand-written profile of the shape that call returns, so classifyBusiness can be exercised for
// real against the Anthropic key: the "declared" framing, the pinned business name, the forced
// city, and — the thing most worth checking — whether the 20 questions come back free of any
// claim about a website that does not exist.
//
// Run: bunx tsx scripts/_probe-declared.ts
import { classifyBusiness } from "@/lib/audit-engine/classify";
import type { SiteResearch } from "@/lib/audit-engine/site-research";

const NAME = "Hernandez Complete Auto Repair";
const CITY = "Chicago, IL";

// Shaped exactly like search-research.ts returns on the name form.
const research: SiteResearch = {
  website: null,
  title: null,
  metaDescription: null,
  siteName: null,
  headings: [],
  pages: [],
  schemaHints: [],
  homepageHtml: "",
  source: "declared",
  blocked: null,
  bodyText: [
    `Profile of "${NAME}" in ${CITY}, assembled from third-party sources`,
    "because the business has no website of its own. Sources: google.com/maps, mapquest.com, bbb.org.",
    "",
    `1. Trading name: ${NAME} Inc.`,
    "2. Independent auto repair shop and mechanic serving retail customers.",
    "3. 3600 E 106th St, Chicago, IL 60617. Serves the Chicago south side.",
    "4. Services: routine tune-ups, oil changes, brake work, engine repair, complex engine diagnostics.",
    "5. Reviews: 4.5 stars from 28 Google reviews. Customers repeatedly mention fair pricing, fast",
    "   turnaround, and the owner explaining the work. One review calls it 'always my go to auto'.",
    "6. Local competitors appear to include other independent shops on the south side, plus chain",
    "   operations such as Midas and Firestone.",
    "Listed hours: Monday to Saturday, closes 6PM. Phone (773) 437-4341.",
    "The Google Business Profile shows no website; the knowledge panel offers 'Add website'.",
  ].join("\n"),
};

async function main() {
  const c = await classifyBusiness(research, { businessName: NAME, city: CITY });

  console.log("business_name :", c.business_name);
  console.log("business_type :", c.business_type);
  console.log("vertical_slug :", c.vertical_slug);
  console.log("is_local      :", c.is_local);
  console.log("city          :", c.city_detected, `(${c.city_confidence})`);
  console.log("buyer_persona :", c.buyer_persona);
  console.log("competitors   :", c.likely_competitors.map((x) => x.name).join(", "));
  console.log(`\nprompts (${c.prompts.length}):`);
  for (const p of c.prompts) console.log(`  [${p.block}] ${p.prompt}`);

  // The checks that matter for this feature.
  const siteWords = /\b(website|site|homepage|web page|their page|url|domain)\b/i;
  const offenders = c.prompts.filter((p) => siteWords.test(p.prompt));
  console.log("\n--- assertions ---");
  console.log("name pinned to what Matthew typed :", c.business_name.toLowerCase().includes(NAME.toLowerCase()));
  console.log("city forced high                  :", c.is_local && c.city_confidence === "high" && c.city_detected === CITY);
  console.log("exactly 20 prompts                :", c.prompts.length === 20);
  console.log("no prompt mentions a website      :", offenders.length === 0);
  if (offenders.length) console.log("  offenders:", offenders.map((o) => o.prompt));
  const branded = c.prompts.filter((p) => p.block === "MARCA");
  console.log("MARCA prompts name the business   :", branded.every((p) => /hernandez/i.test(p.prompt)));
}

main();
