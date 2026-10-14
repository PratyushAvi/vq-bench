// Light / dark, as a pair of icons.
//
// Both destinations are always visible, with the active one lit and the other
// grey, and an arrow pointing at what a click would switch to. That reads as a
// switch with a known state, where a single cycling glyph makes the reader
// click to find out what it does.

import { useEffect, useState } from "react";

import { applyTheme, resolve, storedTheme, watchSystem } from "../lib/theme";

export function ThemeToggle() {
  // What is actually on screen, read from the DOM rather than derived from a
  // stored preference. The pre-paint script sets `data-theme` before React
  // mounts, so anything derived from state instead can disagree with the page
  // for a render -- and a click computed from a stale value appears to do
  // nothing until you click again.
  const [active, setActive] = useState<"light" | "dark">(() =>
    typeof document === "undefined"
      ? "light"
      : document.documentElement.dataset.theme === "dark"
        ? "dark"
        : "light",
  );
  // Whether the reader is still following the OS, which only affects whether
  // system changes are tracked.
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    const stored = storedTheme();
    setFollowing(stored === "system");
    setActive(resolve(stored));
  }, []);

  useEffect(() => {
    if (!following) return;
    return watchSystem(() => {
      applyTheme("system");
      setActive(resolve("system"));
    });
  }, [following]);

  const next = active === "dark" ? "light" : "dark";

  function toggle() {
    setActive(next);
    setFollowing(false);
    applyTheme(next);
  }

  return (
    <button
      onClick={toggle}
      title={`${active} mode — switch to ${next}`}
      aria-label={`${active} mode. Switch to ${next} mode.`}
      className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-1
                 leading-none hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:bg-slate-800"
    >
      {/* Sun first, then the arrow, then the moon: the arrow points from the
          mode you are in towards the one a click reaches. The sun carries more
          detail at the same point size, so it is set a step larger. */}
      <span
        aria-hidden
        className={`text-xl ${active === "light" ? "text-amber-400" : "text-slate-500 dark:text-slate-400"}`}
      >
        ☀
      </span>
      <span aria-hidden className="text-xs text-slate-500">
        {active === "light" ? "→" : "←"}
      </span>
      <span
        aria-hidden
        className={`text-base ${active === "dark" ? "text-amber-400" : "text-slate-500 dark:text-slate-400"}`}
      >
        ☾
      </span>
    </button>
  );
}
