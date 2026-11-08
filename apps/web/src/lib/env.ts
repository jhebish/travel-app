/** Keys and URLs never contain whitespace; strip any that crept in when pasting (line breaks, spaces). */
const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, "");

function required(name: string): string {
  const v = clean(process.env[name]);
  if (!v) throw new Error(`Missing environment variable ${name}. See apps/web/.env.example.`);
  return v;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  anthropicKey: () => required("ANTHROPIC_API_KEY"),
  claudeModel: () => clean(process.env.CLAUDE_MODEL) || "claude-sonnet-5-5",
  /** Faster model for the parallel per-day, hotel and swap calls. Set to the main model to turn off. */
  fastModel: () => clean(process.env.CLAUDE_FAST_MODEL) || "claude-haiku-5-5",
  placesKey: () => clean(process.env.GOOGLE_PLACES_API_KEY),
  expedia: () => ({
    apiKey: clean(process.env.EXPEDIA_RAPID_API_KEY),
    secret: clean(process.env.EXPEDIA_RAPID_SHARED_SECRET),
    baseUrl: clean(process.env.EXPEDIA_RAPID_BASE_URL) || "https://test.ean.com",
  }),
  /** Typeform personal access token (scopes: forms:write, themes:write, responses:read). */
  typeformToken: () => clean(process.env.TYPEFORM_TOKEN),
  /** The intake form's id (the part after /to/ in its link). Empty = Typeform intake off. */
  typeformFormId: () => clean(process.env.TYPEFORM_FORM_ID),
  /** api.typeform.com, or api.eu.typeform.com for EU data-center accounts. */
  typeformApi: () => clean(process.env.TYPEFORM_API_BASE) || "https://api.typeform.com",
  tripsPerHour: () => Number(clean(process.env.TRIPS_PER_HOUR) || 10),
  /**
   * Google OAuth client ("Web application") for the one-time Google Calendar and Gmail imports.
   * Authorized redirect URIs: <site>/api/connect/google_calendar/callback, <site>/api/connect/gmail/callback
   */
  googleOAuth: () => ({ id: clean(process.env.GOOGLE_OAUTH_CLIENT_ID), secret: clean(process.env.GOOGLE_OAUTH_CLIENT_SECRET) }),
  /** Meta app (Facebook Login) for importing check-ins. Redirect URI: <site>/api/connect/facebook/callback */
  meta: () => ({ id: clean(process.env.META_APP_ID), secret: clean(process.env.META_APP_SECRET) }),
};
