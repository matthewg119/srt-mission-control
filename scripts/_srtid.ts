// Resolve SRT Agency by SLUG, never by a pinned id.
//
// docs/lanes/CONTRACT.md:17-21: the client has been re-onboarded twice, clients.slug is the
// unique provisioning claim, and every id written down in this repo for it is dead.
//
//   bunx tsx --env-file=.env.local scripts/_srtid.ts [slug]
import { supabaseAdmin } from "@/lib/db";

async function main() {
  const slug = process.argv[2] ?? "srt-agency-llc";
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, slug")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error(`query failed: ${error.message}`);
    process.exit(1);
  }
  if (!data) {
    console.error(`no client with slug ${slug}`);
    process.exit(1);
  }
  console.log(`${data.id}\t${data.legal_name}`);
}

main();

export {};
