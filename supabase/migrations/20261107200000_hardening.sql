-- Hardening: three gaps where people could write rows directly (with their own login, through the
-- database API) in ways the app itself never would. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Likes: add and remove only, and a recount.
--
-- "manage own likes" was FOR ALL, so it allowed UPDATE, while the trigger that keeps
-- trips.likes_count in step (and refuses likes on your own trip) only runs on INSERT and DELETE.
-- Moving a like row to another trip and deleting it there left the first trip's count one higher
-- each time, without limit, and could pull any other trip's count down. Likes are only ever added
-- or removed: separate select / insert / delete policies, and no UPDATE at all.
-- ---------------------------------------------------------------------------
drop policy if exists "manage own likes" on public.trip_likes;
drop policy if exists "read own likes" on public.trip_likes;
drop policy if exists "add own likes" on public.trip_likes;
drop policy if exists "remove own likes" on public.trip_likes;

create policy "read own likes" on public.trip_likes
  for select using (user_id = auth.uid());
create policy "add own likes" on public.trip_likes
  for insert with check (user_id = auth.uid() and public.is_real_user() and public.can_view_trip(trip_id));
create policy "remove own likes" on public.trip_likes
  for delete using (user_id = auth.uid());

revoke update on public.trip_likes from anon, authenticated;

-- A like moved onto the liker's own trip that way isn't a like (inserting one is refused): remove
-- them. Then recount every trip from the likes that are left (this also undoes any inflated or
-- deflated counts). Only trips whose count is wrong are touched.
delete from public.trip_likes l
 using public.trips t
 where t.id = l.trip_id
   and t.user_id = l.user_id;

with counts as (
  select t.id, count(l.trip_id)::int as n
    from public.trips t
    left join public.trip_likes l on l.trip_id = t.id
   group by t.id
)
update public.trips t
   set likes_count = c.n
  from counts c
 where c.id = t.id
   and t.likes_count <> c.n;

-- ---------------------------------------------------------------------------
-- 2. Reserved handles, refused by the database too.
--
-- The app refuses them (RESERVED in packages/core/src/community.ts: keep this list the same), but
-- people can write their own community_profiles row directly, so "pylos" or "admin" could be taken
-- that way. Added NOT VALID so a handle taken before this doesn't stop the migration; new and
-- changed rows are checked either way, and the constraint is validated at once when no existing
-- row breaks it. Otherwise, find them with
--   select user_id, handle from public.community_profiles
--    where handle in ('admin','pylos','ayoush','support','help','me','settings','community','official','staff','null','undefined');
-- rename them, then: alter table public.community_profiles validate constraint handle_not_reserved;
-- ---------------------------------------------------------------------------
alter table public.community_profiles drop constraint if exists handle_not_reserved;
alter table public.community_profiles
  add constraint handle_not_reserved
  check (handle not in ('admin', 'pylos', 'ayoush', 'support', 'help', 'me', 'settings', 'community', 'official', 'staff', 'null', 'undefined'))
  not valid;

do $$
begin
  if not exists (
    select 1 from public.community_profiles
     where handle in ('admin', 'pylos', 'ayoush', 'support', 'help', 'me', 'settings', 'community', 'official', 'staff', 'null', 'undefined')
  ) then
    alter table public.community_profiles validate constraint handle_not_reserved;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. "I took this trip": only for your own trips, once per person.
--
-- The past_trips policy only checked user_id, so a past trip could point at anyone's trip (trip ids
-- appear on community pages and profiles), and because trip_id was unique across everyone, that
-- stopped the trip's owner from logging it ("You've already logged this trip"). Links to other
-- people's trips are cleared, the policy checks the trip is the logger's own, and the uniqueness is
-- per person: (user_id, trip_id).
-- ---------------------------------------------------------------------------
update public.past_trips p
   set trip_id = null
 where p.trip_id is not null
   and not exists (select 1 from public.trips t where t.id = p.trip_id and t.user_id = p.user_id);

-- One person can't have two rows for the same trip under the old index either, but if two exist,
-- the earliest keeps the link so the new index can be built.
update public.past_trips p
   set trip_id = null
  from (
    select id, row_number() over (partition by user_id, trip_id order by created_at, id) as rn
      from public.past_trips
     where trip_id is not null
  ) d
 where d.id = p.id
   and d.rn > 1;

create unique index if not exists past_trips_user_trip_idx on public.past_trips (user_id, trip_id) where trip_id is not null;
drop index if exists public.past_trips_trip_idx;

drop policy if exists "own past trips" on public.past_trips;
create policy "own past trips" on public.past_trips
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (trip_id is null or exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()))
  );
