// Register (or re-register) the med spa Stripe webhook endpoint.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/medspa-stripe-webhook.mjs
//
// Prints the signing secret, which is the ONLY time Stripe reveals it. If an endpoint
// for this URL already exists, its secret cannot be read back, so pass --recreate to
// delete and remake it (which rotates the secret and invalidates the old one).
//
// The URL is mission.srtagency.com DIRECTLY, never the srtagency.com rewrite: the
// signature is computed over the exact request bytes and a proxy hop is a needless
// way to lose them.

import Stripe from "stripe";

const URL_PATH = "/api/medspa/stripe/webhook";
const BASE = process.env.MEDSPA_WEBHOOK_BASE || "https://mission.srtagency.com";
const ENDPOINT_URL = `${BASE}${URL_PATH}`;

const EVENTS = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set.");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
const mode = key.startsWith("sk_live") ? "LIVE" : "TEST";
const recreate = process.argv.includes("--recreate");

console.log(`Mode: ${mode}`);
console.log(`URL:  ${ENDPOINT_URL}\n`);

const existing = (await stripe.webhookEndpoints.list({ limit: 100 })).data.filter(
  (e) => e.url === ENDPOINT_URL
);

if (existing.length && !recreate) {
  console.log(`An endpoint already exists (${existing[0].id}).`);
  console.log("Stripe only reveals the signing secret at creation time, so it cannot be");
  console.log("printed here. Either copy it from the Stripe dashboard, or re-run with");
  console.log("--recreate to rotate it:\n");
  console.log("  node scripts/medspa-stripe-webhook.mjs --recreate\n");
  console.log("Enabled events on the existing endpoint:");
  for (const ev of existing[0].enabled_events) console.log(`  ${ev}`);
  process.exit(0);
}

for (const e of existing) {
  await stripe.webhookEndpoints.del(e.id);
  console.log(`deleted old endpoint ${e.id}`);
}

const endpoint = await stripe.webhookEndpoints.create({
  url: ENDPOINT_URL,
  enabled_events: EVENTS,
  description: "SRT med spa AEO funnel",
  // Pin the version the code was written against, so a dashboard default change
  // cannot reshape the event payloads this handler parses.
  api_version: "2026-07-29.dahlia",
});

console.log(`created endpoint ${endpoint.id}`);
console.log(`events: ${EVENTS.length}\n`);
console.log(`Set this on the ${mode} environment:\n`);
console.log(`STRIPE_WEBHOOK_SECRET=${endpoint.secret}\n`);
