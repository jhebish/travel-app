import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps the Supabase session cookie fresh on page requests. getSession() reads the cookie and only
 * calls Supabase when the access token has expired (to refresh it), so pages and the background
 * prefetches Next.js makes for links don't each wait on a round trip to Supabase. Nothing here
 * decides access: API routes and server pages check the user themselves with getUser().
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\s+/g, ""),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.replace(/\s+/g, ""),
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  await supabase.auth.getSession();
  return response;
}

export const config = {
  // Skip static assets and API routes (API routes authenticate per request).
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
