// The tool registry: which interactive components a hub page may render.
//
// ‼️ DEFINITIONS ARE CODE, RUNS ARE ROWS. The same doctrine the workflow registries state.
// vertical_assets and client_assets say WHICH tool a client has and how it is themed;
// this says what a tool IS, and every entry is a component somebody read before it shipped.
//
// ‼️ A COMPONENT REGISTRY, NOT AN IFRAMED ARTIFACT, AND THE CHOICE IS NOT ABOUT CONVENIENCE.
// An iframe to an external artifact is an outside dependency on a page we are asking answer
// engines to trust: it cannot be read by a crawler, it cannot be themed with the client's
// own colours, and it fails on somebody else's deploy. A page whose whole purpose is to be
// cited cannot have its substance behind a frame.
//
// ‼️ client_pages.component_key IS A KEY INTO THIS FILE AND NEVER A PATH OR A URL. A column
// a renderer would resolve at runtime is a column that can name something nobody reviewed.
// Anything not in COMPONENT_KEYS renders nothing at all, deliberately: an unknown key is a
// page missing its tool, and that is a visible, fixable state. Rendering "something" for it
// would be the failure mode this registry exists to prevent.
//
// ‼️ EVERY STRING HERE IS DIGIT-FREE, the same rule post-formats.ts keeps and for the same
// reason: these labels reach the page-drafting prompt, whose validator refuses a number that
// appears nowhere in its inputs. Say "an N", never a numeral.

/** What a tool is, as the library and the drafter read it. */
export interface ToolComponent {
  key: string;
  label: string;
  /** Which vertical this was written for, or null when it is useful to anybody. */
  vertical: string | null;
  /** The one question a reader opens it holding. Becomes the page's `question` field. */
  answers: string;
  /** What she has to type in, in her own words. Mirrors the `tool` format's `inputs` field. */
  inputs: readonly string[];
  /** What it gives back. */
  output: string;
  /**
   * When it is wrong.
   *
   * ‼️ REQUIRED, AND RENDERED ON THE PAGE. A calculator with no stated limits is an estimate
   * a reader takes for a quote. Every tool here says where it stops being right, in its own
   * words, on the page, under the result.
   */
  limits: string;
}

export const TOOL_COMPONENTS: readonly ToolComponent[] = [
  {
    key: "business-days",
    label: "Business day counter",
    vertical: null,
    answers: "If I start today, what date does that land on in working days?",
    inputs: ["the date it starts", "how many working days"],
    output: "The date it lands on, and the day of the week.",
    limits:
      "It counts weekends out and knows nothing about public holidays, so a run that crosses one lands a day or more early.",
  },
  {
    key: "sessions-to-budget",
    label: "Sessions within a budget",
    vertical: null,
    answers: "How many sessions does my budget actually cover?",
    inputs: ["what one session costs", "what you have to spend"],
    output: "How many whole sessions that covers, and what is left over.",
    limits:
      "It divides one price into one budget. Packages, memberships and anything priced per area are a different sum.",
  },
] as const;

export const COMPONENT_KEYS: readonly string[] = TOOL_COMPONENTS.map((t) => t.key);

export function isComponentKey(v: unknown): v is string {
  return typeof v === "string" && COMPONENT_KEYS.includes(v);
}

export function getToolComponent(key: string | null | undefined): ToolComponent | null {
  if (!key) return null;
  return TOOL_COMPONENTS.find((t) => t.key === key) ?? null;
}

/** The tools worth offering a client in this vertical: theirs, plus the ones that suit anybody. */
export function toolsForVertical(vertical: string | null): readonly ToolComponent[] {
  const v = (vertical ?? "").trim().toLowerCase();
  return TOOL_COMPONENTS.filter((t) => t.vertical === null || (v !== "" && t.vertical.toLowerCase() === v));
}
