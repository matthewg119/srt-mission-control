// Does the signing link actually mint against a real client?
//
//   bunx tsx --env-file=.env.local scripts/_probe-send-agreement.ts [slug]
//
// ‼️ IT RESOLVES SRT BY SLUG, NEVER BY A PINNED ID. docs/lanes/CONTRACT.md records why: SRT Agency
// was re-onboarded and a re-onboard yields a NEW id under the SAME slug, so every pinned id in
// this repo has gone stale at least once.
//
// ‼️ IT WRITES. mintSigningLink() inserts an onboarding2_signings row, because that is the thing
// being tested: a probe that mocked the insert would prove nothing about the columns. The row it
// creates is deleted at the end, and it is never signed, so nothing is provisioned and no email
// goes anywhere. The offer column it sets is restored to whatever it was.

import { supabaseAdmin } from "../src/lib/db";
import {
  loadClientForAgreement,
  mintSigningLink,
  offerOfClient,
} from "../src/lib/clients/send-agreement";
import { OFFER_KEYS, offerFor } from "../src/config/pitch";

const SLUG = process.argv[2] ?? "srt-agency-llc";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, slug, offer_key, email")
    .eq("slug", SLUG)
    .maybeSingle();

  if (!client) {
    console.log(`No client with slug "${SLUG}". Nothing to probe.`);
    process.exit(0);
  }
  const clientId = client.id as string;
  const originalOffer = (client.offer_key as string | null) ?? null;
  console.log(`Client ${clientId}  slug ${SLUG}  offer ${originalOffer ?? "(none)"}\n`);

  const created: string[] = [];

  try {
    // ── The load path, including the contacts join that clients has no columns for ──
    const loaded = await loadClientForAgreement(clientId);
    check("the client loads", Boolean(loaded), loaded ? "" : "loadClientForAgreement returned null");
    if (!loaded) return;
    console.log(
      `      legal_name  ${loaded.legal_name ?? "(none)"}\n` +
        `      email       ${loaded.email ?? "(none)"}\n` +
        `      domain      ${loaded.domain ?? "(none)"}\n` +
        `      signerName  ${loaded.signerName ?? "(none)"}`
    );

    // ── No offer means a refusal, not a guess ──
    await supabaseAdmin.from("clients").update({ offer_key: null }).eq("id", clientId);
    const noOffer = await mintSigningLink(clientId);
    check(
      "a client with no offer is refused rather than given a document",
      !noOffer.ok && Boolean(noOffer.error),
      noOffer.error ?? "it minted one anyway"
    );

    // ── The free plan has nothing to sign ──
    await supabaseAdmin.from("clients").update({ offer_key: "review_free" }).eq("id", clientId);
    const free = await mintSigningLink(clientId);
    check(
      "the free plan refuses, because there is no contract to send",
      !free.ok && Boolean(free.error),
      free.error ?? "it minted one anyway"
    );

    // ── Both paid plans mint, and mint their OWN document ──
    for (const offer of OFFER_KEYS.filter((k) => offerFor(k).needsAgreement)) {
      await supabaseAdmin.from("clients").update({ offer_key: offer }).eq("id", clientId);

      const reloaded = await loadClientForAgreement(clientId);
      check(`${offer}: offerOfClient reads it back`, offerOfClient(reloaded!) === offer);

      const minted = await mintSigningLink(clientId);
      check(`${offer}: a link is minted`, minted.ok, minted.error ?? "");
      if (!minted.ok || !minted.signingId) continue;
      created.push(minted.signingId);

      check(
        `${offer}: the URL is a /sign/ path carrying a token`,
        Boolean(minted.url && /\/sign\/[A-Za-z0-9_-]{20,}$/.test(minted.url)),
        minted.url ?? ""
      );
      check(
        `${offer}: the row is stamped with this offer's template`,
        minted.templateVersion === `v6-${offer === "year_3300" ? "yearly" : "monthly"}`,
        minted.templateVersion ?? ""
      );

      // The row itself: does it carry a real frozen document for THIS offer?
      const { data: row } = await supabaseAdmin
        .from("onboarding2_signings")
        .select("offer_key, template_version, agreement_sha256, agreement_snapshot, client_id, business_legal_name, signed_at")
        .eq("id", minted.signingId)
        .maybeSingle();

      check(`${offer}: the row exists and is unsigned`, Boolean(row) && !row!.signed_at);
      check(`${offer}: it is bound to the client`, row?.client_id === clientId);
      check(`${offer}: offer_key persisted`, row?.offer_key === offer);

      const snap = row?.agreement_snapshot as { sections?: unknown[]; preamble?: string[] } | null;
      check(`${offer}: the snapshot has clauses`, (snap?.sections?.length ?? 0) > 0,
        `${snap?.sections?.length ?? 0} sections`);

      // ‼️ THE PREAMBLE IS WHAT BINDS THE OFFER INTO THE HASH, so this is the check that matters.
      const preamble = (snap?.preamble ?? []).join(" ");
      const wantsPlan = offer === "year_3300" ? "Annual Plan" : "Month to Month Plan";
      check(
        `${offer}: the hashed preamble names the plan (${wantsPlan})`,
        preamble.includes(wantsPlan),
        preamble
      );
      check(`${offer}: a sha was stored`, /^[0-9a-f]{64}$/.test(String(row?.agreement_sha256)));
    }

    // Two mints produce two different tokens, so a re-send never collides with the first.
    const a = await mintSigningLink(clientId);
    const b = await mintSigningLink(clientId);
    if (a.signingId) created.push(a.signingId);
    if (b.signingId) created.push(b.signingId);
    check("two links are two rows with two tokens", Boolean(a.url && b.url && a.url !== b.url));
  } finally {
    // Put the client back exactly as it was and remove every row this probe made.
    await supabaseAdmin.from("clients").update({ offer_key: originalOffer }).eq("id", clientId);
    if (created.length) {
      await supabaseAdmin.from("onboarding2_signings").delete().in("id", created);
    }
    console.log(`\nCleaned up ${created.length} signing rows, offer restored to ${originalOffer ?? "(none)"}.`);
  }

  console.log(failures ? `\n${failures} FAILED` : "\nAll clean.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
