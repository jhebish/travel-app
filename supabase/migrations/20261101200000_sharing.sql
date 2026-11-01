-- Shareable trip links.
-- A trip is public only while `shared` is true; the token is random and unguessable.
-- Public pages are served by the app's server (service role), which strips personal details.
alter table public.trips add column if not exists shared boolean not null default false;
alter table public.trips add column if not exists share_token text;
create unique index if not exists trips_share_token_idx on public.trips (share_token) where share_token is not null;
