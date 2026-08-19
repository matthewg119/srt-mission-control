import { researchViaSearch } from "@/lib/audit-engine/search-research";
import { classifyBusiness } from "@/lib/audit-engine/classify";

// `_probe-search.ts site.com` probes the blocked-site path.
// `_probe-search.ts "Business Name" "City, ST"` probes the no-website path.
const arg = process.argv[2];
const city = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : null;
const target = city
  ? ({ kind: "name", name: arg, city } as const)
  : ({ kind: "website", website: arg } as const);
const r = await researchViaSearch(target, city ? null : {
  reason: "blocked", status: 403, detail: "HTTP 403 Forbidden",
  checked_at: new Date().toISOString(), engines_cited_site: null,
});
if (!r) { console.log("NULL — refused to invent a business"); process.exit(0); }
console.log(`source=${r.source}  pages(citations)=${r.pages.length}`);
console.log("--- profile ---");
console.log(r.bodyText.slice(0, 900));
if (process.argv.includes("--classify")) {
  const c = await classifyBusiness(r);
  console.log("--- classification ---");
  console.log(`${c.business_name} | ${c.business_type} | local=${c.is_local} | ${c.city_detected} (${c.city_confidence})`);
  console.log(c.prompts.slice(0, 6).map((p) => `  [${p.block}] ${p.prompt}`).join("\n"));
}
