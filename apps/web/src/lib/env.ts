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
  placesKey: () => clean(process.env.GOOGLE_PLACES_API_KEY),
  expedia: () => ({
    apiKey: clean(process.env.EXPEDIA_RAPID_API_KEY),
    secret: clean(process.env.EXPEDIA_RAPID_SHARED_SECRET),
    baseUrl: clean(process.env.EXPEDIA_RAPID_BASE_URL) || "https://test.ean.com",
  }),
  tripsPerHour: () => Number(clean(process.env.TRIPS_PER_HOUR) || 10),
};
