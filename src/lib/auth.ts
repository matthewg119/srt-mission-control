import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "./db";

/** Cheap existence check, so an empty table fails loudly instead of minting an admin. */
async function usersExist(): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("users")
    .select("id", { count: "exact", head: true });
  return (count ?? 0) > 0;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email as string;
        const password = credentials.password as string;

        // ‼️ THE AUTO-CREATED ADMIN IS GONE, AND ON PURPOSE.
        //
        // This used to insert matthew@srtagency.com with a HARDCODED password whenever the
        // users table was empty. It was written as a convenience for the first boot and it
        // is a live credential in production source: anyone who can read this repo, or who
        // can empty that table, gets an admin account with a password they already know.
        //
        // The first user is seeded deliberately instead:
        //   bun run scripts/seed-admin.ts --email=you@example.com
        //
        // If the table is empty, every login now fails and says so in the log, which is the
        // correct behaviour for an internal tool holding client records.
        if (!(await usersExist())) {
          console.error(
            "[auth] The users table is empty. Nobody can sign in. " +
              "Seed one: bun run scripts/seed-admin.ts --email=you@example.com"
          );
          return null;
        }

        // Look up user
        const { data: user, error } = await supabaseAdmin
          .from("users")
          .select("*")
          .eq("email", email)
          .single();

        if (error || !user) return null;

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) return null;

        // Update last_login
        await supabaseAdmin
          .from("users")
          .update({ last_login: new Date().toISOString() })
          .eq("id", user.id);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          image: user.avatar_url,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as unknown as Record<string, unknown>).role as string;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as unknown as Record<string, unknown>).id = token.id;
        (session.user as unknown as Record<string, unknown>).role = token.role;
      }
      return session;
    },
  },
});
