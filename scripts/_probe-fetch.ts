import { fetchPage } from "@/lib/medspa-owner-scrape";

const urls = process.argv.slice(2);
for (const u of urls) {
  const t0 = Date.now();
  const r = await fetchPage(u, { timeoutMs: 20000, retries: 1 });
  const ms = Date.now() - t0;
  if (r.ok) {
    console.log(`OK    ${u}  status=${r.status}  ${r.html.length} bytes  ${ms}ms  final=${r.finalUrl}`);
  } else {
    console.log(`FAIL  ${u}  reason=${r.reason}  status=${r.status}  ${ms}ms  detail=${r.detail}`);
  }
}
