-- Travel app: initial schema
-- Roles: traveler (default), local (can submit picks), curator (reviews picks, edits app defaults, sees insights), admin.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles & roles
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('traveler', 'local', 'curator', 'admin');

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         public.app_role not null default 'traveler',
  display_name text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.app_current_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'traveler'::public.app_role);
$$;

create or replace function public.is_curator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_current_role() in ('curator', 'admin');
$$;

create policy "read own profile" on public.profiles
  for select using (id = auth.uid() or public.is_curator());
-- Role changes are made by an admin in the Supabase dashboard / SQL editor, never by the app.
create policy "update own display name" on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = public.app_current_role());

-- ---------------------------------------------------------------------------
-- App-wide source defaults (single row)
-- ---------------------------------------------------------------------------
create table public.app_config (
  id               int primary key default 1 check (id = 1),
  weights          jsonb not null,
  blocked          text[] not null default '{}',
  always_feature   text not null default '',
  never_recommend  text not null default '',
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id)
);

alter table public.app_config enable row level security;

create policy "anyone reads app config" on public.app_config
  for select using (true);
create policy "curators update app config" on public.app_config
  for update using (public.is_curator()) with check (public.is_curator());

-- ---------------------------------------------------------------------------
-- Each traveler's personal source mix
-- ---------------------------------------------------------------------------
create table public.user_prefs (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  use_custom  boolean not null default false,
  weights     jsonb not null default '{}',
  blocked     text[] not null default '{}',
  updated_at  timestamptz not null default now()
);

alter table public.user_prefs enable row level security;

create policy "own prefs" on public.user_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Trips: every generated itinerary, private to its traveler
-- ---------------------------------------------------------------------------
create table public.trips (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  destination  text not null,
  title        text not null,
  request      jsonb not null,          -- full intake, including optional personal details
  weights      jsonb not null,          -- effective weights used
  blocked      text[] not null default '{}',
  custom_mix   boolean not null default false,
  itinerary    jsonb not null,          -- days, stops, hotels, notes (verified)
  saved        boolean not null default false,
  rating       smallint not null default 0 check (rating between 0 and 5),
  votes        jsonb not null default '{}', -- { "0-2": 1, "h-1": -1 }
  model        text
);

create index trips_user_created_idx on public.trips (user_id, created_at desc);

alter table public.trips enable row level security;

create policy "own trips" on public.trips
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Anonymized feedback: the training signal. Written only by the server
-- (service role). Holds no user id and none of the personal "about you" details.
-- Curators can read it; they cannot read trips, so rows are not traceable to people.
-- ---------------------------------------------------------------------------
create table public.trip_feedback (
  trip_id       uuid primary key references public.trips (id) on delete cascade,
  destination   text not null,
  days          smallint not null,
  party         text,
  age_band      text,
  budget        text,
  pace          text,
  interests     text[] not null default '{}',
  stay_styles   text[] not null default '{}',
  stay_price    text,
  custom_mix    boolean not null default false,
  weights       jsonb not null default '{}',
  rating        smallint not null default 0,
  saved         boolean not null default false,
  shares        jsonb not null default '{}',  -- share of picks per source
  source_votes  jsonb not null default '{}',  -- { source: { up, down } }
  hotel_votes   jsonb not null default '[]',  -- [ { style, vote } ]
  updated_at    timestamptz not null default now()
);

alter table public.trip_feedback enable row level security;

create policy "curators read feedback" on public.trip_feedback
  for select using (public.is_curator());

-- ---------------------------------------------------------------------------
-- Local picks: spots submitted by locals and hosts, reviewed by curators.
-- Approved picks are the first candidates the planner draws from.
-- ---------------------------------------------------------------------------
create table public.local_picks (
  id                   uuid primary key default gen_random_uuid(),
  city                 text not null,
  name                 text not null,
  neighborhood         text,
  category             text not null default 'food'
                         check (category in ('food', 'drink', 'culture', 'outdoors', 'shopping', 'nightlife', 'stay', 'other')),
  source               text not null default 'locals'
                         check (source in ('locals', 'hosts', 'press', 'indie', 'reviews', 'guidebooks', 'social')),
  note                 text,
  tags                 text[] not null default '{}',
  price_band           text,                 -- for stays: "Under $150" | "$150–300" | "$300–600" | "$600+"
  stay_style           text,                 -- for stays: Boutique | Design-led | ...
  google_place_id      text,
  expedia_property_id  text,                 -- enables live rates for this stay
  status               text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by         uuid references auth.users (id) on delete set null,
  reviewed_by          uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index local_picks_city_idx on public.local_picks (lower(city), status);

alter table public.local_picks enable row level security;

create policy "curators manage picks" on public.local_picks
  for all using (public.is_curator()) with check (public.is_curator());
create policy "locals read own picks" on public.local_picks
  for select using (submitted_by = auth.uid());
create policy "locals submit picks" on public.local_picks
  for insert with check (
    submitted_by = auth.uid()
    and status = 'pending'
    and public.app_current_role() in ('local', 'curator', 'admin')
  );

-- ---------------------------------------------------------------------------
-- Server-only cache of Google Places lookups (no client access)
-- ---------------------------------------------------------------------------
create table public.places_cache (
  key         text primary key,
  data        jsonb,
  fetched_at  timestamptz not null default now()
);

alter table public.places_cache enable row level security;
-- no policies: only the service role can read or write

-- ---------------------------------------------------------------------------
-- updated_at helpers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trips_touch before update on public.trips for each row execute function public.touch_updated_at();
create trigger prefs_touch before update on public.user_prefs for each row execute function public.touch_updated_at();
create trigger picks_touch before update on public.local_picks for each row execute function public.touch_updated_at();
create trigger config_touch before update on public.app_config for each row execute function public.touch_updated_at();
create trigger feedback_touch before update on public.trip_feedback for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Default source weights
-- ---------------------------------------------------------------------------
insert into public.app_config (id, weights, blocked, never_recommend)
values (
  1,
  '{"locals":10,"hosts":9,"press":7,"indie":5,"reviews":3,"guidebooks":3,"social":1,"sponsored":0}',
  '{sponsored}',
  E'Chain restaurants\nTourist-trap menus with photos'
)
on conflict (id) do nothing;
