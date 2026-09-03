/**
 * The funnel lead's first email, and the brake on it. Renders and checks, never sends.
 *
 * ‼️ NOTHING IN HERE CALLS microsoft.sendMail. The point is to read the copy and to prove the
 * suppression fires on the clinics that already have a Loom, which is a database question. Pass
 * an address or a website to check one person.
 *
 *   bun scripts/_probe-scan-email.ts
 *   bun scripts/_probe-scan-email.ts --website=srtagency.com
 */
import { supabaseAdmin } from "../src/lib/db";
import { priorReportFor } from "../src/lib/audit-engine/prior-report";
import { scanRunningBody } from "../src/lib/audit-engine/scan-running-email";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];

async function main() {
  console.log("── The copy, as the lead receives it ──────────────────────────────");
  console.log(scanRunningBody({ name: "matthew garcia", website: "https://www.acmemedspa.com/x" }));
  console.log("──────────────────────────────────────────────────────────────────");
  console.log("no name, no website:");
  console.log(scanRunningBody({}).split("\n").slice(0, 3).join("\n"));
  console.log("");

  if (arg("website") || arg("email")) {
    const prior = await priorReportFor({ email: arg("email"), website: arg("website") });
    console.log("prior report:", prior ? JSON.stringify(prior, null, 1) : "none");
    return;
  }

  // ‼️ EVERY REPORT THAT HAS A LOOM, because those are exactly the clinics the automation must
  // stay quiet for, and a brake that does not fire on real rows is not a brake.
  const { data } = await supabaseAdmin
    .from("audit_reports")
    .select("slug, website, requester_email, loom_url, loom_state, created_at")
    .eq("status", "done")
    .not("loom_state", "is", null)
    .limit(10);

  console.log(`── ${data?.length ?? 0} finished report(s) carrying loom_state ──`);
  let suppressed = 0;
  for (const r of data ?? []) {
    const prior = await priorReportFor({
      email: r.requester_email as string | null,
      website: r.website as string | null,
    });
    const verdict = prior?.loomSent ? "SUPPRESS" : "would send";
    if (prior?.loomSent) suppressed += 1;
    console.log(
      `  ${verdict.padEnd(10)} ${String(r.website ?? r.requester_email ?? r.slug).slice(0, 44)}` +
        `  stage=${JSON.stringify((r.loom_state as { stage?: string } | null)?.stage ?? null)}`
    );
  }
  console.log(`\n${suppressed} of ${data?.length ?? 0} correctly suppressed.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
