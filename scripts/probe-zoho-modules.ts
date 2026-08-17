// CLI script: READ-ONLY discovery of what Zoho v5 actually returns for the
// modules we are about to import. Run this BEFORE writing any mapper in
// src/lib/zoho-pull.ts.
//
// Why this exists: the exact field names on Calls and Events (and the shape of
// Owner / Who_Id / What_Id / Parent_Id / $se_module) are the highest-uncertainty
// part of the Zoho migration. Guessing them produces mappers that silently drop
// data. This prints the real keys off real records.
//
// It also answers the single most dangerous question in the project:
//   does GET /Leads without `converted=both` hide records?
// Zoho v5 defaults to converted=false, so a plain pull silently loses every
// converted lead — the entire won-business history.
//
// Usage:
//   bun run scripts/probe-zoho-modules.ts
//   bun run scripts/probe-zoho-modules.ts --module=Calls
//   bun run scripts/probe-zoho-modules.ts --samples=3
//
// Writes nothing. Makes ~8 Zoho API calls.

import { zohoRequest } from "../src/lib/zoho";

const MODULES = ["Leads", "Notes", "Calls", "Tasks", "Events"] as const;
type Module = (typeof MODULES)[number];

interface Args {
  module?: Module;
  samples: number;
}

function parseArgs(): Args {
  const out: Args = { samples: 2 };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--module=")) {
      const m = a.split("=")[1] as Module;
      if (!MODULES.includes(m)) {
        console.error(`Unknown module "${m}". One of: ${MODULES.join(", ")}`);
        process.exit(1);
      }
      out.module = m;
    } else if (a.startsWith("--samples=")) {
      out.samples = parseInt(a.split("=")[1], 10) || 2;
    }
  }
  return out;
}

type Rec = Record<string, unknown>;

/** One-line description of a value's shape, so object-vs-string is obvious. */
function shapeOf(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) {
    return v.length === 0 ? "[]" : `[${shapeOf(v[0])} × ${v.length}]`;
  }
  if (typeof v === "object") {
    const keys = Object.keys(v as Rec);
    return `{ ${keys.join(", ")} }`;
  }
  if (typeof v === "string") {
    return v.length > 60 ? `string("${v.slice(0, 57)}…")` : `string("${v}")`;
  }
  return `${typeof v}(${String(v)})`;
}

/**
 * Every api_name on a module, from its field metadata.
 *
 * Needed because Zoho v5 REQUIRES `fields` on a list GET — omitting it is a hard
 * 400 REQUIRED_PARAM_MISSING, which is what the first run of this probe hit on
 * all five modules. So "give me one page and show me every key" has to be spelled
 * out as an explicit field list, and the only honest source for that list is the
 * module's own metadata rather than a guess.
 *
 * Zoho caps `fields` at 50 names, so this returns them in chunks; the caller
 * merges the pages by record id.
 */
async function fieldNames(module: string): Promise<string[]> {
  const res = (await zohoRequest(
    "GET",
    `/settings/fields?module=${encodeURIComponent(module)}`
  )) as { fields?: Array<{ api_name?: string }> };
  return (res.fields ?? [])
    .map((f) => f.api_name)
    .filter((n): n is string => !!n);
}

const FIELD_CHUNK = 45; // under Zoho's ~50-name cap, with headroom

async function fetchPage(
  module: string,
  params: Record<string, string> = {}
): Promise<Rec[]> {
  const all = await fieldNames(module);
  if (all.length === 0) return [];

  // One request per chunk of field names, merged by id. Requesting a name the
  // module does not have is NOT an error — Zoho silently omits it — so this is
  // safe even if the metadata and the records disagree.
  const chunks: string[][] = [];
  for (let i = 0; i < all.length; i += FIELD_CHUNK) {
    chunks.push(all.slice(i, i + FIELD_CHUNK));
  }

  const merged = new Map<string, Rec>();
  for (const chunk of chunks) {
    const qs = new URLSearchParams({
      per_page: "20",
      fields: chunk.join(","),
      ...params,
    }).toString();
    const res = (await zohoRequest("GET", `/${module}?${qs}`)) as { data?: Rec[] };
    for (const rec of res.data ?? []) {
      const id = String(rec.id ?? "");
      if (!id) continue;
      merged.set(id, { ...(merged.get(id) ?? {}), ...rec });
    }
  }
  return [...merged.values()];
}

