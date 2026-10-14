// Light or dark, remembered.
//
// The choice is written to `data-theme` on <html>, which both Tailwind's
// `dark:` variant and the chart palette key off -- so one attribute switches
// the whole page. "system" follows the OS and is the default, since a reader
// who has expressed a preference there has already answered the question.

export type Theme = "light" | "dark" | "system";

const KEY = "vq-theme";

/** What the OS asks for right now. */
function systemTheme(): "light" | "dark" {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The stored preference, or "system" when there is none. */
export function storedTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  } catch {
    // Private browsing, or storage disabled: not worth failing over.
    return "system";
  }
}

/** Which of the two is actually showing, given a preference. */
export function resolve(theme: Theme): "light" | "dark" {
  return theme === "system" ? systemTheme() : theme;
}

/** Put the choice on <html> and remember it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = resolve(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // As above -- the page still switches, it just will not be remembered.
  }
}

/**
 * Track the OS setting while the reader is following it.
 *
 * Returns an unsubscribe. Without this, "system" would only be read at load
 * and the page would not follow a preference changed mid-session.
 */
export function watchSystem(onChange: () => void): () => void {
  const query = window.matchMedia?.("(prefers-color-scheme: dark)");
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}
