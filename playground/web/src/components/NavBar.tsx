// The top bar, shared by every page.
//
// The links and classes come from lib/nav, so the bar is defined once. The
// site's own pages sit beside the brand; links that leave the site are ranged
// right, which is what marks them as going elsewhere.

import { ThemeToggle } from "./ThemeToggle";
import {
  NAV_BRAND,
  NAV_CLASS,
  NAV_EXTERNAL,
  NAV_LINKS,
  type NavLink,
  type View,
} from "../lib/nav";

type Props = {
  /** Which in-app view is showing; the others are offered as links. */
  view: View;
  onNavigate: (view: View) => void;
};

export function NavBar({ view, onNavigate }: Props) {
  return (
    <nav className={NAV_CLASS.bar}>
      <div className={NAV_CLASS.inner}>
        <button onClick={() => onNavigate("landing")} className={NAV_CLASS.brand}>
          {NAV_BRAND.label}
        </button>

        {/* Takes the free space, so the external group is pushed right. */}
        <div className={NAV_CLASS.links}>
          {NAV_LINKS.map((link) => (
            <PageLink key={link.href} link={link} view={view} onNavigate={onNavigate} />
          ))}
        </div>

        <div className={NAV_CLASS.external}>
          {NAV_EXTERNAL.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className={NAV_CLASS.link}
            >
              {link.label}
              <span aria-hidden className={NAV_CLASS.marker}>
                ↗
              </span>
            </a>
          ))}
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}

/** One of the site's own pages: a real link, switched without a reload. */
function PageLink({
  link,
  view,
  onNavigate,
}: {
  link: NavLink;
  view: View;
  onNavigate: (view: View) => void;
}) {
  const active = view === link.view;
  return (
    <a
      href={link.href}
      onClick={(e) => {
        if (!link.view) return;
        // The hash still makes it addressable; this only avoids the reload.
        e.preventDefault();
        onNavigate(link.view);
      }}
      aria-current={active ? "page" : undefined}
      className={active ? NAV_CLASS.active : NAV_CLASS.link}
    >
      {link.label}
    </a>
  );
}
