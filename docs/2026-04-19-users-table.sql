-- Mission Control `users` table — required for NextAuth credentials login.
-- Paste into Supabase SQL editor for project gvsborqpkyvhcfrpgagp and click Run.
-- After running: go to http://localhost:3000/login and sign in with
--   matthew@srtagency.com / srt2026admin
-- The authorize() callback in src/lib/auth.ts will auto-create your admin row
-- on first login attempt since the table starts empty.

CREATE TABLE IF NOT EXISTS users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  name text,
  role text DEFAULT 'admin',
  avatar_url text,
  last_login timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
