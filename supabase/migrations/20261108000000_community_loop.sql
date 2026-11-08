-- The community loop: easier logging, payback for logging, friends as a source, and the privacy
-- controls that go with sharing more.
--  * past_trips: who can see each one, hiding its dates, and its place in your own ranking.
--  * taste_signals: their place in your own ranking; Gmail as an import source.
--  * rank_votes: "Which did you love more?" answers (your own past trips or your own places).
--  * trip_rank_votes: the same, for the stops of a trip planned together, after the trip.
--  * asks: "Ask Sara" questions about a city, and her answers (saved into the asker's trip).
--  * pick_credits: when a friend's picks helped someone (for "4 friends used your Lisbon list").
--  * push_tokens: phones to notify (a friend asked you something, a friend answered).
--  * trips.share_while_away: off by default, so followers only see a dated trip once it's over.
-- Additive and safe to run more than once.

-- ---------------------------------------------------------------------------
-- Past trips: visibility, hidden dates, ranking
-- ---------------------------------------------------------------------------
-- 'followers' matches what followers could already see (the places list on a profile). People who
-- had "Show my places to everyone" on keep their existing places public. This runs only when the
-- column is first added, so running the migration again never overrides a later choice.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'past_trips' and column_name = 'visibility'
  ) then
    alter table public.past_trips add column visibility text not null default 'followers';
    update public.past_trips p
       set visibility = 'public'
      from public.community_profiles c
     where c.user_id = p.user_id
       and c.places_public;
  end if;
end;
$$;
alter table public.past_trips drop constraint if exists past_trips_visibility_check;
alter table public.past_trips add constraint past_trips_visibility_check check (visibility in ('private', 'followers', 'public'));
-- Others see the city and what you loved, but not the year or month.
alter table public.past_trips add column if not exists hide_dates boolean not null default false;
-- Higher is better; worked out from rank_votes by the server. Null until it's been compared.
alter table public.past_trips add column if not exists rank_score real;

-- Whether others who may see the trip also see the places loved on it (its taste signals). Before
-- this, nobody but their owner could see those, so existing trips start with them hidden until the
-- owner sets that trip's visibility; trips logged from now on share them (default true).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'past_trips' and column_name = 'places_shared'
  ) then
    alter table public.past_trips add column places_shared boolean not null default false;
    alter table public.past_trips alter column places_shared set default true;
  end if;
end;
$$;

create index if not exists past_trips_city_idx on public.past_trips (city_key, user_id) where visibility <> 'private';

-- ---------------------------------------------------------------------------
-- Taste signals: ranking, Gmail
-- ---------------------------------------------------------------------------
alter table public.taste_signals add column if not exists rank_score real;
alter table public.taste_signals drop constraint if exists taste_signals_source_check;
alter table public.taste_signals add constraint taste_signals_source_check
  check (source in ('manual', 'google_calendar', 'ics', 'google_takeout', 'instagram', 'facebook', 'swarm', 'paste', 'gmail'));

alter table public.connections drop constraint if exists connections_provider_check;
alter table public.connections add constraint connections_provider_check
  check (provider in ('google_calendar', 'instagram', 'facebook', 'gmail'));

-- ---------------------------------------------------------------------------
-- "Which did you love more?" (your own trips or your own places)
-- ---------------------------------------------------------------------------
create table if not exists public.rank_votes (
  id          bigserial primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  item_kind   text not null check (item_kind in ('trip', 'place')),
  winner_id   uuid not null,
  loser_id    uuid not null,
  created_at  timestamptz not null default now(),
  constraint rank_votes_distinct check (winner_id <> loser_id)
);
create index if not exists rank_votes_user_idx on public.rank_votes (user_id, item_kind, created_at desc);

