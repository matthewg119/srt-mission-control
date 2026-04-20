import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const ADMIN_EMAIL = process.argv[2] || "matthew@srtagency.com";
const NEW_PASSWORD = process.argv[3] || "srt2026admin";

async function main() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  console.log(`🔐 Resetting password for ${ADMIN_EMAIL}`);
  console.log(`   New password: ${NEW_PASSWORD}\n`);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: existing, error: lookupErr } = await supabase
    .from("users")
    .select("id, email, role")
    .eq("email", ADMIN_EMAIL)
    .maybeSingle();

  if (lookupErr) {
    console.error("❌ Supabase lookup failed:", lookupErr.message);
    if (lookupErr.code === "42P01") {
      console.error("   The 'users' table doesn't exist in this Supabase project.");
    }
    process.exit(1);
  }

  const hash = await bcrypt.hash(NEW_PASSWORD, 12);

  if (existing) {
    console.log(`✓ Found existing user: id=${existing.id}, role=${existing.role}`);
    const { error: updateErr } = await supabase
      .from("users")
      .update({ password_hash: hash, role: "admin" })
      .eq("id", existing.id);
    if (updateErr) {
      console.error("❌ Update failed:", updateErr.message);
      process.exit(1);
    }
    console.log(`✅ Password updated for ${ADMIN_EMAIL}\n`);
  } else {
    console.log(`→ No user row found. Creating one.`);
    const { error: insertErr } = await supabase.from("users").insert({
      email: ADMIN_EMAIL,
      password_hash: hash,
      name: ADMIN_EMAIL.split("@")[0],
      role: "admin",
    });
    if (insertErr) {
      console.error("❌ Insert failed:", insertErr.message);
      process.exit(1);
    }
    console.log(`✅ Admin user created: ${ADMIN_EMAIL}\n`);
  }

  console.log("→ Log in at http://localhost:3000/login with:");
  console.log(`   Email:    ${ADMIN_EMAIL}`);
  console.log(`   Password: ${NEW_PASSWORD}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
