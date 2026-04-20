import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Kinetic Playground avatar disc — the gradient circle that stands in for a
 * real profile photo throughout the app (nav, contact lists, message
 * authorship). Lifts a previously-inline `<div>` + `initials()` block from
 * `_auth.tsx` so every surface that displays a user shares one visual + a11y
 * contract.
 *
 * Two gradient families (`tone`) because the avatar sometimes sits on a
 * `primary-container` tile (where we want `secondary-container` → `tertiary`
 * to stand out) and sometimes on neutral surface (where the stronger
 * `primary-container` → `tertiary` family reads as the focal point).
 *
 * `asChild` exists so callers can render the disc as a `<Link>` / `<a>`
 * without nesting a focusable element inside a plain `<div>` (which would
 * break keyboard focus order and double the accessible name).
 */
const avatarDiscVariants = cva(
  [
    'grid place-items-center rounded-full font-display font-bold shadow-ambient-sm',
    'select-none',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'h-8 w-8 text-label-md',
        md: 'h-10 w-10 text-label-lg',
        lg: 'h-14 w-14 text-title-md',
      },
      tone: {
        primary: 'bg-gradient-to-br from-primary-container to-tertiary-container text-on-primary-container',
        tertiary: 'bg-gradient-to-br from-secondary-container to-tertiary-container text-on-secondary-container',
      },
    },
    defaultVariants: { size: 'md', tone: 'primary' },
  },
);

export interface AvatarDiscProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof avatarDiscVariants> {
  /** Full display name — preferred source for initials + aria-label. */
  name?: string | null;
  /** Fallback when `name` is unknown (e.g. unconfirmed account). */
  email?: string | null;
  /**
   * Render as a Radix Slot so callers can wrap `<Link>` / `<a>` without
   * introducing a redundant wrapper div (which would break focus ring +
   * accessible name composition).
   */
  asChild?: boolean;
}

/**
 * Derive up to 2 uppercase initials from an arbitrary string.
 *
 * Stable across common user-identity shapes:
 *   - `"Ada Lovelace"`     → `"AL"`
 *   - `"ada"`              → `"AD"`
 *   - `"ada@example.com"`  → `"AE"` (splits on `@`)
 *   - `"ada.lovelace"`     → `"AL"` (splits on `.`)
 *   - `"ada_lovelace"`     → `"AL"`
 *   - `"ada-lovelace"`     → `"AL"`
 *   - empty / whitespace   → `"?"`
 *
 * Pure function — safe to call from tests, SSR, memoization.
 */
export function initialsOf(source: string): string {
  if (!source) return '?';
  const parts = source.trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export const AvatarDisc = React.forwardRef<HTMLDivElement, AvatarDiscProps>(
  ({ name, email, size, tone, asChild = false, className, children, ...props }, ref) => {
    const source = (name?.trim() || email?.trim() || '').trim();
    const initials = initialsOf(source);
    const label = name?.trim() || email?.trim() || 'User';

    const Comp = asChild ? Slot : 'div';
    // When slotting into a real interactive element (<a>, <button>) the
    // child brings its own accessible role + name. Forcing `role="img"`
    // onto it would hide the native role and break the link/button from
    // keyboard nav + assistive tech. We keep the aria-label either way so
    // the accessible name is consistent across both code paths.
    const roleProps = asChild ? {} : { role: 'img' as const };

    return (
      <Comp
        ref={ref as never}
        {...roleProps}
        aria-label={label}
        className={cn(avatarDiscVariants({ size, tone }), className)}
        {...props}
      >
        {children ?? (
          <>
            {/*
             * Screen readers announce the aria-label on the outer disc; when a
             * real display name exists, we also expose it as sr-only text so
             * assistive tech with poor label support still gets the full name.
             * Sighted users only see the initials span.
             */}
            {name ? <span className="sr-only">{name}</span> : null}
            <span aria-hidden="true">{initials}</span>
          </>
        )}
      </Comp>
    );
  },
);
AvatarDisc.displayName = 'AvatarDisc';

export { avatarDiscVariants };
