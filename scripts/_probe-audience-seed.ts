// Confirming an avatar creates the client's audience. LIVE: writes one throwaway client and deletes it.
//
//   bunx tsx --env-file=.env.local scripts/_probe-audience-seed.ts
//
// ‼️ THE REGRESSION IS SILENT AND IT WAS THE STATE OF PRODUCTION UNTIL 2026-09-15. Nothing in the
// code created a client_audiences row: seedClientAudience had no caller and SRT's row came from a
// one-time SQL backfill. The next client onboarded would have reached concierge setup, been told
// "Seed the audience first" with no command that does it, and stalled pre_call_pages behind it.
//
// WHAT IT PROVES, on a client created here and deleted at the end (never SRT):
//  1. The first confirmation creates a primary audience from the vertical's preset, keyed on the
//     avatar slug and carrying (research_vertical, research_avatar_slug) for research sharing.
//  2. A different avatar becomes primary and the first one STAYS as a non-primary option.
//  3. Re-confirming the first one promotes it back; there is still exactly one primary.
//  4. Re-confirming the current primary writes nothing new.
//  5. A vertical with no preset creates no row and says so, rather than guessing.

import { supabaseAdmin } from "../src/lib/db";
import { confirmAvatar } from "../src/lib/clients/avatars";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${!ok && detail ? `\n          ${detail}` : ""}`);
}

async function rows(clientId: string) {
  const { data } = await supabaseAdmin
    .from("client_audiences")
    .select("slug, label, is_primary, stance, research_vertical, research_avatar_slug, seeded_from, buyer_noun_singular")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function makeClient(slug: string, vertical: string | null, businessType: string | null): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({ slug, legal_name: `probe ${slug}`, vertical_slug: vertical, business_type: businessType })
    .select("id")
    .single();
  if (error || !data) throw new Error(`could not create the probe client: ${error?.message}`);
  return data.id as string;
}

async function cleanup(ids: string[]): Promise<void> {
  for (const id of ids) {
    await supabaseAdmin.from("client_avatar_runs").delete().eq("client_id", id);
    await supabaseAdmin.from("clients").delete().eq("id", id);
  }
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const created: string[] = [];

  try {
    // ── 1-4. A med spa, three confirmations ────────────────────────────────
    console.log("\n1-4. A med spa: first avatar, a change, a change back, a repeat");
    const spa = await makeClient(`probe-audience-spa-${stamp}`, "med-spa", "Med spa");
    created.push(spa);

    const first = await confirmAvatar({ clientId: spa, slot: "a1", label: "women in their 30s wanting skin rejuvenation", by: "probe" });
    let r = await rows(spa);
    check("the first confirmation succeeds", first.ok, first.error);
    check("it reports the audience it created", first.audience?.ok === true && /Audience created/.test(first.audience.note), first.audience?.note);
    check("exactly one audience row exists", r.length === 1, `got ${r.length}`);
    check("and it is primary", r[0]?.is_primary === true);
    check("keyed on the avatar slug", r[0]?.slug === "women-in-their-30s-wanting-skin-rejuvenation", String(r[0]?.slug));
    check("research key carries the vertical and the avatar", r[0]?.research_vertical === "med-spa" && r[0]?.research_avatar_slug === r[0]?.slug);
    check("seeded from the patient preset, spoken to as a patient", r[0]?.seeded_from === "med_spa_patient" && r[0]?.stance === "patient" && r[0]?.buyer_noun_singular === "patient");

    const second = await confirmAvatar({ clientId: spa, slot: "a2", label: "women over 60 wanting a lift", by: "probe" });
    r = await rows(spa);
    check("a different avatar succeeds", second.ok && second.audience?.ok === true, second.audience?.note);
    check("two audience rows now", r.length === 2, `got ${r.length}`);
    check("the new one is primary", r.find((x) => x.slug === "women-over-60-wanting-a-lift")?.is_primary === true);
    check("the first STAYS as a non-primary option", r.find((x) => x.slug === "women-in-their-30s-wanting-skin-rejuvenation")?.is_primary === false);
    check("exactly one primary", r.filter((x) => x.is_primary).length === 1);

    const back = await confirmAvatar({ clientId: spa, slot: "a1", label: "women in their 30s wanting skin rejuvenation", by: "probe" });
    r = await rows(spa);
    check("changing back promotes the existing row", back.audience?.ok === true && /now the primary audience/.test(back.audience.note), back.audience?.note);
    check("no third row was made", r.length === 2, `got ${r.length}`);
    check("still exactly one primary, and it is the first avatar",
      r.filter((x) => x.is_primary).length === 1 && r.find((x) => x.is_primary)?.slug === "women-in-their-30s-wanting-skin-rejuvenation");

    const repeat = await confirmAvatar({ clientId: spa, slot: "a1", label: "women in their 30s wanting skin rejuvenation", by: "probe" });
    r = await rows(spa);
    check("re-confirming the primary says so and writes nothing", /already this client's primary/.test(repeat.audience?.note ?? "") && r.length === 2, repeat.audience?.note);

    // ── 5. A vertical nobody has mapped ───────────────────────────────────
    console.log("\n5. An unmapped vertical creates nothing and says so");
    const odd = await makeClient(`probe-audience-odd-${stamp}`, "industrial-crane-hire", "Industrial crane hire");
    created.push(odd);
    const oddResult = await confirmAvatar({ clientId: odd, slot: "a1", label: "site managers", by: "probe" });
    const oddRows = await rows(odd);
    check("the avatar confirmation itself still succeeds", oddResult.ok, oddResult.error);
    check("no audience row is created", oddRows.length === 0, `got ${oddRows.length}`);
    check("and the card is told why", oddResult.audience?.ok === false && /No audience was created/.test(oddResult.audience.note), oddResult.audience?.note);
  } finally {
    await cleanup(created);
    const { data: left } = await supabaseAdmin.from("clients").select("id").in("id", created.length ? created : ["00000000-0000-0000-0000-000000000000"]);
    check("\n  the probe clients are gone", (left ?? []).length === 0, `${(left ?? []).length} left behind`);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
