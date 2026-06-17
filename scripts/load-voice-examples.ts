// CLI script: one-time load of the text-voice corpus (real iMessage reply pairs
// produced by the text-voice project's extract.py) into the voice_examples table.
// These pairs teach the SMS bot Matthew's real texting voice via pg_trgm few-shot
// retrieval at draft time.
//
// The JSONL has no stable per-row key, so re-running blindly would duplicate the
// corpus. Use --truncate-imessage to wipe prior 'imessage'-source rows first.
//
// Usage:
//   bun run scripts/load-voice-examples.ts --dry
//   bun run scripts/load-voice-examples.ts
//   bun run scripts/load-voice-examples.ts --truncate-imessage
//   bun run scripts/load-voice-examples.ts --file="C:/path/to/sent_pairs.jsonl"
//
// Default file:
//   C:/Users/matth/Downloads/text-voice-data/sent_pairs.jsonl

import { readFileSync } from "node:fs";
import { supabaseAdmin } from "../src/lib/db";

const DEFAULT_FILE = "C:/Users/matth/Downloads/text-voice-data/sent_pairs.jsonl";
const TENANT_SLUG = "srt";
const BATCH_SIZE = 500;

interface Pair {
  incoming: string;
  reply: string;
  contact_hash?: string;
  ts?: string;
  char_len?: number;
}

// Mirror extract.py's tapback/reaction filter so artifacts never enter the corpus.
const REACTION_RE = /^(Liked|Loved|Laughed at|Emphasized|Questioned|Disliked) ".*"$/;

function isUsable(p: Pair): boolean {
  if (!p || typeof p.incoming !== "string" || typeof p.reply !== "string") return false;
  const inc = p.incoming.trim();
  const rep = p.reply.trim();
  if (inc.length === 0 || rep.length < 2) return false;
  if (REACTION_RE.test(rep) || REACTION_RE.test(inc)) return false;
  return true;
}

async function getTenantId(): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select("id")
    .eq("slug", TENANT_SLUG)
    .maybeSingle();
  if (error) throw new Error(`tenant lookup failed: ${error.message}`);
  if (!data) throw new Error(`tenant '${TENANT_SLUG}' not found — run the migration first`);
  return data.id as string;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry") || args.includes("--dry-run");
  const truncate = args.includes("--truncate-imessage");
  const fileArg = args.find((a) => a.startsWith("--file="));
  const file = fileArg ? fileArg.split("=").slice(1).join("=") : DEFAULT_FILE;

  console.log("Voice examples load");
  console.log("───────────────────");
  console.log(`File: ${file}`);
  console.log(`Dry run: ${dry}`);
  console.log(`Truncate prior imessage rows: ${truncate}`);
  console.log("");

  const text = readFileSync(file, "utf-8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  console.log(`Lines: ${lines.length}`);

  const rows: Pair[] = [];
  let parseErrors = 0;
  let skipped = 0;
  for (const line of lines) {
    let p: Pair;
    try {
      p = JSON.parse(line) as Pair;
    } catch {
      parseErrors++;
      continue;
    }
    if (!isUsable(p)) {
      skipped++;
      continue;
    }
    rows.push(p);
  }

  console.log(`Usable pairs: ${rows.length} (skipped ${skipped}, parse errors ${parseErrors})`);
  console.log("Sample:");
  for (const p of rows.slice(0, 3)) {
    console.log(`  in:  ${JSON.stringify(p.incoming.slice(0, 60))}`);
    console.log(`  out: ${JSON.stringify(p.reply.slice(0, 60))}`);
  }

  if (dry) {
    console.log("\nDRY RUN — no database writes.");
    return;
  }

  const tenantId = await getTenantId();

  if (truncate) {
    const { error } = await supabaseAdmin
      .from("voice_examples")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("source", "imessage");
    if (error) {
      console.error("Truncate failed:", error.message);
      process.exit(1);
    }
    console.log("Deleted prior imessage rows.");
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((p) => ({
      tenant_id: tenantId,
      source: "imessage",
      incoming: p.incoming.trim(),
      reply: p.reply.trim(),
      contact_hash: p.contact_hash ?? null,
      char_len: p.char_len ?? p.reply.trim().length,
      ts: p.ts ?? null,
    }));
    const { error } = await supabaseAdmin.from("voice_examples").insert(batch);
    if (error) {
      console.error(`Insert failed at offset ${i}:`, error.message);
      process.exit(1);
    }
    inserted += batch.length;
    console.log(`  inserted ${inserted}/${rows.length}`);
  }

  console.log("");
  console.log(`Done. Inserted ${inserted} voice examples.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
