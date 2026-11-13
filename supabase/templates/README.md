# Sign-in emails

Branded templates for Supabase Auth. Each email carries a sign-in **code** (typed into the
sign-in page on the web or in the phone app) and a **Sign in to Pylos** button that works in any
browser, on any device (it goes to `/auth/confirm`, which signs in with the link's token hash).

They're sent through Resend from `Pylos <team@pylos.ai>` (Authentication → Emails → SMTP Settings).
Paste each file into Supabase → Authentication → Emails → Templates:

| Template in Supabase | File | Subject |
| --- | --- | --- |
| Magic link | `magic-link.html` | Your Pylos sign-in code |
| Confirm sign up | `confirm-signup.html` | Your Pylos sign-in code |
| Change email address | `email-change.html` | Your Pylos sign-in code |

Why three: returning people get the magic-link email, new people get the confirm-sign-up email,
and a guest who signs in (so their trips come with them) gets the change-email email.

Settings these assume (Authentication → URL Configuration and → Sign In / Providers → Email):

- **Site URL** `https://www.pylos.ai`, with no trailing slash (the button is `{{ .SiteURL }}/auth/confirm…`).
- **Redirect URLs** include `https://www.pylos.ai/**`, `https://pylos.ai/**`, `pylos://**` and
  `tripplanner://**` (the phone app). The button passes the sign-in page's `next` path through `redirect_to`.
- **Email OTP expiration** 3600 seconds: the email says the code "expires in an hour".
- **Email OTP length** 6 to 10 digits: the sign-in pages accept any length in that range.

The logo is `https://www.pylos.ai/email/pylos-lockup.png` (`apps/web/public/email/`), drawn on the
card's colour so it stays visible when a mail app darkens the page.
