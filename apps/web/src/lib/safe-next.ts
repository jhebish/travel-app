/**
 * Where to send someone after signing in: a path on this site, or "/" for anything that
 * would leave it ("//other.site", "/\other.site", "https://…", tabs or newlines inside, and
 * dot segments that resolve to "//other.site", such as "/.//other.site" or "/a/..//other.site").
 * Resolving against a placeholder origin works the same on the server and in the browser.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return "/";
  const base = "https://pylos.invalid";
  try {
    const target = new URL(raw, base);
    if (target.origin !== base) return "/";
    // Once dot segments are resolved the path can begin with "//", which a browser (and
    // `new URL(path, origin)`) reads as another host. A real page path never starts that way.
    if (/^\/[\\/]/.test(target.pathname)) return "/";
    const out = target.pathname + target.search + target.hash;
    // Belt and braces: what we hand back must still resolve to this site.
    return new URL(out, base).origin === base ? out : "/";
  } catch {
    return "/";
  }
}

/**
 * The absolute URL to redirect to after signing in: `next` on `origin`, or the home page when
 * `next` would resolve anywhere else. Use at every server redirect, on top of safeNext.
 */
export function redirectOnSite(next: string, origin: string): URL {
  const home = new URL("/", origin);
  try {
    const target = new URL(next, home);
    return target.origin === home.origin ? target : home;
  } catch {
    return home;
  }
}
