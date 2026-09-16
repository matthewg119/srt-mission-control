// The FAQ key model, offline. Extracted from _probe-onboarding2-chat.ts so it runs with no env,
// no network and no model: the checks below are pure functions of two config files.
import { CHAT_FAQS } from "../src/config/onboarding2";
import { agreementFor } from "../src/config/onboarding2-agreement";
import { OFFER_KEYS } from "../src/config/pitch";
import { faqsFor } from "../src/lib/onboarding2/chat";
import { buildSnapshot } from "../src/lib/onboarding2/snapshot";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  const allKeys = new Set<string>();
  for (const o of OFFER_KEYS) for (const s of agreementFor(o).sections) allKeys.add(s.key);

  const orphanKeys = CHAT_FAQS.filter((f) => f.sectionKey && !allKeys.has(f.sectionKey));
  check("every FAQ names a section key that exists in some variant", orphanKeys.length === 0,
    orphanKeys.map((f) => `${f.q} -> ${f.sectionKey}`).join("\n      "));

  const orphanTokens: string[] = [];
  for (const f of CHAT_FAQS) {
    for (const m of f.a.matchAll(/\{s:([a-z0-9_]+)\}/g)) {
      if (!allKeys.has(m[1])) orphanTokens.push(`${f.q} -> {s:${m[1]}}`);
    }
  }
  check("every {s:key} token names a real section key", orphanTokens.length === 0, orphanTokens.join("\n      "));

  const literal = CHAT_FAQS.filter((f) => /Section \d/.test(f.a));
  check("no FAQ answer hardcodes a clause number", literal.length === 0, literal.map((f) => f.q).join("\n      "));

  for (const offer of OFFER_KEYS) {
    const doc = agreementFor(offer);
    const snap = await buildSnapshot(offer);
    const kept = faqsFor(snap);
    const expected = CHAT_FAQS.filter((f) => !f.sectionKey || doc.sections.some((s) => s.key === f.sectionKey));
    check(`${offer}: every applicable FAQ survives resolution`, kept.length === expected.length,
      `${kept.length} kept of ${expected.length} applicable (${CHAT_FAQS.length} total)`);
    check(`${offer}: no brace token survives`, kept.every((f) => !/\{s:/.test(f.a)),
      kept.filter((f) => /\{s:/.test(f.a)).map((f) => f.q).join("\n      "));
  }

  for (const offer of ["year_3300", "month_349"] as const) {
    const doc = agreementFor(offer);
    for (const label of ["reviews", "booking", "implementation"]) {
      const keys = doc.sections.map((s) => s.key).filter((k) => k.includes(label));
      const n = CHAT_FAQS.filter((f) => f.sectionKey && keys.includes(f.sectionKey)).length;
      check(`${offer}: the ${label} obligation has at least one FAQ`, n >= 1, `${n} found`);
    }
  }

  const monthly = faqsFor(await buildSnapshot("month_349"));
  const leaked = monthly.filter((f) => /refund|guarantee|qualified appointment|90 days/i.test(f.a))
    .filter((f) => !/no performance guarantee and no refunds/.test(f.a));
  check("the monthly prompt carries no guarantee answer except the one that denies it",
    leaked.length === 0, leaked.map((f) => f.q).join("\n      "));

  console.log(failures ? `\n${failures} FAILED` : "\nAll clean.");
  process.exit(failures ? 1 : 0);
}
main();
