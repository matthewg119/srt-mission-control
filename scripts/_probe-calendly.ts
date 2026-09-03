// Calendly, end to end, before anything depends on it.
//
// Run: bunx tsx --env-file=.env.local scripts/_probe-calendly.ts
//
// ‼️ IT NEEDS A PERSONAL ACCESS TOKEN, NOT AN OAUTH APP. calendly.ts sends
// `Authorization: Bearer ${CALENDLY_API_TOKEN}` and there is no OAuth callback route anywhere in
// this repo, so an OAuth client id and secret cannot be used and will fail with a 401 that looks
// exactly like a wrong token. Get the PAT from Calendly: Integrations, then API and webhooks, then
// "Generate new token".
//
// ‼️ IT READS AND PRINTS, IT NEVER WRITES. No booking is created, no event type is changed, and
// nothing is stored. The whole job is to answer three questions in order: is the token real, which
// event type is the call we sell, and does availability actually come back.

import { fetchSlots, bucketSlots, isCalendlyConfigured, eventTypeUri, bookingPageUrl } from "@/lib/calendly";

const API = "https://api.calendly.com";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

interface EventType {
  uri?: string;
  name?: string;
  slug?: string;
  duration?: number;
  active?: boolean;
  scheduling_url?: string;
  kind?: string;
}

async function api<T>(path: string, token: string): Promise<{ ok: true; data: T } | { ok: false; status: number; body: string }> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, status: res.status, body: (await res.text()).slice(0, 300) };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  console.log("\ncalendly: token, event types, availability\n");

  const token = (process.env.CALENDLY_API_TOKEN ?? "").trim();
  if (!token) {
    console.log("  CALENDLY_API_TOKEN is not set.\n");
    console.log("  Get a PERSONAL ACCESS TOKEN (not an OAuth app):");
    console.log("    Calendly -> Integrations -> API and webhooks -> Personal access tokens");
    console.log("    -> Generate new token\n");
    console.log("  Then add it to .env.local and to Vercel, and run this again:");
    console.log("    CALENDLY_API_TOKEN=eyJ...\n");
    process.exit(1);
  }

  // ── 1. Is the token real, and whose is it ─────────────────────────────────
  console.log("1. the token");
  const me = await api<{ resource?: { uri?: string; name?: string; email?: string; scheduling_url?: string } }>(
    "/users/me",
    token
  );
  if (!me.ok) {
    check("the token is accepted", false, `${me.status}: ${me.body}`);
    if (me.status === 401) {
      console.log("\n  A 401 here almost always means an OAuth client secret was pasted instead of a");
      console.log("  Personal Access Token. They look similar and only one of them works.\n");
    }
    process.exit(1);
  }
  const user = me.data.resource ?? {};
  check("the token is accepted", Boolean(user.uri), JSON.stringify(user).slice(0, 200));
  console.log(`          account: ${user.name ?? "?"} <${user.email ?? "?"}>`);
  console.log(`          booking page: ${user.scheduling_url ?? "?"}`);

  // ── 2. Which event type is the call we sell ───────────────────────────────
  console.log("\n2. event types on this account");
  const list = await api<{ collection?: EventType[] }>(
    `/event_types?user=${encodeURIComponent(user.uri ?? "")}&count=100`,
    token
  );
  if (!list.ok) {
    check("event types could be listed", false, `${list.status}: ${list.body}`);
    process.exit(1);
  }
  const types = (list.data.collection ?? []).filter((t) => t.active !== false);
  check("at least one active event type exists", types.length > 0, `${types.length} found`);

  for (const t of types) {
    const uuid = (t.uri ?? "").split("/").pop() ?? "?";
    console.log(`\n          ${t.name ?? "?"}  (${t.duration ?? "?"} min, ${t.kind ?? "?"})`);
    console.log(`            uuid:  ${uuid}`);
    console.log(`            page:  ${t.scheduling_url ?? "?"}`);
  }

  // ‼️ THE GUESS IS A SUGGESTION AND IT IS LABELLED AS ONE. Picking the shortest active event type
  // is right most of the time and wrong the moment somebody adds a 10 minute "quick question"
  // link. It prints the line to paste; it never writes it.
  const shortest = [...types].sort((a, b) => (a.duration ?? 999) - (b.duration ?? 999))[0];
  if (shortest) {
    const uuid = (shortest.uri ?? "").split("/").pop() ?? "";
    console.log("\n  Paste these, in .env.local AND in Vercel (production and preview):\n");
    console.log(`    CALENDLY_API_TOKEN=${token.slice(0, 6)}...           # the value you already have`);
    console.log(`    CALENDLY_15MIN_UUID=${uuid}`);
    console.log(`    NEXT_PUBLIC_CALENDLY_15MIN_URL=${shortest.scheduling_url ?? ""}`);
    console.log(`\n  That is a GUESS at which event type is the sales call: "${shortest.name}",`);
    console.log("  the shortest active one. If a different one is the call you sell, use its uuid.");
    console.log("\n  ‼️ Do NOT set CALENDLY_INSTALL_UUID for this. The concierge only ever offers the");
    console.log("     15min event; install belongs to the post-sale lane and is not wired here.\n");
  }

  // ── 3. Does availability actually come back ───────────────────────────────
  console.log("3. availability, through the code the concierge actually calls");
  if (!isCalendlyConfigured("15min")) {
    console.log("  CALENDLY_15MIN_UUID is not set yet, so the booking bot falls back to the");
    console.log("  onboarding link. That is the designed fallback, not a failure. Set it and re-run.\n");
    console.log(failures === 0 ? "token and event types look right\n" : `\n${failures} CHECK(S) FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
  }

  check("eventTypeUri resolves", Boolean(eventTypeUri("15min")), String(eventTypeUri("15min")));
  console.log(`          public page fallback: ${bookingPageUrl("15min") ?? "(none set)"}`);

  const tz = "America/New_York";
  const soon = await fetchSlots("15min", "today_tomorrow", tz);
  check("fetchSlots did not error", soon.slots !== null || soon.reason !== "error", `reason ${soon.reason}`);

  if (soon.slots === null) {
    console.log(`          reason: ${soon.reason}. The bot falls back to the onboarding link.`);
  } else if (soon.slots.length === 0) {
    console.log("          today and tomorrow are full. Trying the 7 day window.");
    const wide = await fetchSlots("15min", "extended", tz);
    check("the extended window answers", wide.slots !== null, `reason ${wide.reason}`);
    console.log(`          ${wide.slots?.length ?? 0} slot(s) in the next 7 days`);
  } else {
    console.log(`          ${soon.slots.length} slot(s) in the next two days, ${tz}:`);
    const buckets = bucketSlots(soon.slots, tz);
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
    for (const day of ["today", "tomorrow"] as const) {
      for (const half of ["morning", "afternoon"] as const) {
        const list2 = buckets[day][half];
        if (list2.length) {
          console.log(`            ${day} ${half}: ${list2.map((x) => fmt.format(new Date(x.startTime))).join(", ")}`);
        }
      }
    }
    // The per-slot link is what the concierge hands over, so prove one exists.
    check("every slot carries its own booking link", soon.slots.every((x) => x.schedulingUrl.startsWith("https://")));
  }

  console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nprobe crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
