// The avatar's context, read out of its deep research by section. No model, no network.
//
// Matthew, 2026-09-15, on who fills an avatar's fears, desires, beliefs and the rest: "THIS WILL
// BE PER AVATAR / AUDIENCE, THE DEEP RESEARCH MUST PROVIDE". So nothing here infers a field. A
// section the research answered is present; a section it did not answer is missing, and the
// completeness card says so. A model summarising 40,000 characters into "fears" would produce a
// confident field that no source said, which is the exact thing the evidence gate exists to stop.
//
// ‼️ SECTIONS ARE FOUND BY THEIR NUMBER ON A HEADING LINE, NEVER BY A NUMBERED LIST ITEM. Section 7
// is "30+ verbatim phrases", and a research answer writes those as `1. "i'm so over this"`. A parser
// that took any line starting with a number would cut section 7 into thirty sections. So a section
// start must be a markdown heading (`## 7. ...`) or a line that is entirely bold (`**7. ...**`), and
// numbers must arrive in increasing order, which is how a list inside section 3 restarting at 1 is
// told apart from section 1.
//
// Measured on SRT's stored research (41,119 chars, the automatic run): `## 1.` through `## 8.`, with
// `###` subsections inside 4 and 5, then an unnumbered `## The twenty-five phrases, ranked`. The
// subsections belong to their parent, and the unnumbered heading ends section 8.

/** Characters a section needs, after its heading, to count as answered rather than as a stub. */
export const SECTION_MIN_CHARS = 150;

/** How many numbered sections a paste needs before it is treated as research rather than a fragment. */
export const FULL_RESEARCH_MIN_SECTIONS = 4;