/** Union of keys across a page, with the shape of the first non-null value. */
function describeKeys(records: Rec[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of records) {
    for (const [k, v] of Object.entries(r)) {
      if (!out.has(k) || out.get(k) === "null") out.set(k, shapeOf(v));
    }
  }
  return new Map([...out.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

/** The link fields the activity mappers depend on. Called out separately. */
const LINK_FIELDS = [
  "Who_Id",
  "What_Id",
  "Parent_Id",
  "$se_module",
  "se_module",
  "Owner",
  "id",
  "Created_Time",
  "Modified_Time",
];

async function probeModule(module: Module, samples: number) {
  console.log("");
  console.log("═".repeat(70));
  console.log(`  ${module}`);
  console.log("═".repeat(70));

  let records: Rec[];
  try {
    // Leads needs converted=both or the sample is unrepresentative in the
    // exact way that would hide the bug we're checking for.
    records = await fetchPage(
      module,
      module === "Leads" ? { converted: "both" } : {}
    );
  } catch (e) {
    console.log(`  ✗ FAILED: ${(e as Error).message.slice(0, 300)}`);
    console.log(`    (module may not be enabled on this Zoho plan)`);
    return;
  }

  if (records.length === 0) {
    console.log("  (no records returned — module is empty or inaccessible)");
    return;
  }

  console.log(`  ${records.length} records in the sample page.`);
  console.log("");
  console.log("  ── Link fields (what the activity mappers join on) ──");
  for (const f of LINK_FIELDS) {
    const withField = records.find((r) => r[f] !== undefined && r[f] !== null);
    if (withField) {
      console.log(`    ${f.padEnd(16)} ${shapeOf(withField[f])}`);
    } else if (records.some((r) => f in r)) {
      console.log(`    ${f.padEnd(16)} present but null in all ${records.length}`);
    }
  }

  console.log("");
  console.log("  ── All returned keys ──");
  const keys = describeKeys(records);
  for (const [k, shape] of keys) {
    if (LINK_FIELDS.includes(k)) continue;
    console.log(`    ${k.padEnd(32)} ${shape}`);
  }

  console.log("");
  console.log(`  ── ${Math.min(samples, records.length)} full sample record(s) ──`);
  for (const r of records.slice(0, samples)) {
    console.log(`    ${JSON.stringify(r).slice(0, 1200)}`);
    console.log("");
  }

  // se_module distribution matters for Notes: notes hang off Leads, Deals,
  // Contacts and Accounts, and a mapper that ignores this attaches Deal notes
  // to the wrong contact.
  if (module === "Notes") {
    const dist = new Map<string, number>();
    for (const r of records) {
      const m = String(r["$se_module"] ?? r["se_module"] ?? "unknown");
      dist.set(m, (dist.get(m) ?? 0) + 1);
    }
    console.log("  ── Notes se_module distribution (sample page) ──");
    for (const [m, n] of dist) console.log(`    ${m.padEnd(16)} ${n}`);
  }
}

/**
 * The converted-lead check. This is the highest-risk item in the migration:
 * if these counts differ, a pull without `converted=both` silently loses the
 * difference — every lead that ever became a deal.
 */
async function probeConvertedGap() {
  console.log("");
  console.log("═".repeat(70));
  console.log("  CONVERTED-LEAD CHECK  (the one that can silently lose data)");
  console.log("═".repeat(70));

  async function countLeads(params: Record<string, string>): Promise<number | null> {
    try {
      const qs = new URLSearchParams(params).toString();
      const res = (await zohoRequest("GET", `/Leads/actions/count?${qs}`)) as {
        count?: number | string;
      };
      if (res?.count === undefined) return null;
      return typeof res.count === "string" ? parseInt(res.count, 10) : res.count;
    } catch {
      return null;
    }
  }

  const [dflt, both] = await Promise.all([
    countLeads({}),
    countLeads({ converted: "both" }),
  ]);

  if (dflt === null || both === null) {
    console.log("  /Leads/actions/count unavailable on this plan.");
    console.log("  Fall back to comparing these two in the Zoho UI:");
    console.log("    - All Leads view total");
    console.log("    - Converted Leads view total");
    console.log("  The pull MUST use converted=both regardless.");
    return;
  }

  console.log(`  default (converted=false):  ${dflt}`);
  console.log(`  converted=both:             ${both}`);
  console.log(`  hidden without the param:   ${both - dflt}`);
  if (both > dflt) {
    console.log("");
    console.log(`  ⚠  ${both - dflt} converted leads would be LOST by a default pull.`);
    console.log("     src/lib/zoho-pull.ts must pass extraParams: { converted: 'both' }.");
  } else {
    console.log("  ✓ no gap in this org — still pass converted=both defensively.");
  }
}

/** Zoho v5 caps the `fields` param around 50 names. Find the real limit. */
async function probeFieldCap() {
  console.log("");
  console.log("═".repeat(70));
  console.log("  LEADS FIELD METADATA");
  console.log("═".repeat(70));
  try {
    const res = (await zohoRequest("GET", "/settings/fields?module=Leads")) as {
      fields?: Array<{ api_name?: string; data_type?: string; field_label?: string }>;
    };
    const fields = res.fields ?? [];
    console.log(`  ${fields.length} fields on the Leads module.`);
    if (fields.length > 50) {
      console.log(`  ⚠  Over the ~50-name cap on the \`fields\` query param.`);
      console.log(`     The Leads pull needs two passes merged by id.`);
    }
    console.log("");
    console.log("  api_name — data_type");
    for (const f of fields) {
      console.log(`    ${(f.api_name ?? "?").padEnd(34)} ${f.data_type ?? "?"}`);
    }
  } catch (e) {
    console.log(`  ✗ /settings/fields failed: ${(e as Error).message.slice(0, 200)}`);
  }
}

async function main() {
  const opts = parseArgs();

  console.log("Zoho Module Probe (read-only)");
  console.log("─────────────────────────────");

  const modules = opts.module ? [opts.module] : [...MODULES];
  for (const m of modules) {
    await probeModule(m, opts.samples);
  }

  if (!opts.module || opts.module === "Leads") {
    await probeConvertedGap();
    await probeFieldCap();
  }

  console.log("");
  console.log("Done. Write the mappers in src/lib/zoho-pull.ts against THIS output.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
