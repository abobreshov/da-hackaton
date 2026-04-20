import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Kinetic Playground glass surfaces — single source of truth for the
 * frosted translucency + tinted shadow + ghost-ring combination that
 * the design spec calls "glass & gradient".
 *
 * Do not re-create these class strings inline in routes — import the
 * matching component so every light panel looks like every other light
 * panel and the ghost border / shadow tier / radius stay in sync.
 */

// ----- GlassCard ----- floating translucent panel (auth, dashboard, modals)
//
// `tone` swaps the tinted background + ring + on-surface text colour as
// one bundle so error surfaces stop forking a second inline recipe.
// `backdrop-blur-xl` stays in the base because the frosted look is
// independent of tone — it's the "glass" in GlassCard.
const glassCardVariants = cva('backdrop-blur-xl', {
  variants: {
    tone: {
      default:
        'bg-surface-container-lowest/80 text-on-surface ring-1 ring-inset ring-outline-variant/30',
      error:
        'bg-error-container/70 text-on-error-container ring-1 ring-inset ring-error/20',
    },
    shadow: {
      ambient: 'shadow-ambient',
      lg: 'shadow-ambient-lg',
      xl: 'shadow-ambient-xl',
      none: '',
    },
    radius: {
      lg: 'rounded-[2rem]',      // 2rem — standard card
      xl: 'rounded-[2.5rem]',    // 2.5rem — auth + hero
      pill: 'rounded-full',       // nav pill
    },
    padding: {
      none: '',
      md: 'p-6',
      lg: 'p-8',
      xl: 'p-10',
    },
  },
  defaultVariants: { tone: 'default', shadow: 'ambient', radius: 'lg', padding: 'lg' },
});

export interface GlassCardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof glassCardVariants> {
  as?: 'div' | 'section' | 'article' | 'header' | 'aside';
}

export const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, tone, shadow, radius, padding, as: Tag = 'div', ...props }, ref) => (
    <Tag
      ref={ref as never}
      className={cn(glassCardVariants({ tone, shadow, radius, padding }), className)}
      {...props}
    />
  ),
);
GlassCard.displayName = 'GlassCard';

// ----- HeroCard ----- colour-bearing hero, off-axis blob, for greeting panels
export interface HeroCardProps extends React.HTMLAttributes<HTMLElement> {
  tone?: 'primary' | 'secondary';
}

export const HeroCard = React.forwardRef<HTMLElement, HeroCardProps>(
  ({ className, tone = 'primary', children, ...props }, ref) => {
    const gradient =
      tone === 'primary'
        ? 'from-primary-container to-tertiary-container'
        : 'from-secondary-container to-tertiary-container';
    const blobTone = tone === 'primary' ? 'bg-primary' : 'bg-secondary';
    return (
      <section
        ref={ref as never}
        className={cn(
          'relative overflow-hidden rounded-[2.5rem] px-10 py-12 shadow-ambient-xl',
          'ring-1 ring-inset ring-outline-variant/30',
          'bg-gradient-to-br',
          gradient,
          className,
        )}
        {...props}
      >
        <div
          aria-hidden="true"
          className={cn('absolute -right-16 -top-20 h-64 w-64 rounded-full opacity-30 blur-3xl', blobTone)}
        />
        {children}
      </section>
    );
  },
);
HeroCard.displayName = 'HeroCard';

// ----- SectionHeading ----- consistent display-font heading for cards + sections
export interface SectionHeadingProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  eyebrow?: string;
  title: React.ReactNode;
  level?: 'h1' | 'h2' | 'h3';
}

export const SectionHeading = React.forwardRef<HTMLDivElement, SectionHeadingProps>(
  ({ eyebrow, title, level = 'h2', className, ...props }, ref) => {
    const Tag = level;
    return (
      <div ref={ref} className={cn('flex flex-col gap-2', className)} {...props}>
        {eyebrow ? (
          <p className="font-display text-label-lg font-semibold uppercase tracking-[0.18em] text-on-surface-variant">
            {eyebrow}
          </p>
        ) : null}
        <Tag
          className={cn(
            'font-display font-bold text-on-surface',
            level === 'h1' ? 'text-display-sm font-extrabold' : 'text-title-lg',
          )}
        >
          {title}
        </Tag>
      </div>
    );
  },
);
SectionHeading.displayName = 'SectionHeading';

// ----- StatRow ----- compact label/value pair for profile-style lists
export interface StatRowProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
}

export const StatRow = React.forwardRef<HTMLDivElement, StatRowProps>(
  ({ label, value, className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col', className)} {...props}>
      <dt className="font-display text-label-sm font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
        {label}
      </dt>
      <dd className="mt-1 font-body text-body-lg text-on-surface">{value}</dd>
    </div>
  ),
);
StatRow.displayName = 'StatRow';

// ----- Chip ----- pill tag for scopes, tags, filters
const chipVariants = cva(
  'inline-flex items-center rounded-full px-4 py-1.5 font-display text-label-md font-semibold',
  {
    variants: {
      tone: {
        primary: 'bg-primary-container text-on-primary-container',
        tertiary: 'bg-tertiary-container text-on-tertiary-container',
        secondary: 'bg-secondary-container text-on-secondary-container',
        neutral: 'bg-surface-container-high text-on-surface',
      },
    },
    defaultVariants: { tone: 'tertiary' },
  },
);

export interface ChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof chipVariants> {}

export const Chip = React.forwardRef<HTMLSpanElement, ChipProps>(
  ({ className, tone, ...props }, ref) => (
    <span ref={ref} className={cn(chipVariants({ tone }), className)} {...props} />
  ),
);
Chip.displayName = 'Chip';

export { glassCardVariants, chipVariants };
