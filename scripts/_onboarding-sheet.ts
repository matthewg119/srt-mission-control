// Write the onboarding setup sheet to a file, so it can be read on paper before a call.
//
//   bun --no-env-file run scripts/_onboarding-sheet.ts --blank
//   bun run --env-file=.env.local scripts/_onboarding-sheet.ts <clientId>
//
// ‼️ --blank TOUCHES NO DATABASE, which is what makes it the one to run while the design is still
// being argued about. A client id prefills the clinic name, the service list off intake step 2,
// the booking system and the chosen review platform, so the call does not ask for any of it
// twice; that path needs the env file.
//
// The sheet itself is light-ground and meant to be written on. See the header of
// src/lib/clients/artifacts/onboarding-sheet.ts for why it does not use src/lib/pdf/kit.ts.

import fs from "node:fs";
import path from "node:path";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: _onboarding-sheet.ts <clientId> | --blank");
  process.exit(1);
}

const out = path.join(process.cwd(), arg === "--blank" ? "onboarding-sheet.pdf" : `onboarding-sheet-${arg}.pdf`);

const { renderOnboardingSheet, generateOnboardingSheet } = await import(
  "../src/lib/clients/artifacts/onboarding-sheet"
);

const buffer =
  arg === "--blank"
    ? renderOnboardingSheet({
        // A name rather than a blank line: the sheet is the thing being judged, and a masthead
        // reading "Clinic" makes the layout look unfinished when it is not.
        clinicName: "Med Spa 123",
        services: [],
        bookingSoftware: null,
        reviewPlatform: null,
        clientEmail: null,
      })
    : await generateOnboardingSheet(arg);

fs.writeFileSync(out, buffer);
console.log(`${(buffer.length / 1024).toFixed(0)} kB -> ${out}`);
