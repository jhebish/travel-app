"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconCompass, IconGlobe, IconPeople, IconSuitcase, IconUser } from "./icons";
import { canSubmitPicks, useMe } from "./useMe";

const TABS = [
  { href: "/", label: "Browse", Icon: IconGlobe },
  { href: "/plan", label: "Plan", Icon: IconCompass },
  { href: "/trips", label: "Trips", Icon: IconSuitcase },
  { href: "/friends", label: "Friends", Icon: IconPeople },
  { href: "/profile", label: "You", Icon: IconUser },
];

/** Top bar on every page; on phones the sections move to a tab bar at the bottom of the screen. */
export function Nav() {
  const path = usePathname();
  const me = useMe();
  const links = [
    { href: "/", label: "Browse" },
    { href: "/plan", label: "Plan" },
    { href: "/trips", label: "My trips" },
    { href: "/friends", label: "Friends" },
    { href: "/sources", label: "Sources" },
    ...(canSubmitPicks(me?.role) ? [{ href: "/picks", label: "Local picks" }] : []),
  ];
  const current = (href: string) =>
    href === "/" ? path === "/" || path.startsWith("/d/") : path === href || path.startsWith(`${href}/`);
  const signedIn = !!me?.user && !me.user.isGuest;
  const loginHref = path === "/" || path.startsWith("/login") ? "/login" : `/login?next=${encodeURIComponent(path)}`;
  return (
    <>
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
            {!me ? (
              // Holds the space while we check, so nothing jumps when "Sign in" appears.
              <span className="account-slot" aria-hidden="true" />
            ) : signedIn ? (
              <Link href="/profile" className="me-link" title={me.user?.email} aria-current={path.startsWith("/profile") ? "page" : undefined}>
                <span className="me-dot" aria-hidden="true">
                  {(me.user?.email?.[0] ?? "·").toUpperCase()}
                </span>
                <span className="me-label">You</span>
              </Link>
            ) : (
              <Link href={loginHref} title="Optional: keep your trips across devices">
                Sign in
              </Link>
            )}
          </div>
        </div>
        <div className="meander" aria-hidden="true" />
      </header>
      <nav className="tabbar" aria-label="Sections">
        {TABS.map(({ href, label, Icon }) => (
          <Link key={href} href={href} aria-current={current(href) ? "page" : undefined}>
            <Icon />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
