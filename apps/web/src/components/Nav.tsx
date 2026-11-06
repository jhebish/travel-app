"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconGlobe, IconPeople, IconSuitcase, IconUser } from "./icons";
import { Mark } from "./Mark";
import { canSubmitPicks, useMe } from "./useMe";

/** Phones: the sections in a tab bar at the bottom. Planning is the button at the top right. */
const TABS = [
  { href: "/", label: "Browse", Icon: IconGlobe },
  { href: "/trips", label: "Trips", Icon: IconSuitcase },
  { href: "/friends", label: "Friends", Icon: IconPeople },
  { href: "/profile", label: "You", Icon: IconUser },
];

/**
 * The header spans the window: the mark at the far left, the sections in the middle, and
 * "Plan a trip" as a button at the far right, over the Pylos wave running edge to edge.
 */
export function Nav() {
  const path = usePathname();
  const me = useMe();
  const links = [
    { href: "/", label: "Browse" },
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
          <div className="topbar-start">
            <Link href="/" className="brand">
              <Mark width={60} tight cut="full" />
              <span className="brand-word">Pylos</span>
            </Link>
          </div>
          <nav className="nav" aria-label="Main">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={l.href === "/sources" ? "nav-extra" : undefined} aria-current={current(l.href) ? "page" : undefined}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="topbar-end">
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
            <Link href="/plan" className="plan-cta" aria-current={current("/plan") ? "page" : undefined}>
              Plan<span className="plan-cta-more">&nbsp;a trip</span>
            </Link>
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
