// The site's top-bar links, in one place.
//
// Every page -- the landing page, the playground and the guide -- renders this
// one bar, so a link added here appears on all of them.

/** The app's pages. Hash-routed, so every one is a real, linkable URL. */
export type View = "landing" | "playground" | "guide";

export type NavLink = {
  /** The view this link selects, when it stays inside the app. */
  view?: View;
  label: string;
  href: string;
  /** Opens off-site: gets a marker and `target="_blank"`. */
  external?: boolean;
};

/** The site title, which returns to the landing page. */
export const NAV_BRAND = { label: "VQ-Bench Playground", href: "/" };

/** The site's own pages, beside the brand. */
export const NAV_LINKS: NavLink[] = [
  { label: "Playground", href: "#playground", view: "playground" },
  { label: "What are Vector Quantizers", href: "#guide", view: "guide" },
];

/**
 * Links that leave the site, ranged right.
 *
 * Kept apart from the pages rather than ordered after them: the split is what
 * says these go elsewhere, and it holds as pages are added.
 */
export const NAV_EXTERNAL: NavLink[] = [
  { label: "vq-bench.com", href: "https://www.vq-bench.com", external: true },
  { label: "GitHub", href: "https://github.com/PratyushAvi/VQ-Playground", external: true },
];

/** The Tailwind classes the bar is built from, shared with the static copy. */
export const NAV_CLASS = {
  bar: "border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900",
  inner: "mx-auto flex max-w-6xl items-center gap-6 px-6 py-3",
  brand: "font-serif text-base tracking-tight text-slate-900 dark:text-slate-100",
  // The pages take the free space, which pushes the external group right.
  links: "flex flex-1 items-center gap-4 text-sm",
  external: "flex items-center gap-4 text-sm",
  link: "text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 dark:text-slate-400 dark:hover:text-slate-100",
  active: "font-medium text-slate-900 dark:text-slate-100",
  marker: "ml-0.5 text-xs text-slate-500 dark:text-slate-400",
} as const;
