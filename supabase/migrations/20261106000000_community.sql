-- Community: public profiles, follows, trip visibility, likes, and the places people have been.
--
-- Privacy model
--  * Joining is opt-in: a user appears in the community only after creating a community profile
--    (handle + name). Guest (anonymous) accounts can't create one.
--  * Each trip has a visibility: private (default) | followers | public.
--  * Other people's trips and places are served by the app's server (service role), which checks
--    visibility and strips personal details (the "about you" answers, notes, dates, source mix).
--    Row-level security below only ever lets people touch their own rows.

-- ---------------------------------------------------------------------------
-- Community profiles
-- ---------------------------------------------------------------------------
create table if not exists public.community_profiles (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  handle             text not null,
  display_name       text not null,
  home_city          text not null default '',
  bio                text not null default '',
  -- Applied to trips created after joining; each trip can still be changed.
  default_visibility text not null default 'followers' check (default_visibility in ('private', 'followers', 'public')),
  -- Whether people who aren't followers can see the list of places (counts are always shown).
  places_public      boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint handle_format check (handle ~ '^[a-z0-9_]{3,24}$'),
  constraint name_len check (char_length(display_name) between 1 and 60),
  constraint city_len check (char_length(home_city) <= 80),
  constraint bio_len check (char_length(bio) <= 280)
);
create unique index if not exists community_profiles_handle_idx on public.community_profiles (handle);

alter table public.community_profiles enable row level security;

create or replace function public.is_real_user()
returns boolean
language sql
stable
as $$
  select auth.uid() is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

drop policy if exists "own community profile" on public.community_profiles;
create policy "own community profile" on public.community_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_real_user());

drop trigger if exists community_profiles_touch on public.community_profiles;
create trigger community_profiles_touch before update on public.community_profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Follows (one-way, like most social apps)
-- ---------------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  followee_id uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint no_self_follow check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows (followee_id);

alter table public.follows enable row level security;

drop policy if exists "manage own follows" on public.follows;
create policy "manage own follows" on public.follows
  for all using (follower_id = auth.uid())
  with check (
    follower_id = auth.uid()
    and public.is_real_user()
    and exists (select 1 from public.community_profiles p where p.user_id = followee_id)
  );

-- ---------------------------------------------------------------------------
-- Trips: visibility, a normalized city key, likes
-- ---------------------------------------------------------------------------
alter table public.trips add column if not exists visibility text not null default 'private';
alter table public.trips drop constraint if exists trips_visibility_check;
alter table public.trips add constraint trips_visibility_check check (visibility in ('private', 'followers', 'public'));
alter table public.trips add column if not exists city_key text;
alter table public.trips add column if not exists likes_count int not null default 0;

-- "Lisbon, Portugal" -> "lisbon". The app computes the same key (and strips accents) on insert.
update public.trips
   set city_key = lower(regexp_replace(trim(split_part(destination, ',', 1)), '\s+', ' ', 'g'))
 where city_key is null;

create index if not exists trips_public_city_idx on public.trips (city_key, likes_count desc, rating desc) where visibility = 'public';
create index if not exists trips_visible_user_idx on public.trips (user_id, created_at desc) where visibility <> 'private';

-- Can the current user see this trip? (owner, public, or followers-only and they follow the owner)
create or replace function public.can_view_trip(t uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trips tr
     where tr.id = t
       and (
         tr.user_id = auth.uid()
         or tr.visibility = 'public'
         or (tr.visibility = 'followers' and exists (
               select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = tr.user_id))
       )
  );
$$;

create table if not exists public.trip_likes (
  user_id    uuid not null references auth.users (id) on delete cascade,
  trip_id    uuid not null references public.trips (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, trip_id)
);
create index if not exists trip_likes_trip_idx on public.trip_likes (trip_id);

alter table public.trip_likes enable row level security;

drop policy if exists "manage own likes" on public.trip_likes;
create policy "manage own likes" on public.trip_likes
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_real_user() and public.can_view_trip(trip_id));

-- Keep trips.likes_count in step with trip_likes (people can't like their own trips).
create or replace function public.sync_trip_likes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.trips where id = new.trip_id and user_id = new.user_id) then
      raise exception 'You can''t like your own trip';
    end if;
    update public.trips set likes_count = likes_count + 1 where id = new.trip_id;
    return new;
  else
    update public.trips set likes_count = greatest(0, likes_count - 1) where id = old.trip_id;
    return old;
  end if;
end;
$$;

drop trigger if exists trip_likes_sync on public.trip_likes;
create trigger trip_likes_sync after insert or delete on public.trip_likes
  for each row execute function public.sync_trip_likes();

-- ---------------------------------------------------------------------------
-- Places I've been (travel history; also feeds the planner)
-- ---------------------------------------------------------------------------
create table if not exists public.past_trips (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  city         text not null check (char_length(city) between 1 and 80),
  city_key     text not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  year         int check (year between 1950 and 2100),
  month        int check (month between 1 and 12),
  days         int check (days between 1 and 365),
  rating       smallint check (rating between 1 and 5),
  highlights   text not null default '' check (char_length(highlights) <= 500),
  -- Set when it was logged from an Ayoush trip ("I took this trip").
  trip_id      uuid references public.trips (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists past_trips_user_idx on public.past_trips (user_id, year desc nulls last);
create unique index if not exists past_trips_trip_idx on public.past_trips (trip_id) where trip_id is not null;

alter table public.past_trips enable row level security;

drop policy if exists "own past trips" on public.past_trips;
create policy "own past trips" on public.past_trips
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
