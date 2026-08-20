// THROWAWAY read-mostly probe. Settles ONE question: what is the stable idempotency
// key for an outbound email, given that reply-anchor.ts:5-6 and microsoft.ts:1149-1150
// make directly contradictory claims about whether a Graph message id survives /send.
//
// Creates ONE draft and DELETES it. Sends nothing.
//
//   bunx tsx --env-file=.env.local scripts/_probe-touch-key.ts

import { microsoft } from "../src/lib/microsoft";

const GRAPH = "https://graph.microsoft.com/v1.0";

async function get(path: string) {
  const token = await microsoft.getAccessToken();
  const res = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} on ${path}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  // 1. Do SENT messages carry internetMessageId? Pure read.
  const sent = await get(
    `/me/mailFolders/sentitems/messages?$top=3&$select=${encodeURIComponent("id,internetMessageId,conversationId,subject,sentDateTime")}`
  );
  console.log("=== SENT ITEMS (read-only) ===");
  for (const m of sent.value ?? []) {
    console.log(`  subject : ${(m.subject ?? "").slice(0, 60)}`);
    console.log(`  graph id: ${String(m.id).slice(0, 40)}...`);
    console.log(`  imid    : ${m.internetMessageId ?? "(NONE)"}`);
    console.log("");
  }

  // 2. Does a DRAFT carry one at creation? Create -> read -> delete. No send.
  console.log("=== DRAFT lifecycle (creates then deletes one draft, sends nothing) ===");
  const draft = await microsoft.createDraft({
    to: process.env.OUTREACH_MAILBOX || "matthew@srtagency.com",
    subject: "probe-touch-key (delete me)",
    body: "<p>probe</p>",
  });
  console.log(`  created draft id: ${String(draft.id).slice(0, 40)}...`);
  const fetched = await get(
    `/me/messages/${draft.id}?$select=${encodeURIComponent("id,internetMessageId,conversationId,isDraft")}`
  );
  console.log(`  isDraft         : ${fetched.isDraft}`);
  console.log(`  conversationId  : ${fetched.conversationId ? "present" : "(NONE)"}`);
  console.log(`  internetMessageId on the DRAFT: ${fetched.internetMessageId ?? "(NONE)"}`);
  const del = await microsoft.deleteDraft(draft.id);
  console.log(`  cleanup         : ${del}`);

  console.log("");
  console.log("VERDICT:");
  console.log(
    fetched.internetMessageId
      ? "  Drafts DO carry internetMessageId at creation -> use it as the idempotency key."
      : "  Drafts carry NO internetMessageId -> key must fall back to graph_message_id."
  );
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
