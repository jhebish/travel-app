# Pylos

A locals-first travel planner. Travelers answer a few quick questions and get a bespoke itinerary with places to stay, built mostly from picks by locals and hosts. Every recommendation is tagged with its source, and both the app's curators and each traveler can tune how heavily each source counts. Trips are saved and rated, and those ratings feed back into the default source weights.

One backend serves a **web app** (Next.js) and an **iOS/Android app** (Expo).

## How it works

```
Traveler request
   │
   ▼
Source weights ── app defaults (curators) blended with the traveler's own mix
   │               (app-blocked sources stay blocked)
   ▼
Candidates ────── approved local picks for the city  +  Google Places searches
   │
   ▼
Ranking ───────── source weight first, then fit (interests, halal/veg/sober,
   │               family, hotel style & price), then light quality signals
   ▼
Claude ────────── builds the plan from the ranked candidates (structured output)
   │
   ▼
Grounding ─────── each pick's source is reset to its real origin; every place is
   │               verified on Google Places (map link, hours); places that can't
   │               be found or are permanently closed are dropped
   ▼
Live hotel rates ─ Expedia Rapid, for hotels with a known Expedia id and dates
   │
   ▼
Saved to the traveler's private history → saves, stars, thumbs per stop/hotel
   │
   ▼
Anonymized feedback (no personal details) → curator insights → suggested weights
```

## Repo layout

```
apps/web        Next.js app: web UI + the API (route handlers under src/app/api)
apps/mobile     Expo (React Native) app; talks to the web app's API
packages/core   Shared logic: sources, schemas, weight blending, ranking,
                prompts, feedback + insights. Unit-tested.
supabase/       Database migration (tables, row-level security, defaults)
```

## Roles

| Role | Can |
|---|---|
| traveler (default) | Build trips, keep a private history, save and rate, set a personal source mix |
| local | Everything above, plus submit local picks (they wait for approval) |
| curator | Review picks, attach Expedia ids, edit app-wide defaults, see insights |
| admin | Same as curator |

Roles are set in the database, never from the app (see setup step 3).

## Privacy

- Trips, including the optional "About you" details (LGBTQ+, halal, sober, accessibility), are visible only to the traveler who built them (row-level security).
- Ratings reach curators only as anonymized rows in `trip_feedback`: no user id, no "About you" details, no free-text notes, no dates. Curators can't read trips, so rows can't be traced back to people.
- Removing a trip removes its feedback row.

---

## Setup

You need: Node 20+, pnpm 10, a Supabase project, an Anthropic API key, a Google Cloud project with **Places API (New)** enabled, and (optional) Expedia Rapid partner credentials.

### 1. Database (Supabase)

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run `supabase/migrations/20261101000000_init.sql`.
   (Or with the Supabase CLI: `supabase link` then `supabase db push`.)

### 2. Sign-in (Supabase → Authentication)

- **Email links:** Sign In / Providers → Email: enabled. People sign in by clicking the link in Supabase's default email; no template change is needed.
  - Supabase's built-in email sender is heavily rate-limited (a few emails per hour). Before launch, add your own sender under **Emails → SMTP Settings** (Resend, Postmark, SendGrid…). Once you have SMTP you can also add `{{ .Token }}` to the Magic Link template, and the app's "enter the code" box will work too.
- **Google (web, optional):** Providers → Google: add your Google OAuth client id and secret.
- **URL Configuration:** Site URL = your deployed web URL. Add these Redirect URLs:
  - `https://YOUR-APP/auth/callback` and `http://localhost:3000/auth/callback` (web)
  - `tripplanner://**` (mobile app) and `exp://**` (mobile, while testing in Expo Go)

- **Guest access:** Sign In / Providers → turn on **Allow anonymous sign-ins**. Visitors then use the app without signing in; each browser or phone gets a private guest account, and signing in later keeps their trips.

### 3. Make yourself an admin

Sign in once in the app (click the emailed link), then run in the SQL Editor:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

Give hosts and locals `role = 'local'` the same way so they can submit picks.

### 4. API keys

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page. **Server only.** |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `GOOGLE_PLACES_API_KEY` | Google Cloud → enable **Places API (New)** → Credentials. Restrict the key to that API. |
| `EXPEDIA_RAPID_API_KEY`, `EXPEDIA_RAPID_SHARED_SECRET` | Expedia Group partner program (Rapid). Optional. |

Without a Places key the app still works, but places aren't verified and there are no map links. Without Expedia credentials, hotels show estimated nightly ranges.

