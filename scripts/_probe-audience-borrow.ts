// Borrowing an avatar another client already aims at, and the refusal that stops a page being
// written for a buyer nobody chose. LIVE: writes two throwaway clients and deletes them.
//
//   bun run scripts/_probe-audience-borrow.ts
//
// ‼️ IT NEEDS docs/2026-09-24-borrowed-audience.sql AND docs/2026-09-24-audience-on-pages.sql.
// Without the first, the insert fails the vocabulary_source CHECK; without the second, the page
// write drops its audience_id silently. Both failures are named below rather than left to read as
// a broken probe.
//
// WHAT IT PROVES, on clients created here and deleted at the end (never SRT):
//  1. A borrowed avatar lands as an OPTION, never as the primary, and the first client is untouched.
//  2. The borrowed row RESOLVES: resolve() refuses a row missing any of the six nouns, and the
//     whole reason borrowAvatar copies vocabulary instead of calling seedClientAudience is that a
//     preset may not exist for that vertical.
//  3. It says its words are borrowed, rather than claiming they came from a preset.
//  4. The shared research needs no copying: the new row carries (vertical, avatar_slug), which is
//     the key question_bank and avatar_briefs are already on.
//  5. audienceForWrite REFUSES once there are two audiences and nothing said which, and resolves
//     silently while there is only one, because one audience is not a choice.

import { supabaseAdmin } from "../src/lib/db";
import { confirmAvatar } from "../src/lib/clients/avatars";
import { audienceForWrite, audiencesFor, avatarLibrary, borrowAvatar } from "../src/lib/clients/audiences";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${!ok && detail ? `\n          ${detail}` : ""}`);
}

async function makeClient(slug: string, vertical: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({ slug, legal_name: `probe ${slug}`, vertical_slug: vertical, business_type: "Med spa" })
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
    // The client that already aims at the avatar, and the one that will borrow it.
    const owner = await makeClient(`probe-borrow-owner-${stamp}`, "med-spa");
    created.push(owner);
    const taker = await makeClient(`probe-borrow-taker-${stamp}`, "med-spa");
    created.push(taker);

    const label = `probe buyer ${stamp}`;
    const seeded = await confirmAvatar({ clientId: owner, slot: "a1", label, by: "probe" });
    check("the owning client got its audience", seeded.ok !== false, JSON.stringify(seeded).slice(0, 200));

    const ownerRows = await audiencesFor(owner);
    check("the owner has exactly one audience", ownerRows.length === 1, `got ${ownerRows.length}`);
    const slug = ownerRows[0]?.researchAvatarSlug ?? "";
    check("and it carries a research avatar slug", Boolean(slug), slug);

    // ── 1. The library finds it, and excludes what the taker already has ──
    console.log("\n1. The library");
    const lib = await avatarLibrary({ clientId: taker, vertical: "med-spa" });
    check("the taker can see the owner's avatar", lib.some((a) => a.avatarSlug === slug), lib.map((a) => a.avatarSlug).join(", "));
    const ownerLib = await avatarLibrary({ clientId: owner, vertical: "med-spa" });
    check("the owner is never offered its own", !ownerLib.some((a) => a.avatarSlug === slug));

    // ── 2. Borrowing ─────────────────────────────────────────────────────
    console.log("\n2. Borrowing adds an option and re-aims nothing");
    const got = await borrowAvatar({ clientId: taker, vertical: "med-spa", avatarSlug: slug, by: "probe" });
    check(
      "the borrow succeeded",
      got.ok,
      `${got.error ?? ""}${/vocabulary_source/.test(got.error ?? "") ? "  <- run docs/2026-09-24-borrowed-audience.sql" : ""}`
    );

    const takerRows = await audiencesFor(taker);
    check("‼️ the borrowed row RESOLVES, so every reader can use it", takerRows.length === 1, `got ${takerRows.length}`);
    check("it is NOT primary", takerRows[0]?.isPrimary === false);
    check("it carries the shared research key", takerRows[0]?.researchAvatarSlug === slug);
    check("it says its words are borrowed, not preset", takerRows[0]?.vocabularySource === "borrowed", String(takerRows[0]?.vocabularySource));
    check("the nouns actually came across", Boolean(takerRows[0]?.vocabulary.buyerSingular));
    check("the owner is untouched", (await audiencesFor(owner)).length === 1);

    const twice = await borrowAvatar({ clientId: taker, vertical: "med-spa", avatarSlug: slug, by: "probe" });
    check("borrowing the same avatar twice is refused", !twice.ok && /already has an audience/.test(twice.error ?? ""));

    // ── 3. The gate ──────────────────────────────────────────────────────
    console.log("\n3. audienceForWrite: one is not a choice, two is");
    const one = await audienceForWrite({ clientId: taker });
    check("with one audience it resolves silently", one.ok && one.audienceId === takerRows[0]?.id);

    const second = await confirmAvatar({ clientId: taker, slot: "a2", label: `other buyer ${stamp}`, by: "probe" });
    check("the taker got a second audience", second.ok !== false);
    check("and now has two", (await audiencesFor(taker)).length === 2);

    const ambiguous = await audienceForWrite({ clientId: taker });
    check("‼️ with two and no pick it REFUSES", !ambiguous.ok);
    check("  and the refusal names them", /audiences and nothing said which one/.test(ambiguous.ok ? "" : ambiguous.error));

    const picked = await audienceForWrite({ clientId: taker, audienceId: takerRows[0]!.id });
    check("naming one resolves it", picked.ok && picked.audienceId === takerRows[0]?.id);

    const foreign = await audienceForWrite({ clientId: taker, audienceId: ownerRows[0]!.id });
    check("another client's audience is refused", !foreign.ok && /different client/.test(foreign.ok ? "" : foreign.error));
  } finally {
    await cleanup(created);
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error("\nThe probe threw:", (e as Error).message);
    process.exit(1);
  });
