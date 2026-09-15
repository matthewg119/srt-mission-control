// A pasted research answer is kept on the avatar, and a fragment never overwrites it. LIVE.
//
//   bunx tsx --env-file=.env.local scripts/_probe-research-paste.ts
//
// ‼️ THE BUG THIS PINS: until 2026-09-15 a `research:` paste filed its phrases and threw the rest of
// the answer away. The avatar kept whatever the automatic Haiku run had said, so the claude.com
// research Matthew actually runs never became the avatar's context.
//
// Writes one throwaway client, one throwaway avatar_briefs row, and deletes both. Against
// srt-agency-llc it only pastes a KEYWORDS block, which must leave SRT's stored research untouched.

import { supabaseAdmin } from "../src/lib/db";
import { confirmAvatar, avatarBriefFor } from "../src/lib/clients/avatars";
import { afterResearchPaste, cleanResearchForStorage } from "../src/lib/clients/research-intake";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${!ok && detail ? `\n          ${detail}` : ""}`);
}

const filler = (label: string) => `${label} `.repeat(40);
const FULL = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `## ${n}. Section ${n}\n${filler(`finding ${n}`)}`).join("\n\n");
const KEYWORDS_ONLY = "KEYWORDS\nai visibility | unknown | ready | https://a.example\naeo agency cost | 1900 | price | https://b.example";

async function main(): Promise<void> {
  const stamp = Date.now();
  const label = `probe paste avatar ${stamp}`;
  const slug = `probe-paste-avatar-${stamp}`;
  let clientId: string | null = null;

  try {
    const { data, error } = await supabaseAdmin
      .from("clients")
      .insert({ slug: `probe-paste-${stamp}`, legal_name: "probe paste", vertical_slug: "med-spa", business_type: "Med spa" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`probe client: ${error?.message}`);
    clientId = data.id as string;
    const confirmed = await confirmAvatar({ clientId, slot: "a1", label, by: "probe" });
    if (!confirmed.audience?.ok) throw new Error(`probe audience: ${confirmed.audience?.note}`);

    console.log("\n1. A full answer is saved on the avatar, read back, and reported");
    const saved = await afterResearchPaste(clientId, `research: ${FULL}`);
    const brief = await avatarBriefFor("med-spa", slug);
    check("the reply says saved", saved.some((l) => /Saved as/.test(l)), saved.join(" | "));
    const expected = cleanResearchForStorage(`research: ${FULL}`);
    check("the stored text is the pasted answer", brief?.researchText === expected, `stored ${brief?.researchText?.length ?? 0}, expected ${expected.length}`);
    check("the reply carries the completeness card", saved.some((l) => /\(primary\)/.test(l)));
    check("and the avatar line with what is missing", saved.some((l) => /\*Avatar\* \d+\/\d+/.test(l)));

    console.log("\n2. A KEYWORDS block alone keeps its phrases and leaves the avatar alone");
    const frag = await afterResearchPaste(clientId, `research: ${KEYWORDS_ONLY}`);
    const after = await avatarBriefFor("med-spa", slug);
    check("the reply says NOT saved", frag.some((l) => /Not saved as/.test(l)), frag.join(" | "));
    check("the stored research is unchanged", after?.researchText === expected);

    console.log("\n2b. Bold headings and underscored URLs survive being kept");
    const BOLD = [1, 2, 3, 4, 5]
      .map((n) => `**${n}. Section ${n}**\n${filler(`finding ${n}`)} https://example.com/some_page_${n}`)
      .join("\n\n");
    const boldReply = await afterResearchPaste(clientId, `research: ${BOLD}`);
    const boldBrief = await avatarBriefFor("med-spa", slug);
    check("a bold-headed answer is saved", boldReply.some((l) => /Saved as/.test(l)), boldReply.join(" | "));
    check("the bold headings are still in the stored text", /\*\*3\. Section 3\*\*/.test(boldBrief?.researchText ?? ""));
    check("an underscored URL is intact", (boldBrief?.researchText ?? "").includes("https://example.com/some_page_4"));

    console.log("\n3. SRT: a KEYWORDS-only paste does not touch its stored research");
    const { data: srt } = await supabaseAdmin.from("clients").select("id").eq("slug", "srt-agency-llc").maybeSingle();
    const { data: srtAud } = await supabaseAdmin
      .from("client_audiences")
      .select("research_vertical, research_avatar_slug")
      .eq("client_id", srt?.id as string)
      .eq("is_primary", true)
      .maybeSingle();
    const beforeSrt = await avatarBriefFor(srtAud?.research_vertical as string, srtAud?.research_avatar_slug as string);
    const srtReply = await afterResearchPaste(srt?.id as string, `research: ${KEYWORDS_ONLY}`);
    const afterSrt = await avatarBriefFor(srtAud?.research_vertical as string, srtAud?.research_avatar_slug as string);
    check("SRT is told the fragment was not saved", srtReply.some((l) => /Not saved as/.test(l)), srtReply.join(" | "));
    check(
      "SRT's research is byte-for-byte what it was",
      Boolean(beforeSrt?.researchText) && beforeSrt?.researchText === afterSrt?.researchText,
      `${beforeSrt?.researchText?.length} -> ${afterSrt?.researchText?.length}`
    );
  } finally {
    await supabaseAdmin.from("avatar_briefs").delete().eq("vertical", "med-spa").eq("avatar_slug", slug);
    if (clientId) {
      await supabaseAdmin.from("client_avatar_runs").delete().eq("client_id", clientId);
      await supabaseAdmin.from("clients").delete().eq("id", clientId);
    }
    const { data: leftBrief } = await supabaseAdmin.from("avatar_briefs").select("avatar_slug").eq("avatar_slug", slug);
    const { data: leftClient } = await supabaseAdmin.from("clients").select("id").eq("slug", `probe-paste-${stamp}`);
    check("\n  the probe rows are gone", !(leftBrief ?? []).length && !(leftClient ?? []).length);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
