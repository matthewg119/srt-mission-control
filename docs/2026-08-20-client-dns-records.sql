-- The three DNS records, per client, tracked in Mission Control.
--
-- Safe to run more than once.
--
-- WHY A TABLE. The DNS conversation happens once, live on a call, with a non-technical
-- owner driving their own registrar. Everything about it therefore has to be in one place
-- before the call starts: the exact host, the exact value, and whether it has actually
-- resolved yet. Until now that lived in somebody's notes, which is how a client gets
-- asked to go back into GoDaddy a second time.
--
-- One row per record rather than columns on clients, for the same reason
-- client_delivery_steps is a table: three records today, and the moment a fourth is
-- needed (a second verification, a mail record, a redirect) it is a row rather than a
-- migration. Records hang off the client exactly as the phone hangs off the contact.
--
-- STATUS IS OBSERVED, NEVER ASSERTED. 'verified' is written by a resolver that actually
-- looked, never by a human ticking a box, because "I added it" and "it resolves" are
-- different facts and the gap between them is where a build stalls for a fortnight.

create extension if not exists pgcrypto;

create table if not exists public.client_dns_records (
  id            uuid        primary key default gen_random_uuid(),
  client_id     uuid        not null references public.clients(id) on delete cascade,

  -- Stable key: 'cname_hub', 'cname_reviews', 'txt_verify'. Display order and labels live
  -- in code (DNS_RECORDS in src/lib/clients/dns-records.ts) so wording can change without
  -- a migration and an existing row keeps its meaning.
  record_key    text        not null,

  record_type   text        not null,

  -- What goes in the registrar's Host / Name box. Stored as the LABEL ONLY ('learn',
  -- 'reviews', '@'), never the fully qualified name, because that is what every registrar
  -- actually wants and typing the full name is the single most common way this is got
  -- wrong: GoDaddy silently saves learn.clinic.com as learn.clinic.com.clinic.com.
  host          text        not null,

  -- What goes in the Value / Points to / Data box. Nullable because the TXT value comes
  -- from that client's own Search Console property and does not exist until somebody
  -- generates it.
  value         text,

  status        text        not null default 'pending',

  -- Written by the resolver, not by a person. See the note at the top.
  last_checked_at timestamptz,
  verified_at     timestamptz,

  -- What the resolver actually saw when it did not match. The useful half of a failure:
  -- "found cname.vercel-dns.com, expected 7932b6eb...vercel-dns-017.com" is diagnosable,
  -- "failed" is not.
  observed      text,

  note          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.client_dns_records
  drop constraint if exists client_dns_records_type_check;
alter table public.client_dns_records
  add constraint client_dns_records_type_check
  check (record_type in ('CNAME', 'TXT', 'A'));

-- pending   nothing entered yet
-- ready     we know the value, the client has not added it
-- added     they say they added it, the resolver has not confirmed
-- verified  the resolver saw it. The only status a machine may write
-- mismatch  something resolves, but not what we asked for
alter table public.client_dns_records
  drop constraint if exists client_dns_records_status_check;
alter table public.client_dns_records
  add constraint client_dns_records_status_check
  check (status in ('pending', 'ready', 'added', 'verified', 'mismatch'));

alter table public.client_dns_records
  drop constraint if exists client_dns_records_client_key;
alter table public.client_dns_records
  add constraint client_dns_records_client_key unique (client_id, record_key);

create index if not exists client_dns_records_client_idx
  on public.client_dns_records (client_id);

-- Where the domain's DNS is actually managed, resolved from the nameservers rather than
-- asked. "Who is your domain with" is a question a lot of owners cannot answer, and the
-- nameservers answer it for them: ns__.domaincontrol.com is GoDaddy, and so on. Stored so
-- the call checklist can name their registrar's screens instead of listing five.
alter table public.clients
  add column if not exists dns_provider text;

alter table public.clients
  add column if not exists dns_nameservers text[];

-- Service role bypasses RLS; enabling it with no policies blocks anon and breaks nothing.
alter table public.client_dns_records enable row level security;
