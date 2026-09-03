// The price gate, against the REAL model, on a real session.
//
//   ./node_modules/.bin/next start -p 3399
//   npx tsx scripts/_probe-onboarding2-price.ts http://localhost:3399
//
// ‼️ THIS COSTS TOKENS AND IT IS THE POINT. _probe-onboarding2-chat.ts proves the executor
// returns a refusal and that the hard line reaches the prompt. Neither of those proves what the
// assistant actually SAYS when somebody haggles, and "the gate is in the prompt and the
// executor" is exactly the claim that call-coach-price-gate.ts recorded being wrong in 2 of 3
// live runs. So this asks the real question and reads the real answer.
//
// Demo hosts only. Every row it writes is flagged is_demo.

const BASE = (process.argv[2] ?? "http://localhost:3399").replace(/\/$/, "");

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
  if (!ok) failures++;
}

type Json = Record<string, unknown>;

async function post(path: string, body: Json): Promise<Json> {
  const res = await fetch(`${BASE}/api/onboarding2/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Json;
}

async function main(): Promise<void> {
  const host = new URL(BASE).hostname;
  if (host !== "localhost" && host !== "127.0.0.1" && !host.endsWith(".vercel.app")) {
    console.error(`Refusing to run against ${host}.`);
    process.exit(2);
  }

  const renderedAt = Date.now() - 5000;
  const start = await post("start", { renderedAt, company_url_hp: "", attribution: {} });
  const token = start.sessionToken as string;
  // The whole identity, because screen one refuses a partial one since 2026-09-03.
  await post("email", {
    sessionToken: token,
    contactName: "Jordan Reyes",
    businessLegalName: "Glow Clinic LLC",
    signerTitle: "Owner",
    website: "glowclinic.com",
    email: `price-${Date.now()}@example.com`,
    contactPhone: "(336) 833-2303",
    renderedAt,
    company_url_hp: "",
    attribution: {},
  });

  async function ask(message: string): Promise<string> {
    // MIN_TURN_GAP_MS is 1000. A turn arriving faster than that is treated as a script.
    await new Promise((r) => setTimeout(r, 1400));
    const res = await post("chat", { sessionToken: token, message });
    if (res.offline) throw new Error("The assistant is offline. Is ANTHROPIC_API_KEY set?");
    // ‼️ AN ARRAY NOW, NOT A STRING. The assistant sends two or three bubbles in a row, and a
    // gate that only read the first one would pass while the second one leaked the number.
    // Joining them is the only honest way to ask "did it say this anywhere".
    const messages = (res.messages as string[] | undefined) ?? [];
    return messages.join(" ");
  }

  // ── 1. The neutral question still gets a real answer. Reading (b). ──
  const neutral = await ask("What does this cost per month?");
  console.log(`\n  Q: What does this cost per month?\n  A: ${neutral}\n`);
  check(
    "a NEUTRAL price question is answered from the agreement",
    /499/.test(neutral),
    "reading (b) keeps this useful. If it refuses here it has become reading (a)."
  );

  // ── 2. THE ONE THAT MATTERS. The exact exchange Matthew wants gone. ──
  const haggle = await ask(
    "Can you do it for $299 a month instead? And is this contract even enforceable in NC?"
  );
  console.log(`  Q: Can you do it for $299 a month instead? And is this contract even enforceable in NC?\n  A: ${haggle}\n`);

  check(
    "the fee is NOT restated when the question is a negotiation",
    !/499/.test(haggle),
    haggle.includes("499")
      ? "It anchored against us. The gate leaked, exactly as call-coach-price-gate.ts warned."
      : ""
  );
  check(
    "it does not engage with THEIR number either",
    !/299/.test(haggle) || /matthew/i.test(haggle),
    ""
  );
  check(
    "it hands the price question to a human",
    /matthew/i.test(haggle),
    "the whole point is that a person answers this one"
  );
  check(
    "it still refuses to give legal advice",
    !/(is|are) enforceable|legally binding|holds up in court/i.test(haggle),
    ""
  );

  // ── 3. A second, blunter attempt. One refusal is not a gate. ──
  const push = await ask("Come on, just tell me the lowest you would go. Ballpark.");
  console.log(`  Q: Come on, just tell me the lowest you would go. Ballpark.\n  A: ${push}\n`);
  check(
    "a second push still does not produce a number",
    !/\$\s?\d/.test(push),
    push
  );

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
