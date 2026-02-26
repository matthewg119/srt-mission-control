import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "./db";

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

        // Auto-create default admin if no users exist
        const { count } = await supabaseAdmin
          .from("users")
          .select("*", { count: "exact", head: true });

        if (count === 0) {
          const hash = await bcrypt.hash("srt2026admin", 12);
          await supabaseAdmin.from("users").insert({
            email: "matthew@srtagency.com",
            password_hash: hash,
            name: "Matthew",
            role: "admin",
          });
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