alter table public.rank_votes enable row level security;
drop policy if exists "read own rank votes" on public.rank_votes;
drop policy if exists "add own rank votes" on public.rank_votes;
drop policy if exists "remove own rank votes" on public.rank_votes;
create policy "read own rank votes" on public.rank_votes for select using (user_id = auth.uid());
-- Both items must be the voter's own rows.
create policy "add own rank votes" on public.rank_votes for insert with check (
  user_id = auth.uid()
  and (
    (item_kind = 'trip'
      and exists (select 1 from public.past_trips p where p.id = winner_id and p.user_id = auth.uid())
      and exists (select 1 from public.past_trips p where p.id = loser_id and p.user_id = auth.uid()))
    or
    (item_kind = 'place'
      and exists (select 1 from public.taste_signals s where s.id = winner_id and s.user_id = auth.uid())
      and exists (select 1 from public.taste_signals s where s.id = loser_id and s.user_id = auth.uid()))
  )
);
create policy "remove own rank votes" on public.rank_votes for delete using (user_id = auth.uid());
revoke update on public.rank_votes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ranking a trip planned together, after it (each person compares two of its stops or hotels)
-- Items use the same keys as trip_reactions ("0-2", "h-1"); names pin them to the place.
-- Written by the app's server after it checks the person is the owner or a member.
-- ---------------------------------------------------------------------------
create table if not exists public.trip_rank_votes (
  id           bigserial primary key,
  trip_id      uuid not null references public.trips (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  winner_item  text not null check (winner_item ~ '^([0-9]{1,2}-[0-9]{1,2}|h-[0-9]{1,2})$'),
  winner_name  text not null check (char_length(winner_name) between 1 and 160),
  loser_item   text not null check (loser_item ~ '^([0-9]{1,2}-[0-9]{1,2}|h-[0-9]{1,2})$'),
  loser_name   text not null check (char_length(loser_name) between 1 and 160),
  created_at   timestamptz not null default now(),
  constraint trip_rank_votes_distinct check (winner_item <> loser_item)
);
create index if not exists trip_rank_votes_trip_idx on public.trip_rank_votes (trip_id, created_at desc);
alter table public.trip_rank_votes enable row level security;
drop policy if exists "see own trip rank votes" on public.trip_rank_votes;
create policy "see own trip rank votes" on public.trip_rank_votes for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Ask a friend who's been
-- Only between friends (people who follow each other); checked by the app's server, which writes
-- every row. Each side can read the asks they're part of.
-- ---------------------------------------------------------------------------
create table if not exists public.asks (
  id             uuid primary key default gen_random_uuid(),
  asker_id       uuid not null references auth.users (id) on delete cascade,
  friend_id      uuid not null references auth.users (id) on delete cascade,
  city           text not null check (char_length(city) between 1 and 80),
  city_key       text not null,
  -- The asker's trip the answer is saved into (optional: you can ask before planning).
  trip_id        uuid references public.trips (id) on delete set null,
  question       text not null check (char_length(question) between 1 and 500),
  status         text not null default 'open' check (status in ('open', 'answered', 'declined')),
  answer         text not null default '' check (char_length(answer) <= 1500),
  -- [{ name, kind, note, mapsUrl? }], at most 12, validated by the server.
  answer_places  jsonb not null default '[]',
  created_at     timestamptz not null default now(),
  answered_at    timestamptz,
  asker_seen_at  timestamptz,
  constraint asks_not_self check (asker_id <> friend_id)
);
create index if not exists asks_friend_idx on public.asks (friend_id, status, created_at desc);
create index if not exists asks_asker_idx on public.asks (asker_id, created_at desc);
create index if not exists asks_trip_idx on public.asks (trip_id) where trip_id is not null;

alter table public.asks enable row level security;
drop policy if exists "see own asks" on public.asks;
create policy "see own asks" on public.asks for select using (asker_id = auth.uid() or friend_id = auth.uid());

-- ---------------------------------------------------------------------------
-- When someone's picks helped a friend: "Plan a trip like this" from their trip page, their picks
-- used in a friend's itinerary, or an answer to an ask. One row per owner, friend, kind and thing.
-- Written and read only by the app's server, which returns counts (rows name the friend and their trip).
-- ---------------------------------------------------------------------------
create table if not exists public.pick_credits (
  owner_id        uuid not null references auth.users (id) on delete cascade,
  beneficiary_id  uuid not null references auth.users (id) on delete cascade,
  kind            text not null check (kind in ('plan_like', 'itinerary', 'ask')),
  ref             text not null check (char_length(ref) between 1 and 80),
  city_key        text not null default '',
  created_at      timestamptz not null default now(),
  primary key (owner_id, beneficiary_id, kind, ref),
  constraint pick_credits_not_self check (owner_id <> beneficiary_id)
);
create index if not exists pick_credits_owner_idx on public.pick_credits (owner_id, created_at desc);
alter table public.pick_credits enable row level security;
drop policy if exists "see own credits" on public.pick_credits;

-- ---------------------------------------------------------------------------
-- Phones to notify (Expo push tokens). Each person manages their own.
-- ---------------------------------------------------------------------------
create table if not exists public.push_tokens (
  token       text primary key check (char_length(token) between 10 and 200),
  user_id     uuid not null references auth.users (id) on delete cascade,
  platform    text not null check (platform in ('ios', 'android')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
drop policy if exists "own push tokens" on public.push_tokens;
create policy "own push tokens" on public.push_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_real_user());

-- ---------------------------------------------------------------------------
-- Trips: share while away (off by default)
-- ---------------------------------------------------------------------------
alter table public.trips add column if not exists share_while_away boolean not null default false;

-- ---------------------------------------------------------------------------
-- Friends' planners may use your loved places (people who follow each other only). On for people
-- who join from now on; off for existing members until they turn it on, since nobody else could see
-- their places before. Off keeps your places out of friends' itineraries and "Friends who've been".
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'community_profiles' and column_name = 'picks_for_friends'
  ) then
    alter table public.community_profiles add column picks_for_friends boolean not null default false;
    alter table public.community_profiles alter column picks_for_friends set default true;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rate limits for the new actions
-- ---------------------------------------------------------------------------
alter table public.rate_events drop constraint if exists rate_events_kind_check;
alter table public.rate_events add constraint rate_events_kind_check
  check (kind in ('build', 'edit', 'hotels', 'extract', 'taste', 'sample', 'ask', 'gmail'));
