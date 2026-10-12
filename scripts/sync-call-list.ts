/**
 * Reconcile every pulled call-route lead against the CRM, across every run.
 *
 *   bun run scripts/sync-call-list.ts --dry
 *   bun run scripts/sync-call-list.ts
 *   bun run scripts/sync-call-list.ts --vertical=medspa --phoned-only
 *
 * ‼️ THIS IS NOT scripts/backfill-call-list.ts AND IT DOES NOT REPLACE IT. That script walks RUNS
 * and calls recordCallList on each, which is the right shape for "catch the book up to the runs
 * that finished before the wire existed". This asks a different question: is any lead on the call
 * route missing from the CRM RIGHT NOW, whatever run it came from and whenever its route was
 * decided. The gap between those two is a lead parked as unjudged when its run finished and
 * re-qualified on a later tick, which nothing else ever looks at again.
 *
 * ‼️ IDEMPOTENT, AND THAT IS WHAT LETS THE CRON RUN IT. Every insert is deduped against `contacts`
 * on both `google_place_id` and `phone_last10`, and within the batch itself. Running it twice adds
 * nothing the first run did not.
 *
 * ‼️ AND IT WRITES UN-PHONED ROWS BY DEFAULT, WHICH IS A REVERSAL WORTH SAYING OUT LOUD.
 * recordCallList refuses a lead with no usable phone, and its header gives a good reason: "a
 * spreadsheet can carry a row somebody has to research; a CALL LIST cannot, and 53 un-dialable
 * contacts on the board is how a board stops being read". Matthew asked on 2026-10-09 for every
 * website-less business from the pulls to BE in the book, so the sweep writes them and their
 * `next_action_reason` opens with "NO PHONE on the row, look it up". `--phoned-only` restores the
 * older rule.
 */

import { sweepCallListGap } from "@/lib/scraper/listprep";
import { crmSourceFor, verticalSlugs } from "@/lib/scraper/verticals";
import { supabaseAdmin } from "@/lib/db";

const args = process.argv.slice(2);
const dry = args.includes("--dry") || args.includes("--dry-run");
const phonedOnly = args.includes("--phoned-only");
const askedVertical = args.find((a) => a.startsWith("--vertical="))?.split("=")[1];

const verticals = askedVertical ? [askedVertical] : verticalSlugs();

async function countWhere(
  apply: (q: ReturnType<typeof base>) => ReturnType<typeof base>
): Promise<number> {
  const { count, error } = await apply(base());
  if (error) throw new Error(error.message);
  return count ?? 0;
}
function base() {
  return supabaseAdmin.from("raw_leads").select("id", { count: "exact", head: true });
}

async function main(): Promise<void> {
  console.log("");
  console.log(dry ? "DRY RUN: nothing will be written." : "Writing missing leads into contacts.");
  console.log("");

  for (const vertical of verticals) {
    const source = crmSourceFor(vertical);
    const onRoute = await countWhere((q) => q.eq("vertical_slug", vertical).eq("route", "call"));
    const noSite = await countWhere((q) =>
      q.eq("vertical_slug", vertical).eq("route", "call").or("website.is.null,website.eq.")
    );
    const { count: inCrm } = source
      ? await supabaseAdmin.from("contacts").select("id", { count: "exact", head: true }).eq("source", source)
      : { count: 0 };

    console.log(vertical + "  (" + (source ?? "NO CRM SOURCE REGISTERED") + ")");
    console.log("  on the call route      " + onRoute);
    console.log("  of those, no website   " + noSite);
    console.log("  in the CRM today       " + (inCrm ?? 0));

    if (dry) {
      console.log("  --dry, so nothing was written.");
      console.log("");
      continue;
    }

    const res = await sweepCallListGap(vertical, { includeUnphoned: !phonedOnly });
    if (res.error) {
      console.log("  ERROR  " + res.error);
      console.log("");
      continue;
    }
    console.log("  scanned                " + res.scanned);
    console.log("  ADDED                  " + res.added);
    console.log("  already in the CRM     " + res.alreadyKnown);
    console.log("  no phone on the row    " + res.noPhone + (phonedOnly ? "  (skipped)" : "  (written, reason says so)"));

    const { count: after } = source
      ? await supabaseAdmin.from("contacts").select("id", { count: "exact", head: true }).eq("source", source)
      : { count: 0 };
    console.log("  in the CRM now         " + (after ?? 0));
    console.log("");
  }

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
