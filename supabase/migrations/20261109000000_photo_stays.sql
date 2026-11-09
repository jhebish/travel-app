-- Hotels found by the phone's photo scan (where night-time photos on a trip were taken), saved as
-- taste signals after the traveler reviews them. Until this runs, the app saves them as "manual".
alter table public.taste_signals drop constraint if exists taste_signals_source_check;
alter table public.taste_signals add constraint taste_signals_source_check
  check (source in ('manual', 'google_calendar', 'ics', 'google_takeout', 'instagram', 'facebook', 'swarm', 'paste', 'gmail', 'photos'));
