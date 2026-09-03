-- The onboarding call becomes a real calendar event with a real invite.
-- src/lib/onboarding2/calendar.ts, and the third state in the close machine in
-- src/app/api/onboarding2/chat/route.ts.
--
-- Additive and re-runnable: every statement is add-column-if-not-exists or a guarded constraint.
-- Nothing here is required for the funnel to work. With MS_CALENDAR_* unset the columns stay
-- null, the assistant asks the same questions, and the Slack card says NO INVITE HAS BEEN SENT
-- exactly as it does today.
--
-- ─────────────────────────────────────────────────────────────────────
-- ‼️ WHY THERE IS SUDDENLY A CLOCK TIME ON THIS ROW, WHEN scheduling.ts SPENT ITS WHOLE HEADER
-- EXPLAINING THAT THERE MUST NOT BE ONE.
--
-- The old rule was: a day and a half of it, never a clock time, because we do not know the
-- clinic's timezone and storing a fabricated hour as a timestamptz would make it
-- indistinguishable from a real booking to every later reader. That was correct while a HUMAN
-- settled the hour on the phone.
--
-- An invite makes the hour real, so the fix is not to keep hiding it: it is to stop fabricating
-- it. call_timezone is ASKED, with four buttons, and call_starts_at is computed from
-- (call_day, call_daypart, call_timezone) rather than assumed. The constraint below is what
-- keeps the old rule's intent alive: an instant may not exist on a row that cannot say which
-- zone it was computed in, because that is exactly the unreadable value the header warned about.
-- ─────────────────────────────────────────────────────────────────────

alter table public.onboarding2_leads add column if not exists call_timezone text;
alter table public.onboarding2_leads add column if not exists call_starts_at timestamptz;
alter table public.onboarding2_leads add column if not exists call_event_id text;
alter table public.onboarding2_leads add column if not exists call_invite_sent_at timestamptz;
alter table public.onboarding2_leads add column if not exists call_invite_error text;

-- IANA names only. An abbreviation ("EST") throws a RangeError in Intl and is ambiguous besides:
-- CST is Chicago here and Shanghai elsewhere. Four values, because those are the four chips.
alter table public.onboarding2_leads drop constraint if exists onboarding2_leads_call_tz_check;
alter table public.onboarding2_leads add constraint onboarding2_leads_call_tz_check
  check (call_timezone is null or call_timezone in (
    'America/New_York','America/Chicago','America/Denver','America/Los_Angeles'
  ));

-- ‼️ AN INSTANT WITHOUT A ZONE IS THE UNREADABLE ROW THE HEADER ABOVE IS ABOUT. A timestamptz
-- alone cannot tell a later reader whether 18:00Z was somebody's 2pm or somebody else's 11am,
-- and the difference is what the client agreed to.
alter table public.onboarding2_leads drop constraint if exists onboarding2_leads_call_start_zoned;
alter table public.onboarding2_leads add constraint onboarding2_leads_call_start_zoned
  check (call_starts_at is null or call_timezone is not null);

-- ‼️ A SENT-AT WITHOUT AN EVENT ID WOULD BE CLAIMING AN INVITE NOBODY CAN FIND. The card and the
-- board both read this as "an invite exists", so the id has to be on the row that says so.
alter table public.onboarding2_leads drop constraint if exists onboarding2_leads_call_invite_pair;
alter table public.onboarding2_leads add constraint onboarding2_leads_call_invite_pair
  check (call_invite_sent_at is null or call_event_id is not null);

-- ‼️ AN ERROR AND A SENT INVITE ARE MUTUALLY EXCLUSIVE, AND THE THIRD STATE IS BOTH NULL. That
-- third state is "we never tried", which is what every row has today and what every row will
-- keep having until MS_CALENDAR_* is set. Three states, not two, same discipline as MxVerdict
-- and site_signals: could-not-look is never recorded as nothing-is-there.
alter table public.onboarding2_leads drop constraint if exists onboarding2_leads_call_invite_xor;
alter table public.onboarding2_leads add constraint onboarding2_leads_call_invite_xor
  check (call_invite_sent_at is null or call_invite_error is null);

comment on column public.onboarding2_leads.call_timezone is
  'IANA zone the client tapped. Decides the hour on the invite AND what morning/afternoon means '
  'to them. SCHEDULING_TZ stays ours and still decides which DAYS are offered.';
comment on column public.onboarding2_leads.call_starts_at is
  'Computed from call_day + call_daypart + call_timezone by localToInstant(). Never assumed, and '
  'never present without call_timezone.';
comment on column public.onboarding2_leads.call_invite_error is
  'Set when Graph refused. Null with a null call_invite_sent_at means no attempt was made, which '
  'is the state of every row until MS_CALENDAR_* is configured.';
