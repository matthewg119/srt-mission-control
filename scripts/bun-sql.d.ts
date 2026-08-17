/**
 * Minimal ambient types for the sliver of Bun's built-in SQL client that
 * scripts/db.ts uses.
 *
 * The alternative is a devDependency on @types/bun for one class in one script.
 * The app itself never imports "bun" — it runs on Node under Next — so the full
 * type package would be carried for a CLI helper. If anything else in this repo
 * starts using Bun-specific APIs, replace this file with @types/bun.
 */
declare module "bun" {
  export class SQL {
    constructor(url: string);
    /** Run a statement with no parameter binding. Returns the result rows. */
    unsafe(query: string): Promise<unknown>;
    end(): Promise<void>;
  }
}
