/** One `<main>` rule for every shell (desktop, mobile and the handheld fallback). */
export const SHELL_MAIN_ID = 'main-content';

/** Desktop/mobile content column. The handheld shell scrolls its own full-height main. */
export const SHELL_MAIN_CLASS = 'mx-auto w-full max-w-7xl p-4 outline-hidden';

/**
 * First focusable element on every page: lets keyboard and switch users jump past the
 * banners and navigation. Hidden until focused.
 */
export function SkipToContent() {
  return (
    <a
      href={`#${SHELL_MAIN_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-md focus:bg-semantic-surface-1 focus:px-4 focus:font-medium focus:text-semantic-primary focus:shadow-md focus:outline-2 focus:outline-offset-2 focus:outline-semantic-primary"
    >
      Skip to content
    </a>
  );
}
