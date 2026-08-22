// Probe for the deterministic halves of the webinar deck builder: parity, section splitting,
// and the pptx renderer. No API calls, no network — the creative half is the model's and is not
// what breaks. Port of vsl-deck-builder/selftest.py.
//
//   bun run scripts/_probe-webinar-deck.ts

import { runParity, splitSections, isSectionHeader, validateSlides, tokens, stripDelivery } from "../src/lib/deck/parity";
import { renderDeck, writePlan, deckWarnings } from "../src/lib/deck/render";
import { mechanicalChunk } from "../src/lib/deck/author";
import { stripTrigger, isWebinarTrigger } from "../src/lib/deck/extract";
import { type DeckSlide, slideText } from "../src/lib/deck/types";
import JSZip from "jszip";

let failures = 0;
function ok(cond: boolean, label: string): void {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}`);
  if (!cond) failures++;
}
function section(title: string): void {
  console.log(title);
}

const SCRIPT = `HOOK / PROMISE + GUARANTEE
If you own a med spa in [city], this is our promise to you. [pause] We'll build you a system that puts 20 to 40 new patients on your calendar every month.

THE THREE PROMISES
Here's exactly what that looks like. We guarantee three specific results.
Number one - we put your med spa in the answer.

CLOSE
Book your demo. I'll take it from there.`;

const SLIDES: DeckSlide[] = [
  { n: 1, section: "HOOK / PROMISE + GUARANTEE", runs: [{ t: "If you own a med spa in [city], this is our promise to you." }], notes: ["[pause]"] },
  {
    n: 2, section: "HOOK / PROMISE + GUARANTEE",
    runs: [{ t: "We'll build you a system that puts " }, { t: "20 to 40 new patients", e: "purple" }, { t: " on your calendar every month." }],
  },
  {
    n: 3, section: "THE THREE PROMISES",
    runs: [{ t: "Here's exactly what that looks like. We guarantee three specific results." }],
    bullets: null,
    visual: { type: "sketch", idea: "three fingers held up", prompt: "black marker doodle of a hand holding up three fingers", search: ["three fingers line icon", "hand count outline"] },
  },
  { n: 4, section: "THE THREE PROMISES", runs: [{ t: "Number one - we put your med spa " }, { t: "in the answer", e: "purple" }, { t: "." }] },
  { n: 5, section: "CLOSE", runs: [{ t: "Book your demo. I'll take it from there." }] },
];

section("1. section headers");
ok(isSectionHeader("CLOSE"), "a bare all-caps word is a header");
ok(isSectionHeader("THE STORY / WHY WE CAN PROMISE THIS"), "slashes and length are fine");
ok(!isSectionHeader("Number one - we put your med spa in the answer."), "a spoken sentence is not a header");
ok(!isSectionHeader("ChatGPT Ads put you in front of patients."), "an embedded acronym is not a header");
ok(!isSectionHeader(""), "a blank line is not a header");
{
  const split = splitSections(SCRIPT);
  ok(split.headers.length === 3, "three headers found");
  ok(!split.body.includes("THE THREE PROMISES"), "headers are stripped from the body");
  ok(split.sections.every((s) => s.text.trim().length > 0), "no empty section survives");
}

section("2. parity passes on an exact deck");
{
  const r = runParity(SCRIPT, SLIDES);
  ok(r.ok, "exact deck passes");
  ok(r.scriptWords === r.deckWords, `word counts match (${r.scriptWords})`);
  ok(r.removed.includes("[pause]"), "the bracketed cue was reported as stripped");
  ok(!slideText(SLIDES[0]).includes("[pause]"), "the cue is not on the slide");
  // A placeholder is read aloud with a real word substituted, so it BELONGS on the slide.
  // Stripping it left "a med spa in , this is" — a blank gap on camera.
  ok(!r.removed.includes("[city]"), "a placeholder is NOT treated as a cue");
  ok(slideText(SLIDES[0]).includes("[city]"), "the placeholder stays on the slide");
  ok(!/  /.test(stripDelivery("a [pause] b").text), "a dropped cue leaves no double space");
}

section("3. parity fails on drift, and names the slide");
{
  const dropped = SLIDES.filter((s) => s.n !== 4).map((s, i) => ({ ...s, n: i + 1 }));
  const r = runParity(SCRIPT, dropped);
  ok(!r.ok, "a missing slide fails");
  ok(/slide 4/.test(r.problems[0] ?? ""), "the failure names slide 4");
  ok(/in the answer/.test(r.problems[0] ?? ""), "the failure shows the missing words");
}
{
  const reworded = SLIDES.map((s) => (s.n === 5 ? { ...s, runs: [{ t: "Book your call. I'll take it from there." }] } : s));
  const r = runParity(SCRIPT, reworded);
  ok(!r.ok, "a reworded slide fails");
  ok(/CHANGED wording/.test(r.problems[0] ?? ""), "it is reported as changed wording");
}
{
  const added = [...SLIDES, { n: 6, runs: [{ t: "Thanks for watching." }] }];
  const r = runParity(SCRIPT, added);
  ok(!r.ok, "an invented slide fails");
  ok(/ADDED to slides/.test(r.problems[0] ?? ""), "it is reported as added");
}

