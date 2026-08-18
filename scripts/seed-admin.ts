/**
 * Create or reset one dashboard user.
 *
 *   bun run scripts/seed-admin.ts --email=you@example.com
 *   bun run scripts/seed-admin.ts --email=you@example.com --password='...'
 *
 * WHY THIS EXISTS. src/lib/auth.ts used to auto-create matthew@srtagency.com with a
 * hardcoded password whenever the users table was empty. That is a live credential in
 * source: anyone who can read the repo, or who can empty that table, gets an admin account
 * with a password they already know. It has been removed, so the first user is seeded here,
 * deliberately, by somebody who meant to.
 *
 * With no --password it generates one and prints it ONCE. It is never stored anywhere but
 * the bcrypt hash, so if you lose it, run this again.
 */

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/db";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const email = args.find((a) => a.startsWith("--email="))?.slice("--email=".length)?.trim().toLowerCase();
  const given = args.find((a) => a.startsWith("--password="))?.slice("--password=".length);

  if (!email || !email.includes("@")) {
    console.error("Need --email=you@example.com");
    process.exit(1);
  }

  // 18 random bytes as base64url: long enough that nobody is brute forcing it, short enough
  // to retype off a screen once.
  const password = given || randomBytes(18).toString("base64url");
  const hash = await bcrypt.hash(password, 12);

  const { data: existing } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    const { error } = await supabaseAdmin
      .from("users")
      .update({ password_hash: hash })
      .eq("id", existing.id as string);
    if (error) throw new Error(error.message);
    console.log(`Reset the password for ${email}.`);
  } else {
    const { error } = await supabaseAdmin
      .from("users")
      .insert({ email, password_hash: hash, name: email.split("@")[0], role: "admin" });
    if (error) throw new Error(error.message);
    console.log(`Created ${email}.`);
  }

  if (!given) {
    console.log(`\n  Password: ${password}\n`);
    console.log("Shown once. Only the bcrypt hash is stored. Re-run this if you lose it.");
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