### 5. Run the web app locally

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # fill it in
pnpm dev                                        # http://localhost:3000
```

### 6. Deploy the web app (Vercel)

1. Push this repo to GitHub and import it in [Vercel](https://vercel.com/new).
2. **Root Directory:** `apps/web`. Vercel detects Next.js and pnpm.
3. Add the environment variables from `apps/web/.env.example`.
4. Trip generation takes roughly 30–90 seconds. The `/api/trips` route asks for up to 120 seconds; make sure your Vercel plan allows that function duration.
5. Update Supabase's Site URL and redirect URLs to the Vercel domain.

### 7. Run the mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env    # API URL + Supabase public keys
pnpm dev:mobile                                 # scan the QR code with Expo Go
```

On a physical device, `EXPO_PUBLIC_API_URL` must be reachable from the phone (your deployed URL, or your computer's LAN address while developing).

For store builds, change `bundleIdentifier` / `package` in `apps/mobile/app.json`, then use [EAS Build](https://docs.expo.dev/build/introduction/): `npx eas-cli build --platform ios` (and `android`).

## Live hotel rates

Rates come from the Expedia Rapid availability API and appear only when:

1. Expedia credentials are set,
2. the traveler entered a start date, and
3. the hotel came from an approved **stay** local pick that has an Expedia property id. Curators add the id in **Local picks**.

The adapter (`apps/web/src/lib/hotels.ts`) follows Rapid's documented signature auth and availability endpoint. Test it against Rapid's test environment (`EXPEDIA_RAPID_BASE_URL=https://test.ean.com`) once you have partner access, before switching to production.

## Development

```bash
pnpm test         # core unit tests
pnpm typecheck    # all packages
pnpm build        # production build of the web app
```

### API (used by both apps)

| Method | Path | Who |
|---|---|---|
| GET / POST | `/api/trips` | list my trips / build a trip |
| GET / PATCH / DELETE | `/api/trips/:id` | read / save, rate, vote / remove |
| POST | `/api/trips/:id/hotels` | find or replace hotels for a trip |
| GET / PUT | `/api/prefs` | my source mix |
| GET / PUT | `/api/config` | app defaults (PUT: curators) |
| GET | `/api/insights` | rating insights and suggested weights (curators) |
| GET / POST | `/api/picks` | list / submit local picks |
| PATCH / DELETE | `/api/picks/:id` | review a pick (curators) |
| GET | `/api/me` | current user and role |

Web requests authenticate with Supabase cookies; the mobile app sends `Authorization: Bearer <access token>`.

## Known limits and next steps

- Expedia property ids are attached by hand for now. A content sync with Rapid's property catalog would let the planner match any hotel automatically.
- Google Places lookups are cached for 14 days in `places_cache` to control cost; watch your Places quota as usage grows.
- The rate limit is per traveler per hour (`TRIPS_PER_HOUR`). Add a global budget alert in the Anthropic console.
- Local picks are matched to a destination by city name. Normalizing cities (or using Places' locality ids) would make matching sturdier.

## Typeform intake (optional)

The planner (`/plan`) can use a Typeform instead of the built-in form. Answers are matched by each question's fixed `ref`, so you can reword, reorder or restyle the form in Typeform without breaking anything.

1. In Typeform → Settings → Personal tokens, create a token with scopes **forms:write, themes:write, responses:read**. Add it in Vercel as `TYPEFORM_TOKEN` and redeploy.
2. Create the form: `POST https://<your-app>/api/typeform/setup` (allowed once, while no form is configured). It returns the form id and link.
3. Add the id in Vercel as `TYPEFORM_FORM_ID` and redeploy. The planner now shows the Typeform, with a link to the quick form.

How it works: the embed passes the visitor's user id as a hidden `uid` field. On submit, the app fetches that response from the Typeform Responses API, checks the `uid`, maps the answers to a trip request (`packages/core/src/typeform.ts`) and streams the build with the usual progress bar. The mobile app keeps its native form.

## Community

Follow friends, see their shared trips, browse the top-rated public trips in any city, and see who's the most travelled among the people you follow.

- **Setup:** run `supabase/migrations/20261106000000_community.sql` in the Supabase SQL editor. Until then, community pages say so and trip building works as before.
- **Joining** needs an email sign-in (guest accounts can log places but can't have a profile). People pick a handle on `/profile`.
- **Visibility:** each trip is Only me, Followers, or Everyone (from its Share menu); new trips follow the profile's default. Other people's trips are served by the server with personal details removed (the "about you" answers, notes, dates and source mix).
- **Places I've been** (`past_trips`): city, country, year, rating and highlights. They drive the friends leaderboard (countries, then cities) and feed the planner as a taste signal, so returning visitors get fewer first-timer sights.
- **Top trips** rank public trips by likes from other people, then the owner's rating, with a small boost for recent ones.

## Browse, multi-city trips, and faster builds

- **Browse** (the home page, `/`; public, no account needed; `/browse` redirects here): a turning globe of trending destinations (2026 trend lists, seasonality and activity on Pylos), each with a cached sample itinerary (`/d/<key>`), the best public trips there, and "Plan my own". Signed-in travelers with a few logged places get "Picked for you" predictions. Run `supabase/migrations/20261106100000_browse.sql` to enable sample caching and picks. The trip planner lives at `/plan`; older `/?dest=…` and `/?from=…` links redirect there.
- **Several stops**: choose "Several stops" on the planner (or `mode: "multi"` in the API) with a country or region and up to 14 days. The planner picks the route (stops, order, days, transfers), then plans every day and each stop's hotels in parallel.
- **Speed**: the fast model writes the outline and days; malformed answers are repaired instead of re-planned; finished days stream to the page as they're ready.

## Your taste, connected accounts, photos and planning together

Run `supabase/migrations/20261107000000_taste_together.sql` after deploying this version (the app
works before it, with these features off). It also stops travelers' browsers from writing trips
directly: trips are now inserted and edited only by the server, which checks who is asking.

- **Past trips: tick what you loved.** On the You page (`/profile`), type a city, tick the places you
  loved from a ready-made list of its best-known stays, restaurants, bars and sights, hit Next
  (`components/QuickLog.tsx`). The list is written once per city by the fast model, in two halves
  at once, and cached in `places_cache` (`citypicks1:<city>`). "I went" on a Pylos trip puts that
  plan's places first. Each logged trip can still be edited with more detail.
- **Taste profile.** Those places, sign-in and phone imports and your thumbs on Pylos plans become `taste_signals`.
  The fast model turns them into a cached profile (`taste_profiles`); the planner gets a TASTE
  section (profile plus your strongest favourites, nearest to the trip first) for days, swaps,
  rebuilt days and hotels, and marks matching picks "For you".
- **Connected accounts: sign in or allow, nothing to download.** On the web (`components/connect.tsx`):
  - Google Calendar: a one-time read of past trips, hotel stays and dinner reservations (Resy and
    OpenTable bookings land in calendars). Set `GOOGLE_OAUTH_CLIENT_ID` and
    `GOOGLE_OAUTH_CLIENT_SECRET` (Google Cloud → APIs & Services → Credentials → OAuth client,
    type Web application, redirect URI `https://www.pylos.ai/api/connect/google_calendar/callback`,
    enable the Google Calendar API, scope `calendar.readonly`). Until Google verifies the app, only
    the test users you add on the consent screen can connect.
  - Facebook: check-ins and tagged places with `META_APP_ID` / `META_APP_SECRET` (redirect URI
    `/api/connect/facebook/callback`; `user_posts` and `user_tagged_places` need Meta app review).
  - Both add the cities and years they find to Places you've been (`tripsFromSignals`).
  - Access tokens are used once and revoked; none are stored (`connections` keeps only dates/counts).
  - In the phone app (You tab, `apps/mobile/src/deviceImports.ts`), with the person's permission:
    the calendars on the phone (iCloud, Google, Outlook; read on the phone with `calendarSignals`)
    and photo locations (days away from home become trips with `photoStays`; only rough centres
    and dates are sent, and `/api/taste/photo-trips` names the places). Instagram doesn't let
    apps read personal accounts any more, and Resy and OpenTable have no sign-in for other apps:
    their bookings come in through the calendar.
- **Photos.** Google Places photos are captured when places are verified and served through
  `/api/photo` (a cached redirect; author credited). Needs `GOOGLE_PLACES_API_KEY` with the Places
  API (New) enabled; each photo size is fetched from Google about once a week.
- **Plan together.** Owners add mutual-follow friends or share an invite link (`/join/<token>`,
  two weeks). Everyone can react to stops ("I'm in" / "pass"), swap stops and rebuild days; rebuilt
  days keep stops anyone is in for and blend everyone's taste. `trip_members`, `trip_invites`,
  `trip_reactions`; edits use an `updated_at` check so simultaneous changes don't overwrite each other.
- **Days slider.** Destination itineraries and shared trips can be fitted to fewer days instantly
  (`fitItineraryToDays`); for more days, destinations use a longer version planned once
  (`/api/browse/<key>/sample?long=1`) and trimmed the same way.
- **Rate limits** are recorded in `rate_events` before the work starts (builds, edits, hotel
  searches, city lists and photo scans, taste refreshes), so parallel requests count against each other.

## Multi-city routes by season, and swapping a stop

The plan form asks **When** (a month, defaulting to the weeks ahead; "Not sure yet" plans a route
that works most of the year). The route picks stops for that month (beach towns only in beach
season) and gives each stop a `season` line and 2–3 `alternatives`. On the trip, each stop shows
them; swapping (`swap_city` edit) re-plans that stop's days, its hotels if it had them, the
transfers either side and the trip title, and keeps the old town as a one-tap swap back.
