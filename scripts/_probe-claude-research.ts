// Probe: identify a business with Claude's server-side web search.
//
//   bunx tsx --env-file=.env.local scripts/_probe-claude-research.ts "JBR CRANE SERVICES, LLC"
//   bunx tsx --env-file=.env.local scripts/_probe-claude-research.ts "Hernandez Auto Repair"
//   bunx tsx --env-file=.env.local scripts/_probe-claude-research.ts "Some Business" "Chicago, IL"
//   bunx tsx --env-file=.env.local scripts/_probe-claude-research.ts --site example.com
//
// Only ANTHROPIC_API_KEY is needed — this touches no database and writes nothing.
//
// WHAT TO CHECK, in the order that matters:
//   1. found=true, and the sources are real third-party URLs. found=true with no sources is the
//      model answering from memory and researchViaClaude is supposed to reject it outright.
//   2. The city carries a confidence, and `alternates` is populated when the name is genuinely
//      ambiguous. An ambiguous name that comes back with one confident city is the failure this
//      whole design is built to prevent — the pipeline would score the wrong business.
//   3. `websites` — whether an "it has no website" prospect turns out to have one, and whether
//      isOwnDomain() correctly separates a real site from a Facebook page.

import { researchViaClaude, isOwnDomain } from "../src/lib/audit-engine/claude-research";
import type { ResearchTarget } from "../src/lib/audit-engine/search-research";

function line(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(18)} ${value === null || value === undefined ? "—" : String(value)}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const siteMode = argv[0] === "--site";
  const args = siteMode ? argv.slice(1) : argv;

  if (args.length === 0) {
    console.error('usage: _probe-claude-research.ts "Business Name" ["City, ST"]');
    console.error("       _probe-claude-research.ts --site example.com");
    process.exit(1);
  }

  const target: ResearchTarget = siteMode
    ? { kind: "website", website: args[0] }
    : { kind: "name", name: args[0], city: args[1] };

  console.log(`\n=== researching: ${JSON.stringify(target)} ===\n`);
  const started = Date.now();
  const result = await researchViaClaude(target, null);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (!result) {
    // Not a crash. A refusal is the correct answer for a business that cannot be identified,
    // and the whole point of probing a nonexistent business is to see this branch.
    console.log(`❌ NOT IDENTIFIED after ${seconds}s — the pipeline would fail with a real reason.`);
    console.log("   (Correct for a business that does not exist. Check the log line above for which guard fired.)");
    return;
  }

  const { identity: id, research } = result;

  console.log(`✅ identified in ${seconds}s\n`);
  line("trading name", id.tradingName);
  line("what they do", id.whatTheyDo);
  line("city", [id.city, id.state].filter(Boolean).join(", ") || null);
  line("city confidence", id.cityConfidence);
  line("services", id.services.join(", ") || null);
  line("competitors", id.competitors.join(", ") || null);
  line("reviews", id.reviewsSummary);

  console.log(`\n  alternates (${id.alternates.length}):`);
  if (id.alternates.length === 0) {
    console.log("    — none, so the pipeline treats the city above as settled");
  } else {
    // The gate that makes a bare `/audit Business Name` safe. If this is populated the pipeline
    // stops and asks instead of scoring.
    for (const a of id.alternates) {
      console.log(`    • ${[a.city, a.state].filter(Boolean).join(", ")}${a.note ? ` — ${a.note}` : ""}`);
    }
    console.log("    ⚠️  ambiguous → the pipeline would ASK rather than score");
  }

  console.log(`\n  websites (${id.websites.length}):`);
  for (const w of id.websites) {
    console.log(`    • ${w}  ${isOwnDomain(w) ? "← own domain, run would upgrade to a real crawl" : "(third-party platform)"}`);
  }
  if (id.websites.length === 0) console.log("    — none found, run stays 'declared'");

  console.log(`\n  sources (${id.sources.length}):`);
  for (const s of id.sources) console.log(`    • ${s}`);

  console.log(`\n  research_source: ${research.source}`);
  console.log(`  profile text: ${research.bodyText.length} chars\n`);
  console.log("--- what classify.ts would receive ---");
  console.log(research.bodyText.slice(0, 1200));
}

main().catch((e) => {
  console.error("\n💥 probe threw:", e);
  process.exit(1);
});
