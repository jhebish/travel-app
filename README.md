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

The home page can use a Typeform instead of the built-in form. Answers are matched by each question's fixed `ref`, so you can reword, reorder or restyle the form in Typeform without breaking anything.

1. In Typeform → Settings → Personal tokens, create a token with scopes **forms:write, themes:write, responses:read**. Add it in Vercel as `TYPEFORM_TOKEN` and redeploy.
2. Create the form: `POST https://<your-app>/api/typeform/setup` (allowed once, while no form is configured). It returns the form id and link.
3. Add the id in Vercel as `TYPEFORM_FORM_ID` and redeploy. The home page now shows the Typeform, with a link to the quick form.

How it works: the embed passes the visitor's user id as a hidden `uid` field. On submit, the app fetches that response from the Typeform Responses API, checks the `uid`, maps the answers to a trip request (`packages/core/src/typeform.ts`) and streams the build with the usual progress bar. The mobile app keeps its native form.

## Community

Follow friends, see their shared trips, browse the top-rated public trips in any city, and see who's the most travelled among the people you follow.

- **Setup:** run `supabase/migrations/20261106000000_community.sql` in the Supabase SQL editor. Until then, community pages say so and trip building works as before.
- **Joining** needs an email sign-in (guest accounts can log places but can't have a profile). People pick a handle on `/profile`.
- **Visibility:** each trip is Only me, Followers, or Everyone (from its Share menu); new trips follow the profile's default. Other people's trips are served by the server with personal details removed (the "about you" answers, notes, dates and source mix).
- **Places I've been** (`past_trips`): city, country, year, rating and highlights. They drive the friends leaderboard (countries, then cities) and feed the planner as a taste signal, so returning visitors get fewer first-timer sights.
- **Top trips** rank public trips by likes from other people, then the owner's rating, with a small boost for recent ones.
