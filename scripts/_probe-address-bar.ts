/**
 * Probe: what the screenshots in a step's thread actually say. READ ONLY.
 *
 *   bunx tsx --env-file=.env.local scripts/_probe-address-bar.ts <clientId> [stepKey]
 *
 * ‼️ IT WRITES NOTHING. attributeFromScreenshot is deliberately NOT called: this answers "would
 * these resolve, and if not, why not", which is the question somebody asks when a screenshot
 * came back unattributed. Running the real path is what [Done] and [Re-check] do.
 *
 * ‼️ WITHOUT --env-file=.env.local IT SILENTLY RETURNS NOTHING. Not an error. Nothing.
 *
 * It spends one Haiku call per unattributed file, so it is pointed at one step's thread rather
 * than at a client.
 */

import { supabaseAdmin } from "../src/lib/db";
import { readAddressBar, isUsableRead } from "../src/lib/clients/screenshot-read";
import { resolvePlatformFromUrl, platformByKey } from "../src/config/presence-platforms";

const clientId = process.argv[2];
const stepKey = process.argv[3] ?? "presence_sweep_manual";

if (!clientId) {
  console.error("usage: bunx tsx --env-file=.env.local scripts/_probe-address-bar.ts <clientId> [stepKey]");
  process.exit(1);
}

async function main() {
  const { data: step } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("slack_anchor_ts")
    .eq("client_id", clientId)
    .eq("step_key", stepKey)
    .maybeSingle();

  const ts = (step?.slack_anchor_ts as string | null) ?? null;
  if (!ts) {
    console.error(`No anchor on ${stepKey} for that client, so there is no thread to read.`);
    process.exit(1);
  }

  const { data, error } = await supabaseAdmin
    .from("client_docs")
    .select("filename, content_type, storage_ref, presence_platform, presence_attributed_by")
    .eq("client_id", clientId)
    .eq("slack_thread_ts", ts)
    .order("uploaded_at", { ascending: true });

  if (error) throw new Error(error.message);

  const all = data ?? [];
  const attributed = all.filter((d) => d.presence_platform);
  const unattributed = all.filter((d) => !d.presence_platform);

  console.log(`\n${all.length} files in ${stepKey}'s thread`);
  console.log(`${attributed.length} already attributed, ${unattributed.length} not\n`);

  let resolved = 0;
  for (const d of unattributed) {
    const ref = d.storage_ref as string;
    const short = ref.split("-").pop() ?? ref;
    const dl = await supabaseAdmin.storage.from("onboarding").download(ref);
    if (dl.error || !dl.data) {
      console.log(`${short}  could not download: ${dl.error?.message}`);
      continue;
    }
    const buf = Buffer.from(await dl.data.arrayBuffer());
    const read = await readAddressBar({
      media_type: (d.content_type as string) ?? "image/png",
      data: buf.toString("base64"),
    });
    const matches = isUsableRead(read) && read.urlText ? resolvePlatformFromUrl(read.urlText) : [];

    const verdict =
      matches.length === 1
        ? `RESOLVES to ${platformByKey(matches[0])?.label}`
        : matches.length > 1
          ? `AMBIGUOUS between ${matches.join(", ")}`
          : read.urlText
            ? "NO MATCH on the platform list"
            : "NO ADDRESS BAR in the picture";

    if (matches.length === 1) resolved += 1;
    console.log(`${short}  legible=${read.legible}  ${verdict}`);
    console.log(`    url:      ${read.urlText ?? "(null)"}`);
    console.log(`    evidence: ${read.evidence}\n`);
  }

  console.log(
    `${resolved} of ${unattributed.length} unattributed screenshots resolve from their address bars with nobody typing anything.`
  );
  if (resolved < unattributed.length) {
    console.log(
      "The rest are reported as they are rather than guessed at. A screenshot cropped above the\n" +
        "browser toolbar carries no URL, and a brand mark in the page is not one: reading the\n" +
        "Google logo off a chamber-of-commerce search would file it as a Google Business Profile."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
