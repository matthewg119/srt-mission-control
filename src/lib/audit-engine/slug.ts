// Short, non-guessable public slugs for /r/[slug] report pages.

import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db";

const MAX_ATTEMPTS = 5;

export async function generateSlug(): Promise<string> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const candidate = crypto.randomBytes(6).toString("base64url");
    const { data } = await supabaseAdmin
      .from("audit_reports")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  throw new Error("Could not generate a unique slug after several attempts");
}
