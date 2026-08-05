// The SSRF resolver check for /scan. SERVER ONLY.
//
// Split out of normalize.ts rather than living beside it, and the reason is mechanical: this file
// imports node:dns, and `scan-form.tsx` is a client component that needs normalizeTarget() for
// inline validation. A single top-level `import { lookup } from "dns/promises"` anywhere in that
// module poisons the whole thing for the browser bundle, and webpack fails with
// "Module not found: Can't resolve 'dns/promises'". tsc does not catch it, because the bundler
// boundary is not a type error. Keeping the Node import in its own module is what makes the pure
// half safely importable from both sides.

import { lookup } from "dns/promises";

/**
 * Is this IP ADDRESS in a range we must never reach from inside our infrastructure?
 *
 * Kept separate from isPrivateHost() in normalize.ts on purpose. That one additionally rejects any
 * bare IP as "not a business website", which is right for user input and catastrophically wrong
 * here: assertPublicHost() feeds this resolved addresses, and every resolved address is a bare IP.
 * Merging the two would reject every domain on earth.
 */
function isPrivateIp(addr: string): boolean {
  const h = addr.toLowerCase().replace(/^\[|\]$/g, "");

  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true;
    if (/^f[cd][0-9a-f]{2}:/i.test(h)) return true; // fc00::/7 unique-local
    if (/^fe80:/i.test(h)) return true; // link-local
    // IPv4-mapped (::ffff:169.254.169.254) smuggles a v4 address through a v6 check.
    const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * Does this hostname RESOLVE to something public?
 *
 * isPrivateHost() only sees the literal text, so `169.254.169.254.nip.io` sails through it:
 * dot, non-numeric TLD, not an IP literal. It resolves to the cloud metadata endpoint, and
 * researchWebsite() would then fetch it from inside the lambda. A blocklist of literals is not
 * a defence against a resolver, so ask the resolver.
 *
 * Deliberately fails CLOSED: a name we cannot resolve is a name we will not fetch.
 *
 * Known limit, accepted: this is TOCTOU. A record with a 0s TTL can answer publicly here and
 * privately to the fetch a second later, and redirects are not re-checked. Closing that properly
 * means a custom agent that validates on connect for every hop. This stops the actual attack
 * anyone will try; it is not a promise of perfect SSRF safety.
 */
export async function assertPublicHost(hostname: string): Promise<boolean> {
  try {
    const addrs = await lookup(hostname, { all: true });
    if (addrs.length === 0) return false;
    // every(), not some(): one private answer in a round-robin set is enough to disqualify it.
    return addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}
