// The written guide, as a page of the app.
//
// The prose is authored in docs/index.qmd and rendered by Quarto; only the
// article body is kept (docs/extract.mjs) and dropped in here. The app then
// supplies the head, the nav bar and the type -- so the guide cannot drift
// from the rest of the site the way a separately-rendered page does.
//
// The HTML is generated at build time from a file in this repo, so it is not
// untrusted input: there is no user content in this path.

import { GUIDE_HTML, GUIDE_TOC } from "../generated/guide";

export function Guide() {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[1fr_14rem]">
      <article
        className="guide-prose min-w-0"
        dangerouslySetInnerHTML={{ __html: GUIDE_HTML }}
      />

      {GUIDE_TOC && (
        <nav aria-label="on this page" className="hidden lg:block">
          <p className="mb-2 text-xs font-semibold text-slate-900 dark:text-slate-100">On this page</p>
          <div
            className="guide-toc text-xs"
            dangerouslySetInnerHTML={{ __html: GUIDE_TOC }}
          />
        </nav>
      )}
    </div>
  );
}
