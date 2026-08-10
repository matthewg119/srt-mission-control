/**
 * SRT Call Coach — which language is this call actually in.
 *
 * Matthew's calls drift into Spanish and back mid-sentence, and the coach has to follow. A prompt
 * line alone does not survive that: one English sentence dropped into a Spanish call flips the
 * model back to English and it stays there. So the decision is made HERE, in code, off what has
 * actually been said, and handed to the model as a fact rather than something to notice.
 *
 * Same precedent as `delivery-guards.ts` and `robots-check.ts` in the audit engine: a prose guard
 * is not a guard. Pure functions, no I/O, so this is testable without a call.
 */

export type CallLanguage = "en" | "es" | "mixed";

/**
 * Function words that appear constantly in one language and essentially never in the other.
 *
 * Deliberately NOT exhaustive vocabularies. Words that exist in both spellings are excluded
 * outright rather than assigned to a side: "no", "me", "son", "van", "solo" and "a" are all
 * common in both, and counting them for either language is how a scorer starts hallucinating
 * Spanish into an English call.
 */
const ES_MARKERS = new Set([
  "que", "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas",
  "y", "pero", "porque", "como", "cuando", "donde", "muy", "más", "mas", "ya",
  "para", "por", "con", "sin", "al", "es", "está", "esta", "están", "estan",
  "estoy", "estamos", "era", "fue", "ser", "estar", "tengo", "tiene", "tienen",
  "tenemos", "hay", "hace", "hacer", "puedo", "puede", "pueden", "quiero",
  "quiere", "necesito", "necesita", "vamos", "voy", "sé", "sabe", "nos", "les",
  "lo", "le", "se", "su", "sus", "mi", "mis", "tu", "te", "nada", "nadie",
  "algo", "alguien", "todo", "todos", "toda", "todas", "este", "esto", "eso",
  "esa", "ese", "aquí", "aqui", "allí", "alli", "ahora", "entonces", "también",
  "tambien", "siempre", "nunca", "bien", "mucho", "mucha", "poco", "gracias",
  "señor", "usted", "ustedes", "nosotros", "ellos", "ella", "él", "yo",
  "negocio", "negocios", "cliente", "clientes", "dinero", "gente", "trabajo",
  "empresa", "verdad", "cosa", "cosas", "hola", "sí",
]);

const EN_MARKERS = new Set([
  "the", "and", "is", "are", "was", "were", "be", "been", "of", "to", "in",
  "on", "at", "for", "with", "from", "that", "this", "these", "those", "it",
  "its", "i", "you", "your", "we", "our", "they", "their", "he", "she", "but",
  "because", "what", "when", "where", "how", "why", "who", "do", "does", "did",
  "can", "could", "would", "should", "will", "want", "need", "have", "has",
  "had", "get", "got", "going", "know", "think", "right", "yeah", "okay",
  "just", "really", "about", "out", "up", "so", "if", "not", "my", "like",
  "sure", "thanks", "business", "customers", "money", "people", "work",
]);

/** ñ, accented vowels and inverted punctuation. Nothing else in the pipeline produces these. */
const ES_ORTHOGRAPHY = /[ñáéíóúü¿¡]/gi;

/**
 * Below this many total marker hits there is not enough signal to call it, so we do not.
 * "Hello?" and "yeah" open most calls and mean nothing about the language of the rest.
 */
const MIN_SIGNAL = 6;

/** How lopsided the count has to be before it is one language rather than both. */
const DOMINANT_RATIO = 0.7;

export interface LanguageTurn {
  text?: string | null;
}

/**
 * Score the recent conversation and name its language.
 *
 * Defaults to "en" on thin evidence rather than "mixed": English is the norm on these calls, and a
 * wrong "mixed" tells the model to start sprinkling Spanish at a prospect who never spoke a word
 * of it, which is a worse failure than being slightly late to switch.
 */
export function detectCallLanguage(turns: LanguageTurn[] | undefined | null): CallLanguage {
  if (!Array.isArray(turns) || turns.length === 0) return "en";

  const blob = turns
    .map((t) => (typeof t?.text === "string" ? t.text : ""))
    .join(" ")
    .toLowerCase();

  if (!blob.trim()) return "en";

  let es = 0;
  let en = 0;

  for (const token of blob.split(/[^a-zA-ZÀ-ÿñÑ]+/)) {
    if (!token) continue;
    if (ES_MARKERS.has(token)) es++;
    else if (EN_MARKERS.has(token)) en++;
  }

  // Orthography is a much stronger signal than any single function word: an English transcript
  // does not contain "ñ" by accident, while "de" shows up in names.
  es += (blob.match(ES_ORTHOGRAPHY)?.length ?? 0) * 2;

  const total = es + en;
  if (total < MIN_SIGNAL) return "en";

  const esShare = es / total;
  if (esShare >= DOMINANT_RATIO) return "es";
  if (esShare <= 1 - DOMINANT_RATIO) return "en";
  return "mixed";
}

/**
 * The line handed to the model. Kept next to the detector so the two cannot drift apart.
 *
 * The no-voseo rule is not pedantry: a live run came back with "cuando alguien busca lo que vos
 * hacés" and "cuando decís". These prospects are US Hispanic business owners, overwhelmingly
 * Mexican and Caribbean Spanish, and Río de la Plata conjugations read as a foreigner reading off
 * a card. Matthew is speaking this out loud, so the register has to be invisible.
 */
const NEUTRAL_ES = "Usa español latinoamericano neutro (tú o usted). NUNCA voseo: nada de vos, decís, tenés, querés, hacés.";

export function languageDirective(lang: CallLanguage): string {
  switch (lang) {
    case "es":
      return `CALL LANGUAGE: es. Responde SOLO en español, incluyendo las etiquetas de categoría y los nombres de las continuaciones. ${NEUTRAL_ES}`;
    case "mixed":
      return `CALL LANGUAGE: mixed. The call is running in Spanglish. Write the way it actually sounds, switching where he would switch. Do not translate it into formal Spanish and do not force it back into English. For the Spanish half: ${NEUTRAL_ES}`;
    default:
      return "CALL LANGUAGE: en.";
  }
}
