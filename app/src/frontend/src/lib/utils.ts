import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Kinetic Playground's tailwind-merge config.
 *
 * tailwind-merge v2 doesn't know our custom font-size utilities
 * (`text-title-md` etc.), ambient shadow scale, or float animations
 * out of the box. Without this extend the merge would keep BOTH
 * conflicting classes and let cascade order decide the winner —
 * a coin-flip depending on CVA layering.
 *
 * Keep these arrays in sync with:
 *   - tailwind.config.js → theme.extend.fontSize
 *   - tailwind.config.js → theme.extend.boxShadow
 *   - tailwind.config.js → theme.extend.animation
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'display-lg',
            'display-md',
            'display-sm',
            'headline-lg',
            'headline-md',
            'headline-sm',
            'title-lg',
            'title-md',
            'title-sm',
            'body-lg',
            'body-md',
            'body-sm',
            'label-lg',
            'label-md',
            'label-sm',
          ],
        },
      ],
      shadow: [{ shadow: ['ambient-sm', 'ambient', 'ambient-lg', 'ambient-xl', 'glow-primary'] }],
      animate: [{ animate: ['float-slow', 'float-med', 'float-fast', 'fade-up'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
