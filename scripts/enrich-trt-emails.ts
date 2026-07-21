// Standalone email backfill for trt_leads. Crawls each clinic's website
// (homepage + contact/about paths) for a published email, writes it to
// Supabase, and optionally onto the existing Zoho lead's Email field.
// Free — plain fetch + regex, no paid enrichment. Rows are stamped
// email_checked_at on every attempt so no-result sites aren't re-crawled.
//
//   bun run trt:emails -- --dry-run --limit 10   # preview picks, write nothing
//   bun run trt:emails                            # up to 500 unchecked rows
//   bun run trt:emails -- --push-zoho             # also update Zoho Email
//
// (Future: a --recheck-days N flag could re-scan stale misses via
//  email_checked_at < cutoff; not built yet.)

import { supabaseAdmin } from "@/lib/db";
import { enrichEmails } from "@/lib/email-scrape";
import { updateLead } from "@/lib/zoho";

const argv = process.argv.slice(2);
const li = argv.indexOf("--limit");
const LIMIT = li >= 0 && argv[li + 1] ? Number(argv[li + 1]) : 500;
const DRY_RUN = argv.includes("--dry-run");
const PUSH_ZOHO = argv.includes("--push-zoho");

interface Row {
  id: string;
  business_name: string;
  website: string | null;
  email: string | null;
  email_source?: string | null;
  zoho_lead_id: string | null;
}

async function main() {
  console.log(`📧 TRT email backfill — up to ${LIMIT} unchecked rows${DRY_RUN ? " (DRY RUN)" : ""}…`);
  const { data, error } = await supabaseAdmin
    .from("trt_leads")
    .select("id, business_name, website, email, zoho_lead_id")
    .is("email", null)
    .not("website", "is", null)
    .is("email_checked_at", null)
    .limit(LIMIT);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Row[];
  console.log(`   ${rows.length} candidates with a website.`);
  if (!rows.length) return;

  const { found, scanned } = await enrichEmails(rows, {
    onProgress: (d, t) => process.stdout.write(`\r   scraping… ${d}/${t}   `),
  });
  process.stdout.write("\n");

  const hits = scanned.filter((r) => r.email);
  const webmail = hits.filter((r) => /@(gmail|yahoo|outlook|hotmail|aol|icloud|proton)/i.test(r.email!)).length;

  if (DRY_RUN) {
    console.log(`   emails found: ${found}/${scanned.length}\n`);
    for (const r of hits) {
      console.log(`   ${r.business_name.padEnd(40).slice(0, 40)} | ${(r.website || "").slice(0, 40).padEnd(40)} | ${r.email} | ${r.email_source}`);
    }
    console.log(`\n   misses: ${scanned.length - found}. Dry run — nothing written.`);
    return;
  }

  // Sequential, checked write-backs (an unbounded Promise.all here silently
  // dropped updates in the Zoho sync path before — see trt-zoho-sync.ts).
  const nowIso = new Date().toISOString();
  let updated = 0;
  let updateFailed = 0;
  for (const r of scanned) {
    const patch: Record<string, unknown> = { email_checked_at: nowIso };
    if (r.email) {
      patch.email = r.email;
      patch.email_source = r.email_source;
    }
    const { error: upErr } = await supabaseAdmin.from("trt_leads").update(patch).eq("id", r.id);
    if (upErr) {
      updateFailed++;
      if (updateFailed <= 3) console.error(`   ⚠️ supabase update failed for ${r.business_name}: ${upErr.message}`);
    } else {
      updated++;
    }
  }

  let zohoOk = 0;
  let zohoFailed = 0;
  if (PUSH_ZOHO) {
    const pushable = hits.filter((r) => r.zoho_lead_id);
    console.log(`   pushing Email to ${pushable.length} Zoho leads…`);
    for (const r of pushable) {
      try {
        await updateLead(r.zoho_lead_id as string, { Email: (r.email as string).slice(0, 100) });
        zohoOk++;
      } catch (err) {
        zohoFailed++; // converted/deleted leads throw — count, don't abort
        if (zohoFailed <= 3) {
          console.error(`   ⚠️ Zoho update failed for ${r.business_name}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  }

  console.log(
    `   ✅ scanned ${scanned.length} | found ${found} (webmail ${webmail}) | none ${scanned.length - found} | ` +
    `supabase ${updated} ok${updateFailed ? `, ${updateFailed} failed` : ""}` +
    (PUSH_ZOHO ? ` | zoho ${zohoOk} ok, ${zohoFailed} failed` : "")
  );
}

main().catch((err) => {
  console.error("❌ trt:emails failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
