// One unit of work, and the reads inside it happen once.
//
// ‼️ THIS IS NOT A CACHE AND IT MUST NEVER BECOME ONE. It holds nothing between units of work, so it
// cannot serve a stale answer across a write. That distinction is the whole point: the scanner this
// exists for asks a person for what is missing, and a cache that outlived a paste would ask for a
// document that arrived thirty seconds ago. A TTL here would be the one bug this build cannot ship.
//
// ‼️ SCOPE THE UNIT OF WORK, NOT THE HTTP REQUEST. The Slack routes acknowledge inside Slack's three
// second window and do the real work in waitUntil(), so wrapping a route handler would scope the ack
// and cache nothing. Enter the store INSIDE the deferred callback. postStep() opens its own scope
// because cron and the auto-runner cascade reach it without passing through a route at all.
//
// ‼️ node:async_hooks IS IMPORTED HERE AND NOWHERE ELSE. src/config/delivery-steps.ts records what
// happened the last time a server-only import reached a "use client" component through a shared
// module: UnhandledSchemeError on node:dns/promises, at build time, far from the cause.

import { AsyncLocalStorage } from "node:async_hooks";

/** Promises, not values: two callers arriving together share one in-flight read rather than two. */
type ScopeStore = Map<string, Promise<unknown>>;

const storage = new AsyncLocalStorage<ScopeStore>();

/**
 * Run `fn` in a scope where `scopedOnce` memoizes.
 *
 * Nesting is allowed and the inner scope wins, which is what makes it safe to call from a place that
 * may or may not already be inside one.
 */
export function withLeadScope<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run(new Map(), fn);
}

/**
 * The value for `key`, computed once per scope.
 *
 * Outside a scope it simply calls `load()` every time, on purpose: a script or a probe then measures
 * the real number of reads instead of re-reading its own memo, which is what makes the query budget
 * in _probe-lead-context.ts a measurement rather than an assertion about itself.
 */
export function scopedOnce<T>(key: string, load: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  if (!store) return load();

  const held = store.get(key) as Promise<T> | undefined;
  if (held) return held;

  // Stored BEFORE the await so a second caller in the same tick finds the promise rather than
  // starting a second read. A rejection is evicted so a later caller can try again instead of
  // inheriting a failure that belonged to one moment.
  const started = load().catch((e) => {
    store.delete(key);
    throw e;
  });
  store.set(key, started);
  return started;
}

/** Whether a scope is open. For probes and for a comment that wants to say "this is memoized". */
export function inLeadScope(): boolean {
  return storage.getStore() !== undefined;
}
