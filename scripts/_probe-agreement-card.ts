// What the agreement_signed card says, for each of the three offers and for a client with none.
//
//   bunx tsx --env-file=.env.local scripts/_probe-agreement-card.ts [slug]
//
// It flips clients.offer_key, renders the card body, and puts the column back. No Slack call, no
// signing row, no email. Resolved by SLUG, never by a pinned id.

import { supabaseAdmin } from "../src/lib/db";
import { offerForClientCard } from "../src/lib/clients/send-agreement-card";
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
    .select("id, offer_key")
    .eq("slug", SLUG)
    .maybeSingle();
  if (!client) {
    console.log(`No client with slug "${SLUG}".`);
    process.exit(0);
  }
  const id = client.id as string;
  const original = (client.offer_key as string | null) ?? null;

  try {
    for (const offer of [null, ...OFFER_KEYS]) {
      await supabaseAdmin.from("clients").update({ offer_key: offer }).eq("id", id);
      const body = await offerForClientCard(id);
      const text = body.join("\n");
      const label = offer ?? "(no offer)";
      console.log(`\n${"=".repeat(70)}\n${label}\n${"=".repeat(70)}\n${text}\n`);

      // ‼️ A CARD BODY OVER 3,000 CHARACTERS FAILS THE WHOLE SLACK MESSAGE. bodySections() splits
      // on line boundaries, but a single LINE over the limit cannot be split and takes the card
      // with it. Checked per line as well as in total.
      check(`${label}: no single line exceeds 3000 chars`, body.every((l) => l.length < 3000));
      check(`${label}: the body is not empty`, body.length > 0);

      if (!offer) {
        check("no offer: the card refuses and says what to do", /set the offer/i.test(text));
        check("no offer: it does not name a price", !/\$/.test(text));
      } else if (!offerFor(offer).needsAgreement) {
        check("free: the card says there is no contract", /no contract/i.test(text));
        check("free: it offers no signing link", !/signing link/i.test(text));
      } else {
        const o = offerFor(offer);
        check(`${offer}: names the offer`, text.includes(o.name));
        check(`${offer}: names the price`, Boolean(o.price && text.includes(o.price)));
        check(`${offer}: offers both buttons in the copy`, /Draft the email/.test(text) && /Send signing link/.test(text));
        check(`${offer}: says what comes next`, /Next after this:/.test(text));
        if (offer === "year_3300") {
          check("yearly: the guarantee is stated", /guarantee is in this document/i.test(text));
        } else {
          check("monthly: the absence of a guarantee is stated", /no guarantee and no refund/i.test(text));
          check("monthly: no refund figure leaks in", !/\$825/.test(text));
        }
      }
    }
  } finally {
    await supabaseAdmin.from("clients").update({ offer_key: original }).eq("id", id);
    console.log(`\nOffer restored to ${original ?? "(none)"}.`);
  }

  console.log(failures ? `\n${failures} FAILED` : "\nAll clean.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
