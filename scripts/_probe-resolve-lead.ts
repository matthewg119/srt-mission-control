// Read-only: does resolveLead() actually find people?
//
// It is the seam the Zoho cutover, the email panel, the text thread and the
// dialer all sit on, so "it compiles" is not evidence. This pulls real rows out
// of `contacts` and feeds their own values back in through every lookup key,
// including the messy phone formats that broke exact matching in the first place.
//
//   bun run scripts/_probe-resolve-lead.ts

import { supabaseAdmin } from "@/lib/db";
import { resolveLead } from "@/lib/crm";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

/** A business_name held by exactly one contact. */
async function findUniqueBusinessName(): Promise<{ id: string; name: string } | null> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id, business_name")
    .not("business_name", "is", null)
    .limit(400);
  const seen = new Map<string, string[]>();
  for (const r of data ?? []) {
    const n = String(r.business_name).trim();
    if (!n) continue;
    (seen.get(n.toLowerCase()) ?? seen.set(n.toLowerCase(), []).get(n.toLowerCase())!).push(
      String(r.id)
    );
  }
  for (const [, ids] of seen) {
    if (ids.length !== 1) continue;
    const { data: one } = await supabaseAdmin
      .from("contacts")
      .select("id, business_name")
      .eq("id", ids[0])
      .maybeSingle();
    if (!one) continue;
    // Confirm uniqueness across the WHOLE table, not just the sampled page.
    const { count } = await supabaseAdmin
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .ilike("business_name", String(one.business_name));
    if (count === 1) return { id: String(one.id), name: String(one.business_name) };
  }
  return null;
}

/** A business_name held by two or more contacts. */
async function findDuplicateBusinessName(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("business_name")
    .not("business_name", "is", null)
    .limit(1000);
  const seen = new Map<string, number>();
  for (const r of data ?? []) {
    const n = String(r.business_name).trim().toLowerCase();
    if (!n) continue;
    seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  for (const [name, n] of seen) if (n >= 2) return name;
  return null;
}

/** A contact whose mobile_phone is populated and DIFFERENT from phone, so a
 *  match can only have come from mobile_last10. */
async function findMobileReachable(): Promise<{ id: string; mobile: string } | null> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id, phone, mobile_phone")
    .not("mobile_phone", "is", null)
    .limit(500);
  for (const r of data ?? []) {
    const mob = String(r.mobile_phone ?? "").replace(/\D/g, "").slice(-10);
    const ph = String(r.phone ?? "").replace(/\D/g, "").slice(-10);
    if (mob.length === 10 && mob !== ph) {
      return { id: String(r.id), mobile: String(r.mobile_phone) };
    }
  }
  return null;
}

async function main() {
  // A contact with the most fields populated, so one row exercises every key.
  const { data: rows, error } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, business_name, email, phone, mobile_phone, zoho_lead_id")
    .not("phone", "is", null)
    .not("email", "is", null)
    .not("business_name", "is", null)
    .limit(1);

  if (error) throw new Error(error.message);
  if (!rows?.length) throw new Error("no contact with phone + email + business_name");

  const c = rows[0];
  const phone = String(c.phone);
  const last10 = phone.replace(/\D/g, "").slice(-10);
  console.log(`sample: ${c.business_name}  ${phone}  ${c.email}\n`);

  console.log("-- every lookup key finds the same person --");
  const byId = await resolveLead({ contactId: c.id as string });
  check("by contactId", byId?.id === c.id);

  const byPhone = await resolveLead({ phone });
  check("by phone (stored format)", !!byPhone, byPhone ? `-> ${byPhone.displayName}` : "no match");

  // The formats an inbound webhook or a scraped page actually hands us. None of
  // these are how the number is stored, which is the entire reason the last10
  // generated columns exist.
  for (const fmt of [
    `+1${last10}`,
    last10,
    `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`,
    `1-${last10.slice(0, 3)}-${last10.slice(3, 6)}-${last10.slice(6)}`,
  ]) {
    const hit = await resolveLead({ phone: fmt });
    check(`by phone "${fmt}"`, !!hit);
  }

  const byEmail = await resolveLead({ email: String(c.email) });
  check("by email", !!byEmail, byEmail ? `-> ${byEmail.displayName}` : "no match");

  const byEmailCase = await resolveLead({ email: String(c.email).toUpperCase() });
  check("by email (UPPERCASED — ilike, not eq)", !!byEmailCase);

  // Pick a business_name that appears EXACTLY once, or the assertion is
  // vacuous: the ladder deliberately refuses ambiguous names, so testing it
  // with a duplicate proves nothing either way.
  const uniqueName = await findUniqueBusinessName();
  if (uniqueName) {
    const byName = await resolveLead({ businessName: uniqueName.name });
    check("by businessName (unique)", byName?.id === uniqueName.id, `"${uniqueName.name}"`);
  } else {
    console.log("  SKIP  could not find a business_name appearing exactly once");
  }

  // The refusal is the load-bearing half. A name shared by two companies must
  // resolve to nobody, because guessing writes a call note onto the wrong
  // company's record and it stays there.
  const dupeName = await findDuplicateBusinessName();
  if (dupeName) {
    check(
      "an AMBIGUOUS businessName resolves to null, not a guess",
      (await resolveLead({ businessName: dupeName })) === null,
      `"${dupeName}" is on 2+ contacts`
    );
  } else {
    console.log("  SKIP  no duplicated business_name to test ambiguity with");
  }

  if (c.zoho_lead_id) {
    const byZoho = await resolveLead({ zohoLeadId: String(c.zoho_lead_id) });
    check("by zohoLeadId", byZoho?.id === c.id);
  }

  console.log("\n-- misses return null, they do not throw --");
  check("unknown phone", (await resolveLead({ phone: "+15550001111" })) === null);
  check("unknown email", (await resolveLead({ email: "nobody@example.invalid" })) === null);
  check("empty input", (await resolveLead({})) === null);
  check("short/garbage phone", (await resolveLead({ phone: "123" })) === null);
  check("null-ish input", (await resolveLead({ phone: null, email: null })) === null);

  console.log("\n-- the shape callers depend on --");
  if (byId) {
    check("displayName is never empty", byId.displayName.trim().length > 0, `"${byId.displayName}"`);
    check("doNotContact is a real boolean", typeof byId.doNotContact === "boolean");
    check(
      "no empty strings leaked through (Zoho's \"\" habit)",
      ![byId.firstName, byId.lastName, byId.businessName, byId.email, byId.phone].some(
        (v) => v === ""
      )
    );
  }

  // mobile_last10 is the half a naive resolver forgets. It is a SEPARATE
  // generated column, not coalesced with phone_last10, so checking only
  // phone_last10 looks perfectly healthy on the sample above while missing
  // every contact whose mobile differs from their landline.
  console.log("\n-- mobile_last10 is consulted, not just phone_last10 --");
  const mobOnly = await findMobileReachable();
  if (mobOnly) {
    const hit = await resolveLead({ phone: mobOnly.mobile });
    check(
      "found by a mobile that differs from the phone column",
      hit?.id === mobOnly.id,
      `mobile ${mobOnly.mobile}`
    );
  } else {
    console.log("  SKIP  no contact whose mobile_phone differs from phone");
  }

  console.log(`\n${fail === 0 ? "ALL GOOD" : `${fail} FAILURES`}  (${pass} passed)`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