const HEADING = /^[ \t]*(?:#{1,4}[ \t]*|\*\*[ \t]*)(?:section[ \t]+)?(\d{1,2})[.):][ \t]*(.*?)[ \t]*(?:\*\*)?[ \t]*$/i;
/** Any markdown heading at all, numbered or not. An unnumbered one ends the section above it. */
const ANY_HEADING = /^[ \t]*#{1,2}[ \t]+\S/;

export interface ResearchSection {
  number: number;
  title: string;
  /** The section's body, its subsections included, heading excluded. */
  body: string;
}

/**
 * Split a research answer into its numbered sections.
 *
 * A `###` subsection stays inside its section. An unnumbered `#` or `##` heading closes the section
 * above it (the ranked list at the end is not part of section 8). A number that does not increase is
 * body text, not a new section.
 */
export function parseResearchSections(text: string): ResearchSection[] {
  const numbered = parseNumberedSections(text);
  if (numbered.filter(sectionAnswered).length >= FULL_RESEARCH_MIN_SECTIONS) return numbered;
  // ‼️ A DEEP RESEARCH TOOL DOES NOT ALWAYS KEEP THE NUMBERS. SRT's own answer, 2026-09-15 (ChatGPT deep
  // research, dropped into step 11 as "Med Spa Owner Profile.txt"): every section present, every heading
  // plain text and unnumbered ("Current Solutions (DIY, Cheap, Nothing)", "Beliefs (True or False)").
  // Read by number alone it answered ZERO sections and was refused as a fragment. The names are the
  // fallback, used only when the numbers did not find a full answer, so a numbered paste reads exactly
  // as it always has.
  const named = parseNamedSections(text);
  return named.filter(sectionAnswered).length > numbered.filter(sectionAnswered).length ? named : numbered;
}

/**
 * What each section is called, in the order RESEARCH_SECTION_KEYS numbers them (section N is entry N-1).
 * test-onboarding-artifacts.ts asserts the keys match that list, so appending a section there without
 * naming it here fails the test instead of going unread.
 *
 * Most specific first within a line: "What Goes Wrong (Failures/Why They Quit)" must reach section 4,
 * not section 11's "victories and failures", which is why 11 needs "victor".
 */
export const SECTION_NAMES: ReadonlyArray<{ key: string; name: RegExp }> = [
  { key: "demographics", name: /\b(profile|who buys|demograph|who (they are|the buyer is)|buyer persona)/i },
  { key: "current_solutions", name: /\b(current solutions?|what they use|use now|existing solutions?|solutions they use|already (use|tried))/i },
  { key: "what_they_like", name: /\blike about|what (they|owners|buyers|customers) like/i },
  { key: "what_they_hate", name: /\b(goes wrong|why they quit|what they hate|problems with|complaints)/i },
  { key: "beliefs", name: /^(market |their |what they )?beliefs?\b(?! chain)|what they believe/i },
  { key: "external_forces", name: /\bblame|external forces/i },
  { key: "verbatim_language", name: /\b(own words|exact words|verbatim|in their words|their language)/i },
  { key: "headline_ideas", name: /\bheadlines?\b|subject lines?/i },
  { key: "keywords", name: /^keywords\b|search phrases/i },
  { key: "hopes_and_dreams", name: /\bhopes?\b|\bdreams?\b/i },
  { key: "victories_and_failures", name: /\bvictor/i },
  { key: "prejudices", name: /\bprejudice/i },
  { key: "horror_stories", name: /\bhorror/i },
  { key: "curiosity", name: /\bcuriosity|lost solutions|old solutions/i },
  { key: "corruption", name: /\bcorruption|ruined/i },
  { key: "awareness", name: /\bawareness\b/i },
  // ‼️ ANCHORED ON "emotional language", NOT ON "objections". The bare word appears in section 4's
  // complaints, in the offer dataset's own objections field and in half the framework headings, and
  // a loose pattern here would file one section's answer under another's key permanently.
  { key: "emotional_language", name: /\bemotional language|lenguaje emocional/i },
];

/**
 * A line that could be a heading when nothing marks it as one: short, not a sentence, not a quote, not a
 * list item, not a keyword row. A plain-text document has no other way to say "this is a heading".
 */
function plainHeading(line: string): string | null {
  const t = line
    .trim()
    .replace(/^#{1,4}\s*/, "")
    .replace(/^\*\*(.*)\*\*:?$/, "$1")
    .replace(/^(section\s+)?\d{1,2}[.):]\s*/i, "")
    .trim();
  if (!t || t.length > 90) return null;
  if (/[.!?]["”’]?$/.test(t) || /^["“‘'(\[]/.test(t) || /^[-*•]\s/.test(t) || t.includes("|")) return null;
  // "Algorithm/Competition: When organic leads fall, they assume..." is a labelled sentence, not a heading.
  if (/:\s*\S/.test(t)) return null;
  return t.replace(/:$/, "");
}

function parseNamedSections(text: string): ResearchSection[] {
  const lines = (text ?? "").split(/\r?\n/);
  const out: ResearchSection[] = [];
  const opened = new Set<number>();
  let current: { number: number; title: string; lines: string[] } | null = null;
  const close = () => {
    if (current) out.push({ number: current.number, title: current.title, body: current.lines.join("\n").trim() });
    current = null;
  };

  for (const line of lines) {
    const heading = plainHeading(line);
    const hit = heading ? SECTION_NAMES.findIndex((s) => s.name.test(heading)) : -1;
    const number = hit + 1;
    if (hit >= 0 && !opened.has(number)) {
      close();
      opened.add(number);
      current = { number, title: heading!, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  close();
  return out.sort((a, b) => a.number - b.number);
}

function parseNumberedSections(text: string): ResearchSection[] {
  const lines = (text ?? "").split(/\r?\n/);
  const out: ResearchSection[] = [];
  let current: { number: number; title: string; lines: string[] } | null = null;
  let last = 0;

  const close = () => {
    if (current) out.push({ number: current.number, title: current.title, body: current.lines.join("\n").trim() });
    current = null;
  };

  for (const line of lines) {
    const m = HEADING.exec(line);
    const n = m ? Number(m[1]) : NaN;
    if (m && n > last && n <= 20) {
      close();
      current = { number: n, title: (m[2] ?? "").replace(/\*+$/, "").trim(), lines: [] };
      last = n;
      continue;
    }
    // An unnumbered top-level heading ends the numbered run above it. A `###` does not.
    if (!m && current && ANY_HEADING.test(line)) {
      close();
      continue;
    }
    if (current) current.lines.push(line);
  }
  close();
  return out;
}

/**
 * True when a section actually says something.
 *
 * "could not verify" is the prompt's own instruction for an unsourced claim, so a section made of
 * nothing but that is an honest non-answer and counts as missing rather than as present.
 */
export function sectionAnswered(section: ResearchSection | undefined): boolean {
  if (!section) return false;
  const body = section.body.replace(/could not verify\.?/gi, "").replace(/\s+/g, " ").trim();
  return body.length >= SECTION_MIN_CHARS;
}

/** True when a paste is a research answer rather than a fragment of one, e.g. a KEYWORDS block alone. */
export function looksLikeFullResearch(text: string): boolean {
  return parseResearchSections(text).filter(sectionAnswered).length >= FULL_RESEARCH_MIN_SECTIONS;
}
