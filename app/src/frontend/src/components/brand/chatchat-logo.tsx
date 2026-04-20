import { cn } from '@/lib/utils';

/**
 * ChatChat brand mark — two stacked speech bubbles inside a softly-floating
 * gradient disc. Used on the auth screens' hero area and the app header.
 *
 * Size is controlled by the `size` prop so the same asset can stand in at
 * 44 px (header) and 80 px (auth hero) without crushing stroke weight.
 */
export function ChatChatLogo({
  size = 80,
  className,
}: {
  size?: number;
  className?: string;
}): React.ReactElement {
  const iconSize = Math.round(size * 0.48);
  return (
    <div
      className={cn(
        'relative grid place-items-center rounded-full shadow-ambient-lg',
        className,
      )}
      style={{
        width: size,
        height: size,
        // Multi-stop gradient of design tokens — Tailwind can't express
        // this cleanly as utilities, so we keep the inline `style.background`
        // here rather than inventing a one-off utility class.
        background:
          'linear-gradient(135deg, var(--primary-container) 0%, var(--primary) 60%, var(--primary-dim) 100%)',
      }}
      aria-hidden="true"
    >
      <span className="chatchat-disc-inset absolute inset-0 rounded-full opacity-80" />
      <svg
        width={iconSize}
        height={iconSize}
        // Tight viewBox around the single speech-bubble path so it
        // lands optically centred inside the gradient disc. Adding ~1
        // unit of padding above/below keeps the tail from kissing the
        // bottom edge.
        viewBox="2.75 3.5 15.5 15.5"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative drop-shadow-[0_2px_6px_rgba(34,0,77,0.35)]"
      >
        <path
          d="M3.5 7.5A3 3 0 0 1 6.5 4.5H14a3 3 0 0 1 3 3v3.75a3 3 0 0 1-3 3h-3.8l-3.2 2.6a.6.6 0 0 1-.98-.47v-2.13h-.02A3 3 0 0 1 3.5 11.25Z"
          fill="currentColor"
          className="text-on-primary"
        />
      </svg>
    </div>
  );
}

/**
 * Italic dual-tone wordmark — "Chat" (primary) + "Chat" (on-surface).
 * Uses the `wordmark-gradient` utility from index.css for the colour split.
 */
export function ChatChatWordmark({ className }: { className?: string }): React.ReactElement {
  return (
    <span
      className={cn(
        'wordmark-gradient font-display text-title-lg font-extrabold italic',
        className,
      )}
    >
      ChatChat
    </span>
  );
}
