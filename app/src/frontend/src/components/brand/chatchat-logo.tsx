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
      className={['relative grid place-items-center rounded-full shadow-ambient-lg', className]
        .filter(Boolean)
        .join(' ')}
      style={{
        width: size,
        height: size,
        background:
          'linear-gradient(135deg, var(--primary-container) 0%, var(--primary) 60%, var(--primary-dim) 100%)',
      }}
      aria-hidden="true"
    >
      <span
        className="absolute inset-0 rounded-full opacity-80"
        style={{
          boxShadow: 'inset 0 -10px 30px rgba(34, 0, 77, 0.35), inset 0 10px 20px rgba(255,255,255,0.15)',
        }}
      />
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative drop-shadow-[0_2px_6px_rgba(34,0,77,0.35)]"
      >
        <path
          d="M3.5 7.5A3 3 0 0 1 6.5 4.5H14a3 3 0 0 1 3 3v3.75a3 3 0 0 1-3 3h-3.8l-3.2 2.6a.6.6 0 0 1-.98-.47v-2.13h-.02A3 3 0 0 1 3.5 11.25Z"
          fill="currentColor"
          className="text-on-primary"
        />
        <path
          d="M9.75 13.25h6.6A3 3 0 0 1 19.35 16.25v2A3 3 0 0 1 16.35 21.25h-1.9l-2.55 2.15a.45.45 0 0 1-.74-.35v-1.8H10.9a3 3 0 0 1-1.15-.23 4 4 0 0 0 1.75-3.27v-4.5Z"
          fill="currentColor"
          className="text-primary-container"
          fillOpacity="0.92"
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
      className={['wordmark-gradient font-display text-title-lg font-extrabold italic', className]
        .filter(Boolean)
        .join(' ')}
    >
      ChatChat
    </span>
  );
}
