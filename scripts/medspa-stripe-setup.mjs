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
    productId: "srt_medspa_core",
    srtKey: "medspa_core",
    name: "SRT AI Visibility, Core",
    description: "Fixes what you say. Answer pages, refreshed pages, review requests, tracked prompts and a monthly re-test.",
    amount: 34900,
    envVar: "PRICE_ID_CORE_349",
  },
  {
    productId: "srt_medspa_complete",
    srtKey: "medspa_complete",
    name: "SRT AI Visibility, Complete",
    description: "Changes what everyone else says. Everything in Core plus review response drafting, off-site placement and competitor displacement tracking.",
    amount: 49900,
    envVar: "PRICE_ID_COMPLETE_499",
  },
];

// Retired by the v4 offer. Archived rather than deleted: Stripe will not delete a
// product that has ever had a price, and archiving is what keeps them out of the
// dashboard without breaking any historical object that referenced them.
const RETIRED_PRODUCT_IDS = ["srt_medspa_founding", "srt_medspa_standard"];

// The $39 audit credit, applied to the first month for anyone who bought the audit.
//
// A COUPON rather than a customer balance credit. A balance credit has to be written
// before the subscription exists, so a failed creation strands $39 on the customer
// that silently discounts some unrelated future invoice. The coupon travels in the
// same subscriptions.create call: no subscription, no discount, nothing to clean up.
// It also renders as an explicit discount line the customer can see, which matters
// because the $39-comes-off promise is made on camera.
const CREDIT_COUPON = {
  id: "srt_medspa_audit_credit_3900",
  amount_off: 3900,
  currency: "usd",
  duration: "once",
  name: "$39 audit credit",
};

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

// The $39 audit credit coupon. Coupons accept a caller-supplied id, so this is
// retrieve-or-create like the products above and safe to re-run.
let coupon;
try {
  coupon = await stripe.coupons.retrieve(CREDIT_COUPON.id);
  console.log("coupon exists: " + coupon.id + "  $" + ((coupon.amount_off ?? 0) / 100) + " " + coupon.duration);
} catch (e) {
  if (e?.code !== "resource_missing" && e?.statusCode !== 404) throw e;
  coupon = await stripe.coupons.create(CREDIT_COUPON);
  console.log("coupon created: " + coupon.id + "  $" + (coupon.amount_off / 100) + " " + coupon.duration);
}
results.push({ envVar: "AUDIT_CREDIT_COUPON_ID", id: coupon.id });

// Archive the retired Founding / Standard products. Stripe refuses to archive a
// product that still has an active price, so the prices go first.
for (const retiredId of RETIRED_PRODUCT_IDS) {
  try {
    const prod = await stripe.products.retrieve(retiredId);
    if (!prod.active) {
      console.log("retired already: " + retiredId);
      continue;
    }
    const prices = await stripe.prices.list({ product: retiredId, active: true, limit: 100 });
    for (const pr of prices.data) await stripe.prices.update(pr.id, { active: false });
    await stripe.products.update(retiredId, { active: false });
    console.log("retired: " + retiredId + " (" + prices.data.length + " price(s) deactivated)");
  } catch (e) {
    if (e?.code === "resource_missing" || e?.statusCode === 404) continue;
    console.log("could not retire " + retiredId + ": " + e.message);
  }
}

console.log(`\nSet these on the ${mode} environment:\n`);
for (const r of results) console.log(`${r.envVar}=${r.id}`);
console.log("");
