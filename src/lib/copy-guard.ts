// The em-dash ban, made structural.
//
// SRT's copy rule is that em and en dashes never appear in anything a reader sees.
// The repo already enforces this on generated email with noDashes() in
// email-assistant.ts, but that module is heavy and server-side: importing it into a
// config file that a client component reads would drag the whole audit engine into
// the browser bundle. That is the same mistake the SCAN_STEPS / session.ts split was
// made to undo (129 kB down to 3.66 kB).
//
// So this is a pure, dependency-free module, safe on both sides of the bundler.
//
// It THROWS at module evaluation rather than warning, which means an em dash pasted
// out of a Google Doc fails `next build` instead of shipping. That is the point. A
// guard that logs is not a guard, and this one costs nothing at runtime because
// every call site is a module-level constant evaluated once.

/** Em dash, en dash, horizontal bar, and the two-hyphen form that renders as one. */
const BANNED = /[—–―]|--/;

export function guard<T extends string>(label: string, copy: T): T {
  if (BANNED.test(copy)) {
    throw new Error(
      `[copy-guard] ${label} contains an em dash, en dash, or "--". ` +
        `SRT copy uses commas, periods and single hyphens. Offending string: ${copy}`
    );
  }
  return copy;
}

/** Same check without throwing, for validating copy that arrives at runtime. */
export function hasBannedDash(copy: string): boolean {
  return BANNED.test(copy);
}
