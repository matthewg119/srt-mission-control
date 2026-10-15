// The two server-side pieces both card preview pages render: the QR image and the host printed
// under it. Shared by /cards/p and /cards/v2 so the code on both is the same object.

import QRCode from "qrcode";

import { cardQrTarget } from "@/lib/cards/preview-link";

/**
 * Their own future reviews host, for the line under the code.
 *
 * ‼️ DERIVED THE SAME WAY review-card.ts DERIVES IT, which is `reviews.{domain}`. That file
 * prefers the host actually ATTACHED in client_hosts and falls back to this, because a printed QR
 * must not depend on a string staying correct. There is no client and no attached host at this
 * point in the conversation, so the derivation is all there is, and it is the right one to show:
 * it is what their card will say.
 *
 * ‼️ NULL RATHER THAN A GUESS. With no website on the lead there is no honest host to print, and
 * the card omits the line rather than inventing a domain somebody might try to visit.
 */
export function reviewsHostFor(website: string | null): string | null {
  const raw = (website || "").trim().toLowerCase();
  if (!raw) return null;
  const bare = raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim();
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(bare)) return null;
  return `reviews.${bare}`;
}

/**
 * The code on the card.
 *
 * ‼️ ONE CODE FOR ALL THREE DESIGNS, BECAUSE THEY ALL POINT AT THE SAME PLACE AND A QR IS ALWAYS
 * DARK ON LIGHT. Rendering one per palette would be three identical images plus a temptation to
 * tint one to match, which is how a code stops scanning. See cardQrTarget for what it resolves to
 * and why that is not what a printed card carries.
 *
 * ‼️ MEMOISED PER TARGET, because the page is force-dynamic and a clinic reloading it should not
 * pay to encode the same 600px PNG twice. It was one cached promise while the target was a
 * constant; since the code resolves to the LEAD'S OWN page it is keyed by URL, and a cache keyed
 * on nothing would have served every clinic the first clinic's code.
 *
 * The settings are review-card.ts's own, so the code on screen and the code on the printed card
 * are the same object: error correction M with a quiet margin, which is what survives being
 * scanned in bad light.
 */
const qrCache = new Map<string, Promise<string>>();
export function previewQr(token: string | null): Promise<string> {
  const target = cardQrTarget(token);
  const hit = qrCache.get(target);
  if (hit) return hit;
  const made = QRCode.toDataURL(target, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 600,
    color: { dark: "#0a0a0a", light: "#FFFFFF" },
  });
  // Bounded, because the key is now per lead rather than a constant. A lambda that lived long
  // enough to see thousands of leads would otherwise hold a PNG for every one of them.
  if (qrCache.size > 200) qrCache.clear();
  qrCache.set(target, made);
  return made;
}
