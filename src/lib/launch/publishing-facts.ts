// What this client can publish, where it would land, and what it would be written from.
//
// ‼️ IT EXISTS BECAUSE THE CHAT WAS CONFIDENTLY WRONG ABOUT ALL THREE (2026-10-03).
// Asked to help plan the page strategy it answered: "the keyword count on file is 355, not 30",
// "there is no step 21", and "fix the two CNAMEs at GoDaddy first, then Day-0 runs, then pages
// open". Three sentences, three errors, every one of them stated as a correction.
//
// Each had the same cause: the context carried the board and nothing else, so the model filled
// the gaps from the shape of the problem rather than from the client.
//
//   - 355 is the APPROVED pool. 30 is the SELECTED pool, and selected is what pages are planned
//     from. Both numbers are real and they answer different questions, so the block below prints
//     both and says which one the pages use.
//   - The CNAMEs are not on the critical path any more. The subfolder destination serves
//     srtagency.com/learn with no DNS at all, and telling somebody to go and fix a registrar
//     record before they can publish is a day lost to a step that is already done another way.
//   - Day 0 really does block publishing, and nothing else here does. That one it had right and
//     it is worth stating plainly so it does not get softened.

import { supabaseAdmin } from "@/lib/db";
import { publishableDestinations, siteUrl } from "@/lib/hub/destinations";

export interface PublishingFacts {
  approved: number;
  selected: number;
  pages: number;
  published: number;
  evidence: number;
  day0: string | null;
  text: string;
}

async function count(table: string, clientId: string, extra?: (q: never) => never): Promise<number> {
  const { count: n } = await supabaseAdmin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  void extra;
  return n ?? 0;
}

export async function publishingFacts(clientId: string): Promise<PublishingFacts> {
  const [kw, pages, evidence, client, dests] = await Promise.all([
    supabaseAdmin
      .from("client_keywords")
      .select("phrase, category, approved, selected_at, dropped_at")
      .eq("client_id", clientId),
    supabaseAdmin.from("client_pages").select("status").eq("client_id", clientId),
    count("page_sources", clientId),
    supabaseAdmin.from("clients").select("day_0_archived_at").eq("id", clientId).maybeSingle(),
    publishableDestinations(clientId).catch(() => []),
  ]);

  const rows = (kw.data ?? []) as Record<string, unknown>[];
  const approved = rows.filter((r) => r.approved && !r.dropped_at).length;
  const selected = rows.filter((r) => r.selected_at && !r.dropped_at).length;
  const pageRows = (pages.data ?? []) as Record<string, unknown>[];
  const published = pageRows.filter((p) => p.status === "published").length;
  const day0 = (client.data?.day_0_archived_at as string | null) ?? null;

  // ‼️ THE PHRASES, NOT ONLY THE COUNT, AND THE COUNT ALONE WAS A DEAD END.
  // Asked for "the breakdown of my 30 selected keywords" the chat answered "I don't have the
  // individual keyword names in my context, only the count" and offered to hand him a prompt to
  // reconstruct them. They were thirty rows in a table it was already reading. A number is the
  // answer to "how many"; it is useless for the decision he was actually making, which was which
  // of them becomes the lead magnet.
  //
  // Grouped by category because that is the shape of the strategy: the categories ARE the
  // candidate pillars, so a flat list would hide the one structure he needs to see.
  const picked = rows.filter((r) => r.selected_at && !r.dropped_at);
  const byCategory = new Map<string, string[]>();
  for (const r of picked) {
    const k = String(r.category ?? "uncategorised");
    if (!byCategory.has(k)) byCategory.set(k, []);
    byCategory.get(k)!.push(String(r.phrase));
  }
  // ‼️ CAPPED, AND THE CAP ANNOUNCES ITSELF. Thirty phrases is nothing; three hundred would crowd
  // out the board, the documents and the DNS, and the model would start answering worse about
  // everything else. A silent truncation would be worse than the cap: it would invite a confident
  // "those are all of them" about a list that was cut.
  const KEYWORD_CAP = 120;
  const keywordLines: string[] = [];
  let shown = 0;
  for (const [cat, phrases] of [...byCategory].sort((a, b) => b[1].length - a[1].length)) {
    if (shown >= KEYWORD_CAP) break;
    const room = phrases.slice(0, Math.max(0, KEYWORD_CAP - shown));
    shown += room.length;
    keywordLines.push(`    ${cat} (${phrases.length}): ${room.join("; ")}`);
  }
  if (picked.length > shown) {
    keywordLines.push(`    ...and ${picked.length - shown} more not listed here. Say so rather than implying this is all of them.`);
  }

  const destLines = dests.length
    ? dests.map((d) => `    ${d.delivery}: ${siteUrl(d, "<slug>")}`)
    : ["    none wired, so there is nowhere to publish yet"];

  return {
    approved,
    selected,
    pages: pageRows.length,
    published,
    evidence,
    day0,
    text: [
      "PUBLISHING, AND EVERY NUMBER BELOW IS COUNTED FROM THE DATABASE:",
      "  THE TWO KEYWORD POOLS, WHICH ARE DIFFERENT QUESTIONS:",
      `    approved: ${approved}. The measurement breadth, frozen at Day 0. Nothing is published from it.`,
      `    selected: ${selected}. ‼️ THIS is what pages are planned from. Quote this one when asked how many keywords there are for pages.`,
      ...(keywordLines.length
        ? ["  THE SELECTED KEYWORDS THEMSELVES, grouped by category. You HAVE these: never say you only have a count.", ...keywordLines]
        : ["  No keywords are selected yet, so there is nothing for pages to be planned from."]),
      `  evidence on file: ${evidence} source(s) in the client library, which is what a draft argues from.`,
      `  pages: ${pageRows.length} drafted, ${published} published.`,
      "  where a published page would land:",
      ...destLines,
      dests.length > 1
        ? "    ‼️ More than one, so publishing ASKS which. Neither is a default."
        : "",
      day0
        ? `  Day 0: archived ${day0.slice(0, 10)}. The publish wall is open.`
        : "  ‼️ Day 0: NOT ARCHIVED. publishPage() refuses while this is null, and it is the ONLY thing" +
          " blocking publication. Drafting and previewing are deliberately not gated.",
      "  ‼️ DNS IS NOT ON THE PATH TO PUBLISHING when a subfolder destination is listed above: it is",
      "  served through the client's own origin and needs no registrar record. Do not send anybody to",
      "  a registrar unless the destination they chose is a subdomain.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
