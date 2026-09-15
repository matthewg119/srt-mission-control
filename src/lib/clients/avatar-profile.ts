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
