// Manually trigger Route A (the daily pest-control pull) without waiting for the
// Vercel cron schedule.  Usage:  bun run pull:now
//
// Hits the local dev server by default; override with PULL_URL to target prod.
// Sends the CRON_SECRET bearer so the route authorizes exactly like Vercel Cron.

const url = process.env.PULL_URL || "http://localhost:3000/api/cron/pull-prospects";
const secret = process.env.CRON_SECRET || "";

async function main() {
  console.log(`▶️  POST ${url}`);
  const res = await fetch(url, {
    method: "POST",
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });
  const text = await res.text();
  console.log(`   HTTP ${res.status}`);
  console.log(text);
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error("❌ pull:now failed:", err);
  process.exit(1);
});
