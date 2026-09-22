// `letter approve` judges the letter with the checker as it is NOW, not as it was when the letter
// was stored. Read-only: it approves nothing and writes nothing.
//
//   bun run --env-file=.env.local scripts/_probe-letter-approve-faults.ts [client-slug]
//
// ‼️ THE BUG THIS PINS: until 2026-09-22 the approve branch read `doc.faults` straight off the row.
// Those faults are the verdict the checker gave the day the letter was stored. srt-agency-llc's
// drafted letter carried two of them, a `dash` raised by the `---` section breaks the drafter emits
// itself and an `invented_quote` raised by a comma in `$1,500`; both were fixed in the checker the
// same morning, both fixes deployed, and `letter approve` went on refusing the stored verdict.
// Nothing else reprices that row, so a copy-rule fix could not reach a letter already written.
//
// A disagreement between the two columns below is not a failure. It is the whole point: it means the
// checker has moved since the letter was stored, and it is the FRESH column that approval now uses.

import { supabaseAdmin } from "../src/lib/db";
import { letterFaults, type LetterEvidence } from "../src/lib/clients/sales-letter";
import { clientVocQuotes } from "../src/lib/clients/client-headlines";
import { audienceFor, sharedBankFor } from "../src/lib/clients/audiences";

const slug = process.argv[2] ?? "srt-agency-llc";

async function main(): Promise<void> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, slug, services, ideal_patient")
    .eq("slug", slug)
    .maybeSingle();
  if (!client) return console.log(`  FAIL  no client with slug ${slug}`);
  const clientId = String((client as { id: string }).id);

  const { data: docs } = await supabaseAdmin
    .from("audience_documents")
    .select("id, status, source, faults, content, created_at")
    .eq("client_id", clientId)
    .eq("kind", "sales_letter")
    .order("created_at", { ascending: false })
    .limit(1);
  const doc = (docs ?? [])[0] as
    | { id: string; status: string; source: string; faults: { rule: string; detail: string }[] | null; content: string; created_at: string }
    | undefined;
  if (!doc) return console.log(`  ..    ${slug} has no sales letter yet, so there is nothing to approve.`);

  console.log(`${slug}: letter ${doc.id.slice(0, 8)}, ${doc.source}, ${doc.status}, stored ${doc.created_at}`);

  const quotes = await clientVocQuotes(clientId);
  const aud = await audienceFor(clientId);
  const bank = aud.ok ? await sharedBankFor(aud.audience) : { vocQuotes: [], approvedNumbers: [] };
  const c = client as { services?: unknown; ideal_patient?: unknown };
  const evidence: LetterEvidence = {
    numberHaystack: [
      ...bank.approvedNumbers.map((n) => n.value),
      ...quotes.map((q) => q.text),
      JSON.stringify(c.services ?? {}),
      JSON.stringify(c.ideal_patient ?? {}),
    ].join(" "),
    quotes: quotes.map((q) => q.text),
  };
  console.log(`evidence: ${quotes.length} quotes on file, ${bank.approvedNumbers.length} approved numbers\n`);

  const stored = doc.faults ?? [];
  console.log(`STORED on the row (${stored.length}):`);
  for (const f of stored) console.log(`  • ${f.rule}: ${f.detail.slice(0, 200)}`);

  const fresh = await letterFaults(doc.content, evidence);
  console.log(`\nFRESH from the checker at HEAD (${fresh.length}):`);
  for (const f of fresh) console.log(`  • ${f.rule}: ${f.detail.slice(0, 200)}`);

  const blocking = doc.source === "drafted" && fresh.length > 0;
  console.log(`\n  ${blocking ? "FAIL" : " ok "}  \`letter approve\` ${blocking ? "refuses" : "goes through"} on the fresh verdict.`);
  if (JSON.stringify(stored) !== JSON.stringify(fresh)) {
    console.log("        The two disagree, which is exactly the case the approve branch used to get wrong.");
  }
}

main().then(() => process.exit(0));
