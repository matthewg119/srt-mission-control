// The mascot lane's rules, offline. No network, no database, nothing spent.
//
//     bunx tsx scripts/_probe-mascot.ts
//
// What it is here to catch, in the order the bugs would actually happen:
//   1. A registry entry that names a file it does not have, so a corner loads a broken image.
//   2. `mascot skip` read as a character called "skip", which is what a KEEP-first grammar does.
//   3. A generated mascot row accepted with a relative URL, which the widget would join to our own
//      origin and 404 silently on somebody else's website.
//   4. A loader script that does not parse. It is an eighteen kilobyte string in a TS file, so tsc
//      says nothing about its contents and the first sign of a syntax error is a dead widget.

import { existsSync, readFileSync } from "node:fs";
import { isLauncherCorner, isMascotCommand, readMascotIntent } from "../src/lib/clients/mascot-grammar";
import { commandOwner } from "../src/lib/clients/step-commands";

// ‼️ THE REGISTRY IS READ AS TEXT, NOT IMPORTED, AND IT HAS TO BE. src/lib/concierge/mascot/index.ts
// static-imports .webp and .png so the files land in /_next/static, which only Next's bundler can
// resolve: importing it from a tsx script asks node to parse a WebP as JavaScript. Reading the source
// checks the thing actually worth checking anyway, which is that every file it names exists on disk.
const REGISTRY_DIR = "src/lib/concierge/mascot";
const registry = readFileSync(`${REGISTRY_DIR}/index.ts`, "utf8").replace(/\r\n/g, "\n");

let failed = 0;
function check(what: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

// ── 1. The registry ─────────────────────────────────────────────────────────
console.log("\n1. every mascot resolves to files it actually has");

const imported = [...registry.matchAll(/^import \w+ from "\.\/([^"]+)";$/gm)].map((m) => m[1]);
check("the registry imports files", imported.length >= 6, String(imported.length));
for (const file of imported) {
  check(`${file} is on disk`, existsSync(`${REGISTRY_DIR}/${file}`));
}

const keys = [...registry.matchAll(/^ {2}"([a-z0-9-]+)": \{$/gm)].map((m) => m[1]);
check("both characters are registered", keys.length >= 2, keys.join(", "));
check("the default is the alien, not the cat", /DEFAULT_MASCOT = "blue-alien"/.test(registry));
check("the default is a registered key", keys.includes("blue-alien"), keys.join(", "));
check("SRT's cat is still registered", keys.includes("wizard-cat"), keys.join(", "));
// ‼️ AN UNKNOWN KEY RETURNS null AND IS NEVER COERCED TO THE DEFAULT. A typo that silently paints
// the fallback character onto a client's site is worse than a corner that stays a plain pill.
check("an unknown key resolves to null", /MASCOTS\[key\] \?\? null/.test(registry));
// Every flourish carries its own duration, because a flourish is played once and is not ping-ponged.
const clips = [...registry.matchAll(/\{ src: \w+\.src, ms: (\w+) \}/g)].map((m) => m[1]);
check("every flourish carries a duration", clips.length >= 4 && clips.every(Boolean), String(clips.length));
// The easter egg is held apart from the flourish list: the widget picks from that list uniformly, so a
// one-in-sixty gesture mixed into a list of three would be a one-in-three gesture.
check("the easter egg is a separate field", /easterEgg: null|easterEgg: \{/.test(registry));

// ── 2. The grammar ──────────────────────────────────────────────────────────
console.log("\n2. the reserved words win, and a sentence is not a command");

for (const t of ["mascot", "mascots", "mascot concepts", "mascot skip", "mascot pick a, b", "mascot corner bottom-left", "mascot spa-otter"]) {
  check(`"${t}" is a command`, isMascotCommand(t));
}
for (const t of ["mascot ideas please", "what mascot should we use", "concierge install", "ladder pick 4", ""]) {
  check(`"${t}" is not`, !isMascotCommand(t));
}

// The wrong-thread pointer must claim the unambiguous forms and leave a bare key alone.
check("a bare `mascot` points at step 18", commandOwner("mascot")?.step === "concierge_preview");
check("`mascot concepts` points at step 18", commandOwner("mascot concepts")?.step === "concierge_preview");
check("`mascot skip` points at step 18", commandOwner("mascot skip")?.step === "concierge_preview");
check("a bare key is left alone", commandOwner("mascot spa-otter") === null);
check("the ladder still owns its own", commandOwner("ladder pick 4")?.step === "pre_call_pages");

// ── 3. Art intent ───────────────────────────────────────────────────────────
console.log("\n3. art is filed against a character, never guessed");

check("a key and a state are read", readMascotIntent("mascot spa-otter talk")?.state === "talk");
check("the state defaults to idle", readMascotIntent("here you go mascot spa-otter")?.state === "idle");
check("the key survives surrounding words", readMascotIntent("mascot spa-otter idle please")?.key === "spa-otter");
// ‼️ "mascot idle" NAMES A STATE, NOT A CHARACTER. Reading it as a key called "idle" would answer
// "there is no character called idle" to somebody who simply did not name one.
check("a bare state is not a key", readMascotIntent("mascot idle") === null);
check("no mascot word, no intent", readMascotIntent("here is the logo") === null);


// ── 4. Corners ──────────────────────────────────────────────────────────────
console.log("\n4. four corners, and nothing else");

for (const c of ["bottom-right", "bottom-left", "top-right", "top-left"]) check(`${c} is a corner`, isLauncherCorner(c));
for (const c of ["middle", "bottom", "bottom-centre", "", null, 4]) check(`${JSON.stringify(c)} is not`, !isLauncherCorner(c));

// ── 5. The loader ───────────────────────────────────────────────────────────
console.log("\n5. the loader script parses, and still obeys its own rules");

// ‼️ NEWLINES NORMALISED BEFORE ANYTHING IS SEARCHED FOR. git checks this file out with CRLF on
// Windows depending on the worktree, so a probe that looks for a backtick followed by a newline finds
// nothing and reports the script as missing rather than as broken. The file's line endings are not what
// this is testing.
const route = readFileSync("src/app/embed.js/route.ts", "utf8").replace(/\r\n/g, "\n");
const open = route.indexOf("const SCRIPT = `");
const close = route.indexOf("`;\n", open);
const script = route.slice(open + "const SCRIPT = `".length, close);

check("the script was found", open > 0 && close > open);
// A bare backtick inside the template literal terminates it early. tsc catches that, but only as a
// confusing cascade a hundred lines later, so this names it directly.
check("no stray backtick inside the template", !script.includes("`"));
try {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(script.replace(/\\\\/g, "\\"));
  check("the script parses", true);
} catch (e) {
  check("the script parses", false, (e as Error).message);
}

// The rules the file's own header states, as assertions rather than prose.
check("it still sets no cookies and no storage", !/localStorage|sessionStorage|document\.cookie/.test(script));
check("a mascot URL goes through abs()", !/origin\+(cat)?[Aa]ssets\./.test(script));
check("the corner comes from the config", script.includes("if(d.corner)place(d.corner)"));
check("reduced motion skips every gesture", script.includes("if(!list.length||reduce)return"));
check("the drag persists only with a preview token", script.includes("if(!ptok)return"));
check("a drag does not open the panel", script.includes("if(moved){moved=false;return}"));

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
