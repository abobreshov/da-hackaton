import * as React from 'react';
import { cn } from '@/lib/utils';
import { AmbientOrbs } from '@/components/layout/ambient-orbs';

/**
 * Kinetic Playground application shell — owns the page-level background,
 * ambient-orbs decoration, optional header slot, and the single `<main>`
 * landmark that routes render their content inside.
 *
 * Every authenticated (and some public) screens mount inside this shell so
 * the lavender/peach atmosphere, max-width, and skip-link target stay
 * consistent. Keeping the orbs + bg in one primitive makes it cheap to opt
 * marketing / landing screens in without copy-pasting the boilerplate.
 *
 * - Outer: `relative min-h-screen overflow-hidden bg-surface`, hosts the
 *   decorative `<AmbientOrbs />` (aria-hidden).
 * - Header slot: when provided, wrapped in a `relative z-10 px-8 py-5`
 *   positioned container so the glass pill stacks above the orbs.
 * - Main: single `<main id="main">` landmark with the configurable
 *   `max-w-*` container; serves as the skip-link target.
 */

const MAX_WIDTH_CLASSES = {
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '6xl': 'max-w-6xl',
} as const;

export type AppShellMaxWidth = keyof typeof MAX_WIDTH_CLASSES;

/**
 * Context exposed by `<AppShell>` so descendants (notably `<AppHeader>`)
 * can inherit the chosen `maxWidth` without it being re-plumbed through
 * props. `null` when rendered outside a shell — consumers fall back to
 * their own default so they stay standalone-usable.
 */
interface AppShellLayoutContextValue {
  maxWidth: AppShellMaxWidth;
}

const AppShellLayoutContext = React.createContext<AppShellLayoutContextValue | null>(null);

/**
 * Read the current shell layout context. Returns `null` when the caller
 * is rendered outside of an `<AppShell>` — callers can then pick their
 * own fallback rather than inherit an arbitrary default.
 */
export function useAppShellLayout(): AppShellLayoutContextValue | null {
  return React.useContext(AppShellLayoutContext);
}

export function maxWidthClass(maxWidth: AppShellMaxWidth): string {
  return MAX_WIDTH_CLASSES[maxWidth];
}

export interface AppShellProps {
  /** Optional header slot — omit for landing / marketing screens. */
  header?: React.ReactNode;
  /** Route content — rendered inside the single `<main id="main">` landmark. */
  children: React.ReactNode;
  /** Tailwind `max-w-*` alias for the main content container. Defaults to `6xl`. */
  maxWidth?: AppShellMaxWidth;
  /** Optional class override on the outer wrapper — for rare per-route tweaks. */
  className?: string;
}

export function AppShell({
  header,
  children,
  maxWidth = '6xl',
  className,
}: AppShellProps): React.ReactElement {
  const layoutValue = React.useMemo(() => ({ maxWidth }), [maxWidth]);
  return (
    <AppShellLayoutContext.Provider value={layoutValue}>
      <div className={cn('relative min-h-screen overflow-hidden bg-surface', className)}>
        <AmbientOrbs />
        {header ? <div className="relative z-10 px-8 py-5">{header}</div> : null}
        <main
          id="main"
          className={cn('relative z-10 mx-auto px-8 pb-16 pt-6', MAX_WIDTH_CLASSES[maxWidth])}
        >
          {children}
        </main>
      </div>
    </AppShellLayoutContext.Provider>
  );
}
