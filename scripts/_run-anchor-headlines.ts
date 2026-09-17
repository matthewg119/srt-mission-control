// One-off: anchor a client at a rung and let the headline run fire, exactly as the thread would.
//
//   bunx tsx --env-file=.env.local scripts/_run-anchor-headlines.ts <slug> <stage>
//
// It calls the SAME handler the Slack events route calls and posts the same replies to the same
// thread, so the board reads identically to Matthew typing "anchor at 4" himself. It spends one model
// call for the headlines.

import { resolveClient } from "../src/lib/clients/client-reads";
import { handleLadderThreadReply } from "../src/lib/clients/anchor-ladder";
import { notifyStep } from "../src/lib/clients/step-board";

const STEP = "pre_call_pages";

async function main(): Promise<void> {
  const slug = process.argv[2];
  const stage = process.argv[3] ?? "4";
  if (!slug) throw new Error("usage: _run-anchor-headlines.ts <slug> <stage>");

  const found = await resolveClient(slug);
  if (!found.ok) throw new Error(found.error);
  const clientId = found.client.id;
  console.log(`${clientId}  ${slug}`);

  const said = await handleLadderThreadReply({
    clientId,
    stepKey: STEP,
    text: `anchor at ${stage}`,
    by: "Matthew",
  });
  if (!said) throw new Error(`"anchor at ${stage}" matched nothing. The deploy may be behind.`);

  console.log("\n--- reply posted to the thread ---\n" + said.message + "\n");
  await notifyStep(clientId, STEP, said.message);

  if (said.after) {
    console.log("running the headline pass, about a minute...");
    await said.after();
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
