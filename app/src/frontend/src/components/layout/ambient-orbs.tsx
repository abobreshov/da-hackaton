/**
 * Four giant blurred orbs that drift behind the auth screens.
 * The design spec calls out a "lavender + peach" atmosphere — these stay
 * off-axis on purpose (no rigid grid) and animate with staggered durations
 * so the composition never settles into a static portrait.
 *
 * Decorative only — `aria-hidden` on the wrapper.
 */
export function AmbientOrbs(): React.ReactElement {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        className="orb animate-float-slow"
        style={{
          top: '-10%',
          left: '-12%',
          width: '46rem',
          height: '46rem',
          background: 'var(--orb-lavender)',
          opacity: 0.65,
        }}
      />
      <div
        className="orb animate-float-med"
        style={{
          top: '40%',
          right: '-18%',
          width: '38rem',
          height: '38rem',
          background: 'var(--orb-peach)',
          opacity: 0.5,
          animationDelay: '2s',
        }}
      />
      <div
        className="orb animate-float-fast"
        style={{
          bottom: '-18%',
          left: '22%',
          width: '32rem',
          height: '32rem',
          background: 'var(--orb-sky)',
          opacity: 0.35,
          animationDelay: '4s',
        }}
      />
      <div
        className="orb animate-float-slow"
        style={{
          top: '8%',
          right: '18%',
          width: '18rem',
          height: '18rem',
          background: 'var(--primary-container)',
          opacity: 0.35,
          animationDelay: '1s',
        }}
      />
    </div>
  );
}
