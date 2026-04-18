export function hasMetaAttributionServer(input: { fbc?: string | null; fbclid?: string | null }): boolean {
  return Boolean(input.fbc || input.fbclid);
}
