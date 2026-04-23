/** Zoho Lead Stage — free-form string as returned by Zoho. Validated at the
 *  handler layer (stage-handler.ts), never by TypeScript enum. Display-only
 *  stage metadata lives in `@/config/stage-display`. */
export type ZohoStage = string;
