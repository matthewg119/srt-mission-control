// Throwaway admin util: list users and (re)set a password to a known value.
//   bun run scripts/reset-password.ts                 → list users only
//   bun run scripts/reset-password.ts <email> <pass>  → reset that user's password
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "../src/lib/db";

async function main() {
  const [email, pass] = process.argv.slice(2);

  const { data: users, error } = await supabaseAdmin
    .from("users")
    .select("id, email, name, role, last_login")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("List failed:", error.message);
    process.exit(1);
  }
  console.log(`Users (${users?.length ?? 0}):`);
  for (const u of users ?? []) {
    console.log(`  ${u.email}  ·  ${u.name ?? "?"}  ·  ${u.role ?? "?"}  ·  last_login=${u.last_login ?? "never"}`);
  }

  if (!email || !pass) {
    console.log("\n(no email/password args — list only, nothing changed)");
    return;
  }

  const hash = await bcrypt.hash(pass, 12);
  const target = (users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (target) {
    const { error: upErr } = await supabaseAdmin
      .from("users")
      .update({ password_hash: hash, updated_at: new Date().toISOString() })
      .eq("id", target.id);
    if (upErr) {
      console.error("Update failed:", upErr.message);
      process.exit(1);
    }
    console.log(`\n✅ Password for ${target.email} set to: ${pass}`);
  } else {
    // Create a new admin user with this email/password.
    const { error: insErr } = await supabaseAdmin.from("users").insert({
      email,
      password_hash: hash,
      name: "Matthew",
      role: "admin",
    });
    if (insErr) {
      console.error("Insert failed:", insErr.message);
      process.exit(1);
    }
    console.log(`\n✅ Created admin ${email} with password: ${pass}`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
