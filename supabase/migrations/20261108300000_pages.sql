-- Share only after you're home: the database's own check for who can see (and so like) a trip now
-- matches the app's. A planned trip with dates is hidden from everyone but its owner until the day
-- after it ends (in the last time zone to reach that day, UTC-12), unless the owner turned on
-- "Share while I'm away" (trips.share_while_away, from 20261108000000_community_loop.sql).
-- Trips without dates are unaffected. Run after the community loop migration. Safe to run more than once.

-- Is this trip over? request.startDate (YYYY-MM-DD) plus request.days. A start date that can't be
-- read counts as no date, the same as the app (packages/core/src/privacy.ts).
create or replace function public.trip_is_over(request jsonb)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  start_text text := request->>'startDate';
  days_text  text := request->>'days';
  y int;
  m int;
  d int;
  n int := 1;
begin
  if start_text is null or start_text !~ '^\d{4}-\d{2}-\d{2}$' then
    return true;
  end if;
  y := substr(start_text, 1, 4)::int;
  m := substr(start_text, 6, 2)::int;
  d := substr(start_text, 9, 2)::int;
  if y < 1900 or m not between 1 and 12 or d not between 1 and 31 then
    return true;
  end if;
  if days_text ~ '^\d{1,3}$' and days_text::int >= 1 then
    n := days_text::int;
  end if;
  -- make_date(y, m, 1) + (d - 1) rolls 31 April over to 1 May, as the app does.
  return (now() at time zone 'Etc/GMT+12')::date >= make_date(y, m, 1) + (d - 1) + n;
end;
$$;

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
         or (
           (tr.share_while_away or public.trip_is_over(tr.request))
           and (
             tr.visibility = 'public'
             or (tr.visibility = 'followers' and exists (
                   select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = tr.user_id))
           )
         )
       )
  );
$$;
