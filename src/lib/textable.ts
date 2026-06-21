// "Is this lead textable?" — Phase 1 pragmatic rule.
//
// There is no line-type data today, so this is optimistic: prefer an explicit
// mobile number, otherwise the first phone that normalizes to a valid US E.164
// is treated as textable. Landlines will pass; the iMessage transport fails soft
// (a non-iMessage number simply doesn't deliver), so the cost is a wasted send,
// not a crash. Phase 2 can add a cached line-type lookup -> contacts.line_type.

import { normalizePhone } from "@/lib/phone";

export interface TextableResult {
  textable: boolean;
  phone: string | null; // E.164 of the chosen textable number
  basis: "mobile" | "normalized" | "none";
}

export function pickTextablePhone(
  phones: string[],
  mobileHint?: string | null
): TextableResult {
  if (mobileHint) {
    const m = normalizePhone(mobileHint);
    if (m) return { textable: true, phone: m, basis: "mobile" };
  }
  for (const raw of phones) {
    const n = normalizePhone(raw);
    if (n) return { textable: true, phone: n, basis: "normalized" };
  }
  return { textable: false, phone: null, basis: "none" };
}
