// The guards on the post-call email, as pure functions.
//
// Same rule as delivery-guards.ts, and for the same reason: a prose guard is not a guard. Anything
// stated in the prompt as a constraint is a suggestion; anything checked here is a fact.
//
// These read CALL NOTES, which are a different kind of input from a Loom transcript. A transcript is
// a record of what was SAID TO THE PROSPECT and is already delivered, so a hit there is information.
// Notes are what Matthew wrote to HIMSELF afterwards, mixing three things that must not be treated
// alike:
//
//   1. what the prospect said and wants          -> email material, the whole point
//   2. what Matthew promised to do               -> HIS to do, never email material, easy to lose
//   3. what the prospect asked for that we do not sell -> the gap that has to be visible before send
//
// The drafter cannot reliably keep those apart on its own, and the failure mode of getting it wrong
// is the worst kind: an email that quietly commits to work SRT does not do, or that silently drops a
// callback he promised on the phone.

/** A hit in the notes, with the line it came from so the flag can quote it. */
export interface NoteHit {
  /** The matched text, trimmed. */
  phrase: string;
  /** The whole line it appeared on, so a flag reads as something Matthew recognises writing. */
  line: string;
}

/** One line of notes, its own text, for quoting back. */
function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * One hit per `dedupeBy` key.
 *
 * "line" is right for commitments: two callbacks on two lines are two things he owes.
 * "phrase" is right for scope: notes circle the same subject for five lines while he thinks it
 * through, and five bullets saying "he asked about ads" is a flag block nobody reads to the end.
 */
function hitsFor(text: string, patterns: RegExp[], dedupeBy: "line" | "phrase" = "line"): NoteHit[] {
  const hits: NoteHit[] = [];
  const seen = new Set<string>();

  for (const line of linesOf(text)) {
    for (const pattern of patterns) {
      const m = line.match(pattern);
      if (!m) continue;
      const phrase = m[0].trim();
      const key = (dedupeBy === "phrase" ? phrase : line).toLowerCase();
      if (seen.has(key)) break;
      seen.add(key);
      hits.push({ phrase, line: line.slice(0, 200) });
      break;
    }
  }
  return hits;
}

// ── What Matthew owes them ──────────────────────────────────────────────────

/**
 * A callback, a call-me-back, or a date he agreed to.
 *
 * Bilingual because the notes are (`regresa sabado 22 quiere que lo llame` is a real line from a
 * real thread). Days and months are matched in both languages, unaccented forms included, because
 * notes typed fast on a phone do not carry accents.
 *
 * ‼️ THIS IS NEVER EMAIL CONTENT. A promise to call on Saturday belongs to Matthew's calendar, and
 * an email that says "as I mentioned I will call you Saturday" is a commitment made by a drafter
 * rather than by a person. It is surfaced in Slack so he sees the thing he owes, and the drafter is
 * told separately not to write it.
 */
const CALLBACK_PATTERNS: RegExp[] = [
  // Spanish: quiere que lo llame / queria que le llame / pidio que lo llamara.
  // Accented letters are written as classes so a note typed without accents still matches, which
  // is most of them.
  /\bqu(?:iere|er[ií]a)\s+que\s+(?:lo|le|me)\s+llam\w*/i,
  /\bpid\w*\s+que\s+(?:lo|le)\s+llam\w*/i,
  /\b(?:lo|le)\s+llamo\s+(?:el|la|este|pr[oó]ximo)\b/i,
  /\bvolver\s+a\s+llamar\b/i,
  /\bregresa\b[^.\n]{0,40}\b(?:lun|mar|mi[eé]rc|jue|vier|s[aá]b|dom)\w*/i,
  /\bregresa\s+(?:el\s+)?\d{1,2}\b/i,
  // English
  /\bcall\s+(?:him|her|them|me)\s+back\b/i,
  /\bcall\s*back\b/i,
  /\bcalls?\s+(?:him|her|them)\s+(?:on|next|this)\b/i,
  /\b(?:wants|asked)\s+(?:me\s+)?(?:a\s+)?(?:to\s+)?call\b/i,
  /\bfollow(?:ing)?\s*up\s+(?:on|by)\s+(?:mon|tue|wed|thu|fri|sat|sun)\w*/i,
  // A bare weekday or date sitting on its own is a commitment often enough to be worth showing.
  /\b(?:back|returns?|regresa)\b[^.\n]{0,30}\b\d{1,2}\s*(?:de\s+)?(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic|jan|apr|aug|dec)\w*/i,
];

