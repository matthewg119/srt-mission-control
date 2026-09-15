// The Loom pick reaches the client: the avatar step offers the frozen menu, pick marked. LIVE.
//
//   bunx tsx --env-file=.env.local scripts/_probe-loom-candidates.ts
//
// ‼️ WHAT THIS PINS. Matthew, 2026-09-15: the avatar picked for a prospect's Loom must be "connected
// to that customer so we know that's the preferred avatar or at least one of the options". Before
// this, the pick lived only as an index on the audit, and the avatar step re-read niche_briefs, which
// is regenerated every 30 days and may no longer contain the customer the prospect was pitched.
//
// Writes one throwaway client and one throwaway audit_reports row linked to it; deletes both.

import { supabaseAdmin } from "../src/lib/db";
import { avatarCandidatesFor, confirmAvatar } from "../src/lib/clients/avatars";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${!ok && detail ? `\n          ${detail}` : ""}`);
}

const best = [
  { label: "Botox membership regulars", ticket: "$400 a visit, every 3 months", whyHighRoi: "recurring", aiQuestion: "best botox membership near me" },
  { label: "Bridal skin prep", ticket: "$1,800 package", whyHighRoi: "one decision maker", aiQuestion: "skin prep before wedding" },
  { label: "Laser hair removal packages", ticket: "$2,400 for six sessions", whyHighRoi: "prepaid", aiQuestion: "laser hair removal cost" },
];

async function main(): Promise<void> {
  const stamp = Date.now();
  let clientId: string | null = null;
  let auditId: string | null = null;

  try {
    const { data: c, error: ce } = await supabaseAdmin
      .from("clients")
      .insert({ slug: `probe-loom-${stamp}`, legal_name: "probe loom", vertical_slug: "med-spa", business_type: "Med spa" })
      .select("id")
      .single();
    if (ce || !c) throw new Error(`probe client: ${ce?.message}`);
    clientId = c.id as string;

    console.log("\n1. With no Loom on a linked audit, the niche ladder still answers");
    const before = await avatarCandidatesFor(clientId);
    check("not a loom_pick menu", before.matchedBy !== "loom_pick", before.matchedBy);

    const { data: a, error: ae } = await supabaseAdmin
      .from("audit_reports")
      .insert({
        slug: `probe-loom-${stamp}`,
        client_id: clientId,
        status: "done",
        loom_state: {
          stage: "done",
          avatarIndex: 2,
          pickedAvatar: { ...best[1], index: 2, nicheKey: "med-spa", pickedAt: new Date().toISOString() },
          picks: [
            { ...best[0], index: 1, nicheKey: "med-spa", pickedAt: new Date().toISOString() },
            { ...best[1], index: 2, nicheKey: "med-spa", pickedAt: new Date().toISOString() },
          ],
          buyerMap: { best, worst: [], recommended: 1, recommendedWhy: "recurring", isReposition: false, nicheKey: "med-spa", capturedAt: new Date().toISOString() },
        },
      })
      .select("id")
      .single();
    if (ae || !a) throw new Error(`probe audit: ${ae?.message}`);
    auditId = a.id as string;

    console.log("\n2. A linked audit with a Loom: the frozen menu, the pick marked");
    const found = await avatarCandidatesFor(clientId);
    check("the menu came from the Loom", found.matchedBy === "loom_pick", found.matchedBy);
    check("the three frozen customers, in order", found.candidates.map((x) => x.label).join("|") === best.map((b) => b.label).join("|"));
    check("the Loom's customer is marked picked", found.candidates[1]?.loomPick === "picked", String(found.candidates[1]?.loomPick));
    check("the one moved off is marked considered", found.candidates[0]?.loomPick === "considered", String(found.candidates[0]?.loomPick));
    check("the untouched one is unmarked", !found.candidates[2]?.loomPick);
    check("the AI question is carried", found.candidates[1]?.aiQuestion === "skin prep before wedding");

    console.log("\n3. Confirming the Loom's customer makes it this client's primary audience");
    const res = await confirmAvatar({ clientId, slot: "a2", label: found.candidates[1].label, by: "probe" });
    const { data: aud } = await supabaseAdmin
      .from("client_audiences")
      .select("slug, is_primary")
      .eq("client_id", clientId);
    check("confirmed", res.ok && res.audience?.ok === true, res.audience?.note);
    check("the audience is the Loom's customer, primary", (aud ?? []).some((r) => r.slug === "bridal-skin-prep" && r.is_primary));
  } finally {
    if (auditId) await supabaseAdmin.from("audit_reports").delete().eq("id", auditId);
    if (clientId) {
      await supabaseAdmin.from("client_avatar_runs").delete().eq("client_id", clientId);
      await supabaseAdmin.from("clients").delete().eq("id", clientId);
    }
    const { data: left } = await supabaseAdmin.from("clients").select("id").eq("slug", `probe-loom-${stamp}`);
    const { data: leftA } = await supabaseAdmin.from("audit_reports").select("id").eq("slug", `probe-loom-${stamp}`);
    check("\n  the probe rows are gone", !(left ?? []).length && !(leftA ?? []).length);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
