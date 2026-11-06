/**
 * Where to send someone after signing in: a path on this site, or "/" for anything that
 * would leave it ("//other.site", "/\other.site", "https://…", tabs or newlines inside).
 * Resolving against a placeholder origin works the same on the server and in the browser.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return "/";
  const base = "https://pylos.invalid";
  try {
    const target = new URL(raw, base);
    return target.origin === base ? target.pathname + target.search + target.hash : "/";
  } catch {
    return "/";
  }
}
