-- Taste and planning together.
--  * taste_signals: single places someone has been and how they felt (typed in, or imported from a
--    connected calendar, a Google Maps export, a pasted Resy list…). Optionally tied to a past trip.
--  * taste_profiles: the planner's summary of those signals (written by the server).
--  * connections: which outside accounts someone connected and when we last imported (no tokens kept).
--  * trip_members / trip_invites / trip_reactions: friends planning one trip together.
-- Additive: the drops below only replace this update's own policies and triggers.

-- ---------------------------------------------------------------------------
-- Taste signals
-- ---------------------------------------------------------------------------
create table if not exists public.taste_signals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  past_trip_id  uuid references public.past_trips (id) on delete cascade,
  source        text not null check (source in ('manual', 'google_calendar', 'ics', 'google_takeout', 'instagram', 'facebook', 'swarm', 'paste')),
  ref           text not null check (char_length(ref) between 1 and 200),
  kind          text not null check (kind in ('stay', 'food', 'drink', 'coffee', 'nightlife', 'sight', 'activity', 'shop', 'city')),
  name          text not null check (char_length(name) between 1 and 120),
  city          text check (char_length(city) <= 80),
  country_code  text check (country_code ~ '^[A-Z]{2}$'),
  lat           double precision check (lat between -90 and 90),
  lng           double precision check (lng between -180 and 180),
  visited_on    date,
  rating        smallint check (rating between 1 and 5),
  liked         boolean,
  note          text check (char_length(note) <= 280),
  url           text check (char_length(url) <= 500),
  created_at    timestamptz not null default now(),
  unique (user_id, source, ref)
);
create index if not exists taste_signals_user_idx on public.taste_signals (user_id, created_at desc);
create index if not exists taste_signals_trip_idx on public.taste_signals (past_trip_id) where past_trip_id is not null;

alter table public.taste_signals enable row level security;
drop policy if exists "own signals" on public.taste_signals;
create policy "own signals" on public.taste_signals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Taste profiles (server-written cache of the planner's read of someone's taste)
-- ---------------------------------------------------------------------------
create table if not exists public.taste_profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  inputs_hash  text not null,
  profile      jsonb not null,
  updated_at   timestamptz not null default now()
);
alter table public.taste_profiles enable row level security;
drop policy if exists "own taste profile" on public.taste_profiles;
create policy "own taste profile" on public.taste_profiles for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Connected accounts: status only. Imports are one-time reads; access tokens are never stored.
-- ---------------------------------------------------------------------------
create table if not exists public.connections (
  user_id          uuid not null references auth.users (id) on delete cascade,
  provider         text not null check (provider in ('google_calendar', 'instagram', 'facebook')),
  last_import_at   timestamptz,
  items_found      int not null default 0,
  created_at       timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.connections enable row level security;
drop policy if exists "own connections" on public.connections;
create policy "own connections" on public.connections for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Planning together
-- ---------------------------------------------------------------------------
create table if not exists public.trip_members (
  trip_id     uuid not null references public.trips (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  added_by    uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index if not exists trip_members_user_idx on public.trip_members (user_id, created_at desc);

create table if not exists public.trip_invites (
  token       text primary key check (token ~ '^[A-Za-z0-9_-]{20,64}$'),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  uses        int not null default 0
);
create index if not exists trip_invites_trip_idx on public.trip_invites (trip_id);

-- "I'm in" / "pass" on a stop (day-index) or a hotel (h-index), per person.
-- place_name pins the reaction to the place that was there, so a swapped stop starts fresh.
create table if not exists public.trip_reactions (
  trip_id     uuid not null references public.trips (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  item        text not null check (item ~ '^([0-9]{1,2}-[0-9]{1,2}|h-[0-9]{1,2})$'),
  place_name  text not null check (char_length(place_name) between 1 and 160),
  value       smallint not null check (value in (-1, 1)),
  updated_at  timestamptz not null default now(),
  primary key (trip_id, user_id, item)
);

-- Members and reactions are read and written by the app's server after it checks who is asking
-- (owner or member), so these tables have row-level security on and only narrow read policies.
alter table public.trip_members enable row level security;
alter table public.trip_invites enable row level security;
alter table public.trip_reactions enable row level security;

drop policy if exists "see own memberships" on public.trip_members;
create policy "see own memberships" on public.trip_members for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Trips are written by the app's server. Travelers can still save, rate and vote on their own
-- trips directly; the plan itself, visibility, sharing and like counts only change through the
-- server, which checks who is asking (the owner, or a friend planning the trip with them).
-- ---------------------------------------------------------------------------
revoke insert, update on public.trips from anon, authenticated;
grant update (saved, rating, votes) on public.trips to authenticated;

-- ---------------------------------------------------------------------------
-- Rate limits: one row per build, edit or import, recorded before the work starts, so parallel
-- requests count against each other. Server only.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_events (
  id          bigserial primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('build', 'edit', 'hotels', 'extract', 'taste', 'sample')),
  created_at  timestamptz not null default now()
);
create index if not exists rate_events_idx on public.rate_events (user_id, kind, created_at desc);
alter table public.rate_events enable row level security;

-- One-time setup steps the server has done (e.g. creating the Typeform intake), so they can't be
-- repeated by anyone calling the setup endpoint again. Server only.
create table if not exists public.app_flags (
  key         text primary key,
  value       text,
  created_at  timestamptz not null default now()
);
alter table public.app_flags enable row level security;
