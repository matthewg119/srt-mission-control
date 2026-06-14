// Shared text guards for generated reel copy.

// House rule: never use em dashes anywhere in generated copy. Replace with a
// comma (or collapse around existing punctuation) so grammar stays clean.
export function stripEmDashes(input: string): string {
  return input
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s*–\s*/g, ", ") // en dash too, just in case
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",");
}
