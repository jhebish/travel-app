-- Ranking and nudges: an index the ranking reads need. Run after 20261108000000_community_loop.sql.
-- Additive and safe to run more than once; the app works without it, just slower as votes grow.
--
-- Answers about a Pylos trip's stops are also looked up per person: has this person ranked this
-- trip yet ("Back from Lisbon?"), how many answers this hour (the rate limit), and their ranked
-- stops for the taste profile.
create index if not exists trip_rank_votes_user_idx on public.trip_rank_votes (user_id, created_at desc);
