-- Browse: cached sample itineraries for featured destinations, and "for you" picks.
-- Both are written only by the app's server (service role). Samples are public; picks are
-- readable only by their owner.

create table if not exists public.destination_samples (
  key         text primary key,
  itinerary   jsonb,
  status      text not null default 'pending' check (status in ('pending', 'generating', 'ready', 'failed')),
  error       text,
  started_at  timestamptz,
  updated_at  timestamptz not null default now()
);

alter table public.destination_samples enable row level security;

drop policy if exists "anyone reads samples" on public.destination_samples;
create policy "anyone reads samples" on public.destination_samples for select using (true);

drop trigger if exists destination_samples_touch on public.destination_samples;
create trigger destination_samples_touch before update on public.destination_samples
  for each row execute function public.touch_updated_at();

create table if not exists public.user_recs (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  places_hash text not null,
  picks       jsonb not null,
  created_at  timestamptz not null default now()
);

alter table public.user_recs enable row level security;

drop policy if exists "own recs" on public.user_recs;
create policy "own recs" on public.user_recs for select using (user_id = auth.uid());
