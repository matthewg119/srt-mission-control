import { researchViaSearch } from "@/lib/audit-engine/search-research";
import { classifyBusiness } from "@/lib/audit-engine/classify";

const url = process.argv[2];
const r = await researchViaSearch(url, {
  reason: "blocked", status: 403, detail: "HTTP 403 Forbidden",
  checked_at: new Date().toISOString(), engines_cited_site: null,
});
if (!r) { console.log("NULL — refused to invent a business"); process.exit(0); }
console.log(`source=${r.source}  pages(citations)=${r.pages.length}`);
console.log("--- profile ---");
console.log(r.bodyText.slice(0, 900));
if (process.argv[3] === "--classify") {
  const c = await classifyBusiness(r);
  console.log("--- classification ---");
  console.log(`${c.business_name} | ${c.business_type} | local=${c.is_local} | ${c.city_detected} (${c.city_confidence})`);
  console.log(c.prompts.slice(0, 6).map((p) => `  [${p.block}] ${p.prompt}`).join("\n"));
}
