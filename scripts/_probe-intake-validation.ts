/**
 * Probe: business details are validated, not just trimmed.
 *
 *   bun run scripts/_probe-intake-validation.ts
 *
 * Pure. No database, no network.
 *
 * ‼️ THE FIRST BLOCK IS A REAL REGRESSION, TYPED BY A REAL PERSON.
 * The Launch Lane form shipped with trim() and nothing else. The first genuine attempt to use it
 * put `777777777` in City, `777777777` in State, `7777777777777` in ZIP and `77777777777777777`
 * in Phone. All four stored. The only field that objected was the website. The client row then
 * read "Test Clinic in 777777777, 777777777" and step 1 ticked itself GREEN over it.
 *
 * That is the worst shape of bug this codebase has a name for: a green tick over work nobody did.
 * The values become the NAP every directory is later matched to, the JSON-LD on every published
 * page, and the baseline the day 30/60/90 numbers are measured against.
 */

import {
  validateLaunchIntake,
  faultsInStoredIntake,
  checkPhone,
  checkState,
  checkPostalCode,
  checkCity,
  checkAddressLine1,
  checkVerticalSlug,
  checkWebsite,
  checkEmail,
} from "../src/lib/validate/intake-fields";

let failures = 0;

function refuses(label: string, verdict: { ok: boolean; error?: string }): void {
  if (!verdict.ok) console.log(`  ok    refuses  ${label.padEnd(42)} "${verdict.error}"`);
  else {
    failures += 1;
    console.error(`  FAIL  ACCEPTED ${label}`);
  }
}

function accepts(
  label: string,
  verdict: { ok: boolean; value: string | null },
  // `null` is a real expectation here: an empty optional website normalises to null, and typing
  // that as `string | undefined` made "expected nothing" indistinguishable from "did not say".
  want?: string | null
): void {
  const good = verdict.ok && (want === undefined || verdict.value === want);
  if (good) console.log(`  ok    accepts  ${label.padEnd(42)} -> ${verdict.value}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${label}: ok=${verdict.ok} value=${verdict.value} wanted ${want}`);
  }
}

console.log("\nIntake validation\n");
console.log("THE REGRESSION: the exact values that got through");
refuses("phone 77777777777777777", checkPhone("77777777777777777"));
refuses("city 777777777", checkCity("777777777"));
refuses("state 777777777", checkState("777777777"));
refuses("ZIP 7777777777777", checkPostalCode("7777777777777"));
refuses("address 7777777777777", checkAddressLine1("7777777777777"));
refuses("vertical (blank)", checkVerticalSlug(""));

{
  const r = validateLaunchIntake({
    email: "testclinic@gmail.com",
    verticalSlug: "clinic",
    legalName: "Test Clinic LLC",
    dbaName: "Test Clinic",
    phone: "77777777777777777",
    addressLine1: "7777777777777",
    city: "777777777",
    state: "777777777",
    postalCode: "7777777777777",
    website: "TestClinicLLC.com",
  });
  const bad = Object.keys(r.errors);
  if (!r.ok && bad.length >= 5) {
    console.log(`  ok    the whole form is refused, naming ${bad.length} fields: ${bad.join(", ")}`);
  } else {
    failures += 1;
    console.error(`  FAIL  the form was ${r.ok ? "ACCEPTED" : `refused but only named ${bad.join(", ")}`}`);
  }
}

console.log("\nMASHING, WHICH IS WHAT PEOPLE ACTUALLY TYPE");
refuses("city aaaaaaa", checkCity("aaaaaaa"));
refuses("city 11111", checkCity("11111"));
refuses("business name 7777", { ...validateLaunchIntake({ legalName: "7777" }).errors.legalName ? { ok: false, error: validateLaunchIntake({ legalName: "7777" }).errors.legalName } : { ok: true } });
refuses("state XX", checkState("XX"));
refuses("state Arizonaa", checkState("Arizonaa"));
refuses("ZIP 00000", checkPostalCode("00000"));
refuses("ZIP 8525", checkPostalCode("8525"));
refuses("phone 4805550147000", checkPhone("4805550147000"));
refuses("phone 1234567890 (area code 1)", checkPhone("1234567890"));
refuses("vertical 777", checkVerticalSlug("777"));
refuses("vertical Roofing Contractor!", checkVerticalSlug("Roofing Contractor!"));
refuses("email notanemail", checkEmail("notanemail"));
refuses("website Test Clinic LLC.com", checkWebsite("Test Clinic LLC.com"));

console.log("\nREAL VALUES, AND WHAT THEY NORMALISE TO");
accepts("phone (480) 555-0147", checkPhone("(480) 555-0147"), "+14805550147");
accepts("phone 1 480 555 0147", checkPhone("1 480 555 0147"), "+14805550147");
accepts("state az", checkState("az"), "AZ");
accepts("state Arizona", checkState("Arizona"), "AZ");
accepts("ZIP 85254", checkPostalCode("85254"), "85254");
accepts("ZIP 85254-1234", checkPostalCode("85254-1234"), "85254-1234");
accepts("city Scottsdale", checkCity("Scottsdale"), "Scottsdale");
accepts("city Winston-Salem", checkCity("Winston-Salem"), "Winston-Salem");
accepts("address 15169 N Scottsdale Rd Suite 210", checkAddressLine1("15169 N Scottsdale Rd Suite 210"));
accepts("vertical roofing-contractor", checkVerticalSlug("roofing-contractor"), "roofing-contractor");
accepts("vertical  Medical Aesthetics Studio ", checkVerticalSlug(" Medical Aesthetics Studio "), "medical-aesthetics-studio");
accepts("website lumenaesthetics.com", checkWebsite("lumenaesthetics.com"), "https://lumenaesthetics.com");
accepts("website https://www.Lumen.com/x", checkWebsite("https://www.Lumen.com/x"), "https://lumen.com");
accepts("website (blank, optional)", checkWebsite(""), null);

console.log("\nBUSINESS NAMES ARE NOT PERSON NAMES");
{
  const r1 = validateLaunchIntake({ legalName: "24/7 HVAC & Air LLC" });
  if (!r1.errors.legalName) console.log("  ok    accepts  24/7 HVAC & Air LLC");
  else {
    failures += 1;
    console.error(`  FAIL  rejected a real business name: ${r1.errors.legalName}`);
  }
}

console.log("\nA STORED ROW IS RE-CHECKED, SO A GREEN TICK CANNOT SIT ON GARBAGE");
{
  const faults = faultsInStoredIntake({
    legal_name: "Test Clinic LLC",
    dba_name: "Test Clinic",
    phone: "77777777777777777",
    city: "777777777",
    state: "777777777",
    postal_code: "7777777777777",
    vertical_slug: "clinic",
  });
  if (faults.length >= 4) console.log(`  ok    the stored row is refused, ${faults.length} faults`);
  else {
    failures += 1;
    console.error(`  FAIL  only ${faults.length} faults found in an obviously bad row`);
  }
}
{
  const faults = faultsInStoredIntake({
    legal_name: "Lumen Aesthetics LLC",
    dba_name: "Lumen Aesthetics",
    phone: "+14805550147",
    address_line1: "15169 N Scottsdale Rd Suite 210",
    city: "Scottsdale",
    state: "AZ",
    postal_code: "85254",
    vertical_slug: "medical-aesthetics-studio",
  });
  if (faults.length === 0) console.log("  ok    a good row passes clean");
  else {
    failures += 1;
    console.error(`  FAIL  a good row reported faults: ${faults.join("; ")}`);
  }
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
