import { formatPhoneUS } from "../src/lib/clients/normalize";
import { normalizePhone, validateOptin } from "../src/lib/medspa/validate";

console.log("-- live formatting as typed --");
for (const raw of ["3", "336", "3368", "336833", "3368332303", "+13368332303", "13368332303", "(336) 833-2303", "336833230399"]) {
  console.log(`  ${JSON.stringify(raw).padEnd(18)} -> ${JSON.stringify(formatPhoneUS(raw))}`);
}
console.log("-- stored shape (E.164) --");
for (const raw of ["(336) 833-2303", "+1 336 833 2303", "336.833.2303"]) {
  console.log(`  ${raw.padEnd(18)} -> ${normalizePhone(raw)}`);
}
console.log("-- rejected --");
for (const raw of ["9999999999", "1234567890", "336833230", "0368332303"]) {
  console.log(`  ${raw.padEnd(18)} -> ${normalizePhone(raw)}`);
}
console.log("-- validateOptin, typed +1, mixed-case email, apostrophe name --");
console.log(" ", validateOptin({ name: "Jean-Luc O'Brien", email: "A@Clinic.COM", phone: formatPhoneUS("+13368332303"), consent: true }));
