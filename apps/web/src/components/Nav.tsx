"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { canSubmitPicks, useMe } from "./useMe";

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  const me = useMe();
  const links = [
    { href: "/", label: "Browse" },
    { href: "/plan", label: "Plan" },
    { href: "/trips", label: "My trips" },
    { href: "/friends", label: "Friends" },
    { href: "/sources", label: "Sources" },
    ...(canSubmitPicks(me?.role) ? [{ href: "/picks", label: "Local picks" }] : []),
  ];
  const current = (href: string) => (href === "/" ? path === "/" || path.startsWith("/d/") : path.startsWith(href));
  return (
    <header className="topbar">
      <div className="topbar-row">
      <Link href="/" className="brand">
        Pylos
      </Link>
      <nav className="nav" aria-label="Main">
        {links.map((l) => (
          <Link key={l.href} href={l.href} aria-current={current(l.href) ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="account">
        {me?.user && !me.user.isGuest ? (
          <>
            <span>{me.user.email}</span>
            <button
              className="linkbtn"
              onClick={async () => {
                await supabaseBrowser().auth.signOut();
                router.push("/");
                router.refresh();
              }}
            >
              Sign out
            </button>
          </>
        ) : me ? (
          <Link href={path === "/" || path.startsWith("/login") ? "/login" : `/login?next=${encodeURIComponent(path)}`} title="Optional: keep your trips across devices">
            Sign in
          </Link>
        ) : null}
      </div>
      </div>
      <div className="meander" aria-hidden="true" />
    </header>
  );
}