export function callbackCommitments(notes: string): NoteHit[] {
  return hitsFor(notes, CALLBACK_PATTERNS);
}

// ── What they asked for that we do not sell ─────────────────────────────────

/**
 * Work outside the two tiers: advertising, hiring, staffing, recruiting, web builds.
 *
 * SRT sells AI visibility on two tiers and nothing else. A prospect on the phone asks for adjacent
 * things constantly, and the honest move is not to refuse them in the email, it is to notice the
 * gap: sometimes the SAME work genuinely serves the ask, and saying so is the strongest angle there
 * is. The live case: a prospect wanted help hiring technicians, not customers, and the answer was
 * that the questions we optimise for do not have to be buying questions. That is a reposition, and
 * it is legitimate. Promising to run his job ads is not.
 *
 * So this flags rather than blocks, and the drafter is given the same list with the rule attached.
 */
const OUT_OF_SCOPE_PATTERNS: RegExp[] = [
  /\b(?:ads?|advertising|ad\s+spend|ad\s+campaigns?|google\s+ads|meta\s+ads|facebook\s+ads)\b/i,
  /\banuncios?\b|\bpublicidad\b|\bcampañas?\s+de\s+anuncios\b/i,
  /\b(?:hiring|recruiting|recruitment|staffing|headhunt\w*)\b/i,
  /\b(?:contratar|reclutar|reclutamiento|talento)\b/i,
  // "personal" is Spanish for staff and English for private, so a bare match flags "his personal
  // cell". A quantifier in front of it is what makes it the staffing sense.
  /\b(?:mas|m[aá]s|falta|falt[ao]n|necesita|contratar|conseguir)\s+personal\b/i,
  /\b(?:social\s+media\s+management|posting\s+for\s+them|run\s+their\s+socials?)\b/i,
  /\b(?:build|rebuild|redo)\s+(?:them\s+)?(?:a\s+)?(?:new\s+)?(?:website|site)\b/i,
];

export function outOfScopeAsks(notes: string): NoteHit[] {
  return hitsFor(notes, OUT_OF_SCOPE_PATTERNS, "phrase");
}

// ── Is this actually call notes? ────────────────────────────────────────────

/** Below this it is an instruction to the thread, not a record of a conversation. */
export const MIN_NOTES_CHARS = 180;
/** Notes are a list. One paragraph, however long, is somebody talking to the assistant. */
export const MIN_NOTES_LINES = 3;

export interface NotesCheck {
  ok: boolean;
  /** Why it was not treated as notes. Null when ok. Not posted: this branch stays silent on a miss. */
  reason: string | null;
  lines: number;
}

/**
 * Deliberately mechanical, exactly like looksLikeTranscript, and for a sharper reason.
 *
 * This gate decides whether a message is ROUTED AWAY from the reasoning agent. Every free-text reply
 * in an audit thread that is not an exact command reaches that agent, which is the behaviour that
 * fixed six wrong answers in a row on a live thread. Anything that steals messages from it has to be
 * something a model could not talk itself into, or the old failure comes back wearing a new name.
 *
 * Three signals, all cheap and all structural:
 *   - LENGTH. A revision ("tighter, drop the score line") is short.
 *   - SHAPE. Notes are jotted lines. Prose to the assistant is a paragraph.
 *   - ADDRESSEE. A message with an @mention is already addressed to the agent by design, so it is
 *     never notes no matter what it looks like. This is the escape hatch, and it is why a misroute
 *     costs one retyped message rather than a lost capability.
 *
 * Not checked here: whether a Loom transcript would pass. It would, easily. The router calls
 * looksLikeTranscript FIRST and returns on it, so a transcript can never reach this function.
 * Keeping the check out of here means one owner for that decision instead of two that can disagree.
 */
export function looksLikeCallNotes(text: string): NotesCheck {
  const lines = linesOf(text).length;

  if (/<@[UW][A-Z0-9]+>/.test(text)) {
    return { ok: false, reason: "addressed to the assistant", lines };
  }
  if (text.trim().length < MIN_NOTES_CHARS) {
    return { ok: false, reason: "too short to be notes", lines };
  }
  if (lines < MIN_NOTES_LINES) {
    return { ok: false, reason: "one block of prose, not jotted lines", lines };
  }
  return { ok: true, reason: null, lines };
}