section("4. tokenizer");
ok(tokens("twenty-five").length === 1, "a hyphenated word stays one token");
ok(tokens("“smart quotes” and — dashes").join(" ") === 'smart quotes and - dashes', "smart punctuation normalizes");
ok(tokens("A.I., really?").join(" ") === "a.i really", "internal punctuation survives, edges are trimmed");

section("5. numbering");
{
  let threw = false;
  try {
    validateSlides([SLIDES[0], { ...SLIDES[2], n: 3 }]);
  } catch { threw = true; }
  ok(threw, "a gap in slide numbers raises");
  let threw2 = false;
  try { validateSlides(SLIDES); } catch { threw2 = true; }
  ok(!threw2, "a clean deck validates");
}

section("6. mechanical fallback never loses a word");
{
  // Mirrors authorDeck exactly: headers off, delivery cues off, THEN chunk. The chunker is
  // only ever handed already-stripped text and has no business stripping anything itself.
  const text = splitSections(SCRIPT)
    .sections.map((s) => stripDelivery(s.text).text)
    .join("\n\n");
  const chunked = mechanicalChunk(text).map((s, i) => ({ ...s, n: i + 1 }));
  const r = runParity(SCRIPT, chunked);
  ok(r.ok, "the plain chunker is verbatim");
  ok(chunked.length > 1, "it produced more than one slide");
  ok(chunked.every((s) => !s.visual), "it never invents a visual");
}

section("7. warnings");
{
  const midSentence: DeckSlide[] = [
    { n: 1, runs: [{ t: "If you own a med spa," }] },
    { n: 2, runs: [{ t: "this is our promise to you." }] },
  ];
  ok(deckWarnings(midSentence).some((w) => /mid-sentence/.test(w)), "a mid-sentence split is warned about");
  ok(!deckWarnings(SLIDES).some((w) => /mid-sentence/.test(w)), "a clean deck is not");
  const longSlide: DeckSlide[] = [{ n: 1, runs: [{ t: Array(60).fill("word").join(" ") }] }];
  ok(deckWarnings(longSlide).some((w) => /over 45 words/.test(w)), "an over-long slide is warned about");
  const thin: DeckSlide[] = Array.from({ length: 20 }, (_, i) => ({ n: i + 1, runs: [{ t: "A line." }] }));
  ok(deckWarnings(thin).some((w) => /1 in 4/.test(w)), "a deck with no visuals is warned about");
}

section("8. the trigger");
ok(isWebinarTrigger("webinar"), "bare keyword");
ok(isWebinarTrigger("Webinar: here is the script"), "case and punctuation");
ok(!isWebinarTrigger("we did a webinar last week"), "the word mid-sentence is not a trigger");
ok(stripTrigger("webinar\n\nHOOK\nLine one.") === "HOOK\nLine one.", "the keyword is stripped off the script");

section("9. the rendered pptx");
{
  const buf = await renderDeck(SLIDES, "Probe deck");
  ok(buf.length > 10_000, `renders (${buf.length} bytes)`);

  const zip = await JSZip.loadAsync(buf);
  const pres = await zip.file("ppt/presentation.xml")!.async("string");
  ok(/sldSz cx="12192000" cy="6858000"/.test(pres), "canonical 16:9 slide size");

  const slideXml = await Promise.all(
    SLIDES.map((_, i) => zip.file(`ppt/slides/slide${i + 1}.xml`)!.async("string"))
  );
  ok(slideXml.length === 5, "one slide part per slide");

  // The bug pptxgenjs will reintroduce the moment writeRuns changes: one <a:pPr> per <a:p>.
  let bad = 0;
  for (const xml of slideXml) {
    for (const para of xml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? []) {
      if ((para.match(/<a:pPr/g) ?? []).length > 1) bad++;
    }
  }
  ok(bad === 0, "never more than one <a:pPr> per paragraph (PowerPoint repair prompt)");

  ok(/6D28F9/.test(slideXml[1]), "purple emphasis run survives");
  ok(/111111/.test(slideXml[1]), "black runs survive alongside it");
  ok(/Arial Black/.test(slideXml[0]), "Arial Black is set");
  ok(/FFFFFF/.test(slideXml[0]), "white background is painted");
  ok(/F2F2F2/.test(slideXml[2]), "slide 3 has the gray image zone");
  ok(!/F2F2F2/.test(slideXml[0]), "slide 1 has no placeholder");

  const notes = await Promise.all(
    SLIDES.map((_, i) => zip.file(`ppt/notesSlides/notesSlide${i + 1}.xml`)!.async("string"))
  );
  ok(notes.every((n) => /VISUAL:/.test(n)), "every slide carries VISUAL: in its notes");
  ok(/PROMPT:/.test(notes[2]) && /SEARCH:/.test(notes[2]), "a visual slide carries PROMPT: and SEARCH:");
  ok(/\[pause\]/.test(notes[0]), "the delivery cue is in the notes");
  ok(!/pause/.test(slideXml[0]), "the delivery cue is NOT on the slide");
}

section("10. slide-plan.md");
{
  const plan = writePlan(SLIDES);
  ok((plan.match(/^\| \d{3} /gm) ?? []).length === 5, "one row per slide");
  ok(/black marker doodle/.test(plan), "the AI prompt is in the plan");
  ok(/HOOK \/ PROMISE \+ GUARANTEE/.test(plan), "the section is in the plan");
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
