// Can the connected account actually DRAFT into submissions@? Scopes say yes
// (Mail.ReadWrite.Shared, Mail.Send.Shared are granted), but Exchange-side delegate access is a
// separate grant and is the thing that fails the day matthew@ first hits its cap.
//
// Creates a draft in the shared mailbox and DELETES it. Sends nothing.

import { microsoft } from "../src/lib/microsoft";
import { outreachMailboxes, toGraphMailbox, connectedMailbox } from "../src/config/outreach-mailboxes";

async function main() {
  console.log(`connected account: ${connectedMailbox()}\n`);
  for (const m of outreachMailboxes()) {
    const graphMailbox = toGraphMailbox(m.address);
    const label = graphMailbox ?? `${m.address} (/me)`;
    try {
      const d = await microsoft.createDraft({
        mailbox: graphMailbox,
        to: connectedMailbox(),
        subject: "probe-mailbox-access (delete me)",
        body: "<p>probe</p>",
      });
      const cleanup = await microsoft.deleteDraft(d.id, graphMailbox);
      console.log(`  OK    ${label}  draft created and ${cleanup}`);
    } catch (e) {
      console.log(`  FAIL  ${label}\n        ${(e as Error).message.slice(0, 220)}`);
    }
  }
  console.log("");
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
