// Create the two recurring Prices the med spa funnel needs.
//
//   node scripts/medspa-stripe-setup.mjs
//
// Reads STRIPE_SECRET_KEY from the environment. Run it with the sk_test_ key first;
// when you go live, run it again with the sk_live_ key and swap the printed ids into
// the LIVE Vercel env. Test and live objects are entirely separate, so the ids differ.
//
// IDEMPOTENT, via an EXPLICIT product id rather than a search.
//
// The first version of this looked products up with stripe.products.search on a
// metadata key. That silently created duplicates on a re-run, because search is
// backed by an eventually-consistent index that lags creation by up to a minute: the
// second run genuinely could not see what the first had just made. Product ids are
// caller-suppliable, so retrieve-or-create against a fixed id is exact and instant.
// Prices have no such field, so they are matched on (product, amount, interval),
// which is safe because the product lookup above is now reliable.
//
// Amounts are duplicated from src/config/medspa-funnel.ts on purpose: this script is
// plain .mjs and cannot import the TypeScript config. If you change a price, change
// it in BOTH places, and the config is the one the page and the charge read.

import Stripe from "stripe";

const PLANS = [
  {
    // Caller-supplied product id. This is what makes the script idempotent.
    productId: "srt_medspa_founding",
    srtKey: "medspa_founding",
    name: "SRT AI Visibility, Founding",
    description: "Founding rate, locked for life. First five clinics only. One clinic per market.",
    amount: 29900,
    envVar: "STRIPE_PRICE_FOUNDING",
  },
  {
    productId: "srt_medspa_standard",
    srtKey: "medspa_standard",
    name: "SRT AI Visibility, Standard",
    description: "Monthly AI visibility implementation and maintenance. One clinic per market.",
    amount: 49900,
    envVar: "STRIPE_PRICE_STANDARD",
  },
];

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set.");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
const mode = key.startsWith("sk_live") ? "LIVE" : "TEST";
console.log(`Mode: ${mode}\n`);

/** Retrieve by exact id. Never search: the search index lags creation. */
async function findProduct(productId) {
  try {
    return await stripe.products.retrieve(productId);
  } catch (e) {
    if (e?.code === "resource_missing" || e?.statusCode === 404) return null;
    throw e;
  }
}

async function findPrice(productId, amount) {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  return (
    prices.data.find(
      (p) => p.unit_amount === amount && p.currency === "usd" && p.recurring?.interval === "month"
    ) ?? null
  );
}

const results = [];

for (const plan of PLANS) {
  let product = await findProduct(plan.productId);
  if (product) {
    console.log(`product exists: ${plan.name} (${product.id})`);
  } else {
    product = await stripe.products.create({
      id: plan.productId,
      name: plan.name,
      description: plan.description,
      metadata: { srt_key: plan.srtKey },
    });
    console.log(`product created: ${plan.name} (${product.id})`);
  }

  let price = await findPrice(product.id, plan.amount);
  if (price) {
    console.log(`  price exists:  ${price.id}  $${plan.amount / 100}/month`);
  } else {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.amount,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: { srt_key: plan.srtKey },
    });
    console.log(`  price created: ${price.id}  $${plan.amount / 100}/month`);
  }

  results.push({ envVar: plan.envVar, id: price.id });
}

console.log(`\nSet these on the ${mode} environment:\n`);
for (const r of results) console.log(`${r.envVar}=${r.id}`);
console.log("");
