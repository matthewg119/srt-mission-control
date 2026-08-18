/**
 * Seed a client's three DNS rows and attach their two hostnames to this Vercel project.
 *
 *   bun run scripts/hub-register.ts --client=srt-agency
 *   bun run scripts/hub-register.ts --client=srt-agency --dry
 *
 * The board's Hub panel does the same thing on a button. This exists because the FIRST
 * client has to be attached before there is a panel to press, and because a CLI run prints
 * the before/after of client_dns_records, which is the thing worth reading: it shows the
 * placeholder target being replaced by the one Vercel actually wants.
 *
 * Safe to re-run. attachHost() GETs before it POSTs, seedDnsRecords() ignores duplicates,
 * and writeCnameTarget() refuses to overwrite a row a human or the resolver has spoken about.
 */

import { supabaseAdmin } from "@/lib/db";
import { subdomainLabel } from "@/lib/clients/normalize";
import { seedDnsRecords, loadDnsRows } from "@/lib/clients/dns-records";
import { hostsFor, registerClientHosts, vercelConfig } from "@/lib/hub/vercel-domains";

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

function table(rows: Array<Record<string, unknown>>): void {
  for (const row of rows) {
    console.log(
      `    ${String(row.record_key).padEnd(14)} ${String(row.host).padEnd(9)} ` +
        `${String(row.status).padEnd(9)} ${row.value ?? "(none)"}`
    );
  }
}

async function main() {
  const which = arg("client");
  const dry = process.argv.includes("--dry");
  if (!which) {
    console.error("Usage: bun run scripts/hub-register.ts --client=<slug|uuid> [--dry]");
    process.exit(1);
  }

  const column = /^[0-9a-f-]{36}$/i.test(which) ? "id" : "slug";
  const { data: client, error } = await supabaseAdmin
    .from("clients")
    .select("id, slug, legal_name, domain, subdomain")
    .eq(column, which)
    .maybeSingle();

  if (error || !client) {
    console.error(`No client matched ${column}=${which}.`);
    process.exit(1);
  }

  const domain = client.domain as string | null;
  if (!domain) {
    console.error(`${client.slug} has no domain yet, so there is no hostname to attach.`);
    process.exit(1);
  }

  const label = subdomainLabel(client.subdomain as string | null, domain);

  console.log(`\n${client.legal_name}  (${client.slug})`);
  console.log(`  domain: ${domain}   subdomain label: ${label}\n`);

  console.log("  hostnames:");
  for (const h of hostsFor({ subdomain: client.subdomain as string | null, domain })) {
    console.log(`    ${h.kind.padEnd(8)} ${h.host}  ->  client_dns_records.${h.recordKey}`);
  }

  const cfg = vercelConfig();
  console.log(
    `\n  vercel: ${cfg ? `project ${cfg.projectId}` : "NOT CONFIGURED (HUB_VERCEL_TOKEN / HUB_VERCEL_PROJECT_ID)"}`
  );

  if (dry) {
    console.log("\n  --dry, nothing written.\n");
    return;
  }

  await seedDnsRecords(client.id as string, label);

  console.log("\n  BEFORE (after seeding, target is the hubCnameTarget() default):");
  table((await loadDnsRows(client.id as string)) as unknown as Array<Record<string, unknown>>);

  const result = await registerClientHosts(client.id as string);

  console.log("\n  vercel said:");
  for (const state of result.hosts) {
    console.log(
      `    ${state.host.padEnd(28)} attached=${state.attached} verified=${state.verified} ` +
        `misconfigured=${state.misconfigured} target=${state.target ?? "(none)"}`
    );
  }

  console.log("\n  AFTER (target read back from the Vercel API):");
  table((await loadDnsRows(client.id as string)) as unknown as Array<Record<string, unknown>>);

  if (result.warnings.length) {
    console.log("\n  warnings:");
    for (const w of result.warnings) console.log(`    - ${w}`);
  }

  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
