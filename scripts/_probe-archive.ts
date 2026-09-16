// Archive, delete and re-onboard one THROWAWAY client, end to end. LIVE database, no Slack, no email.
//
//   bun run --env-file=.env.local scripts/_probe-archive.ts
//
// Proves on real tables what the unit tests cannot: the snapshot reads back whole, the delete refuses without
// an archive, the import restores the audience, the offer AS A PROPOSAL, the framework documents and the
// evidence into a new client, and an archive imports once. Every row it writes is deleted at the end.

import { supabaseAdmin } from "../src/lib/db";
import { archiveClient, deleteArchivedClient, findDuplicates, importFromArchive } from "../src/lib/clients/archive";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${!ok && detail ? `\n          ${detail}` : ""}`);
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const site = `probe-archive-${stamp}.example`;
  const made: string[] = [];
  let archiveId: string | null = null;

  const newClient = async (slug: string, legal: string) => {
    const { data, error } = await supabaseAdmin
      .from("clients")
      .insert({ slug, legal_name: legal, email: `owner@${site}`, website: `https://${site}`, domain: site, vertical_slug: "med-spa", business_type: "Med spa" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`probe client: ${error?.message}`);
    made.push(data.id as string);
    return data.id as string;
  };

  try {
    console.log("\n1. A client with an audience, a locked offer, a letter, beliefs and evidence");
    const oldId = await newClient(`probe-archive-${stamp}`, "Probe Archive Aesthetics LLC");
    await supabaseAdmin.from("clients").update({ city: "Greensboro", services: ["Botox", "Filler"] }).eq("id", oldId);
    const { data: aud } = await supabaseAdmin
      .from("client_audiences")
      .insert({ client_id: oldId, slug: "med-spa-patient", label: "med spa patient", stance: "patient", research_vertical: "med-spa", is_primary: true })
      .select("id")
      .single();
    const { data: offer } = await supabaseAdmin
      .from("client_offers")
      .insert({ client_id: oldId, audience_id: aud!.id, is_primary: true, treatment: "Lip filler", locked_at: new Date().toISOString(), locked_by: "probe", terms: ["lip flip"], outcome_promise: "more appointments" })
      .select("id")
      .single();
    // One insert per row, each checked: a bulk insert with different columns per row sends null for the
    // missing ones, and null is not the column default.
    const must = (label: string, r: { error: { message: string } | null }) => {
      if (r.error) throw new Error(`${label}: ${r.error.message}`);
    };
    must("letter", await supabaseAdmin.from("audience_documents").insert({ client_id: oldId, audience_id: aud!.id, offer_id: offer!.id, kind: "sales_letter", content: "letter", source: "pasted", status: "approved", approved_at: new Date().toISOString(), offer_fingerprint: "x" }));
    must("beliefs", await supabaseAdmin.from("audience_documents").insert({ client_id: oldId, audience_id: aud!.id, offer_id: offer!.id, kind: "necessary_beliefs", content: "I believe that x", parsed: { beliefs: [{ id: "B1", text: "I believe that x" }] }, source: "pasted" }));
    must("evidence", await supabaseAdmin.from("page_sources").insert({ client_id: oldId, source_type: "CLIENT_VOICE", source_content: "We started in 2019.", collected_by: "probe" }));

    console.log("\n2. The delete refuses without an archive of exactly this client");
    const refused = await deleteArchivedClient({ clientId: oldId, archiveId: "00000000-0000-0000-0000-000000000000" });
    check("no archive, no delete", !refused.ok);

    console.log("\n3. Archive, then delete");
    const archived = await archiveClient({ clientId: oldId, by: "probe", reason: "probe" });
    check("the archive is written and reads back whole", archived.ok, archived.ok ? "" : archived.error);
    if (!archived.ok) return;
    archiveId = archived.archiveId;
    check("it holds the offer, the audience, both documents and the evidence",
      archived.counts.client_offers === 1 && archived.counts.client_audiences === 1 && archived.counts.audience_documents === 2 && archived.counts.page_sources === 1,
      JSON.stringify(archived.counts));
    const deleted = await deleteArchivedClient({ clientId: oldId, archiveId });
    check("the client is deleted", deleted.ok, deleted.ok ? "" : deleted.error);
    made.splice(made.indexOf(oldId), 1);

    console.log("\n4. A new onboarding of the same business is caught");
    const matches = await findDuplicates({ legalName: "Probe Archive Aesthetics", website: site, email: `owner@${site}` });
    const hit = matches.find((m) => m.kind === "archive" && m.id === archiveId);
    check("the archive matches on the website, the email and the name", Boolean(hit) && hit!.reasons.length === 3, JSON.stringify(matches));
    check("and says what an import brings back", /Lip filler/.test(hit?.carries ?? ""), hit?.carries ?? "");

    console.log("\n5. Import into the new client");
    const newId = await newClient(`probe-archive-${stamp}-2`, `owner@${site}`);
    const imported = await importFromArchive({ archiveId, clientId: newId, by: "probe" });
    check("the import runs clean", imported.ok && !imported.lines.some((l) => /^Not imported/.test(l)), JSON.stringify(imported));
    const { data: c } = await supabaseAdmin.from("clients").select("legal_name, city, services, offer").eq("id", newId).single();
    check("the placeholder name and the intake come back", c?.legal_name === "Probe Archive Aesthetics LLC" && c?.city === "Greensboro" && (c?.services as string[])?.length === 2);
    const { data: offers } = await supabaseAdmin.from("client_offers").select("*").eq("client_id", newId);
    const o = offers?.[0];
    check("the offer comes back as a proposal, not a lock", o?.proposed_treatment === "Lip filler" && o?.treatment === null && o?.locked_at === null, JSON.stringify(o));
    check("with its terms and outcome", o?.terms?.[0] === "lip flip" && o?.outcome_promise === "more appointments");
    check("and the deprecated mirror agrees", (c?.offer as Record<string, unknown>)?.proposedTreatment === "Lip filler" && (c?.offer as Record<string, unknown>)?.lockedAt === null);
    const { data: docs } = await supabaseAdmin.from("audience_documents").select("kind, status, offer_id").eq("client_id", newId);
    check("both documents come back under the new offer", (docs ?? []).length === 2 && (docs ?? []).every((d) => d.offer_id === o?.id));
    check("the sales letter needs approving again", docs?.find((d) => d.kind === "sales_letter")?.status === "draft");
    const { count } = await supabaseAdmin.from("page_sources").select("id", { count: "exact", head: true }).eq("client_id", newId);
    check("the evidence comes back", count === 1);

    console.log("\n6. Once, ever");
    const again = await importFromArchive({ archiveId, clientId: newId, by: "probe" });
    check("a second import is refused", !again.ok);
    check("and an imported archive stops matching", !(await findDuplicates({ website: site })).some((m) => m.kind === "archive"));
  } finally {
    for (const id of made) await supabaseAdmin.from("clients").delete().eq("id", id);
    // By domain, not only by id: an archive that failed its read-back returned no id but was still written.
    await supabaseAdmin.from("client_archives").delete().eq("domain", site);
    if (archiveId) await supabaseAdmin.from("client_archives").delete().eq("id", archiveId);
    const { data: left } = await supabaseAdmin.from("clients").select("id").ilike("slug", `probe-archive-${stamp}%`);
    const { data: leftArchive } = await supabaseAdmin.from("client_archives").select("id").eq("domain", site);
    check("\n  the probe rows are gone", !(left ?? []).length && !(leftArchive ?? []).length);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
