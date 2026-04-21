import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PresenceDot } from './presence-dot';

describe('<PresenceDot />', () => {
  it('renders online state with a green fill + accessible label', () => {
    render(<PresenceDot state="online" />);
    const dot = screen.getByRole('status', { name: /online/i });
    expect(dot).toBeInTheDocument();
    // Expect a Tailwind green utility on the dot (no raw hex).
    expect(dot.className).toMatch(/green/);
  });

  it('renders afk state with an amber fill + accessible label', () => {
    render(<PresenceDot state="afk" />);
    const dot = screen.getByRole('status', { name: /afk|away/i });
    expect(dot).toBeInTheDocument();
    // Amber / yellow utility expected; accept either token.
    expect(dot.className).toMatch(/(amber|yellow)/);
  });

  it('renders offline state with a neutral (outline) fill + accessible label', () => {
    render(<PresenceDot state="offline" />);
    const dot = screen.getByRole('status', { name: /offline/i });
    expect(dot).toBeInTheDocument();
    // Design-system neutral token for offline — must not be a raw hex literal.
    expect(dot.getAttribute('style')).toBeNull();
    expect(dot.className).toMatch(/(outline|on-surface|surface-container)/);
  });

  it('never inlines raw hex colours via the style attribute', () => {
    const { rerender, container } = render(<PresenceDot state="online" />);
    for (const state of ['online', 'afk', 'offline'] as const) {
      rerender(<PresenceDot state={state} />);
      const dot = container.firstElementChild as HTMLElement;
      // Forbidden: inline style containing a `#xxxxxx` literal.
      const style = dot.getAttribute('style') ?? '';
      expect(style).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });

  it('forwards className + extra span props to the root element', () => {
    render(<PresenceDot state="online" className="custom-ring" data-testid="dot-root" />);
    const dot = screen.getByTestId('dot-root');
    expect(dot.className).toContain('custom-ring');
  });

  it('exposes canonical data-testid + data-state for E2E selectors', () => {
    const { container, rerender } = render(<PresenceDot state="online" />);
    for (const state of ['online', 'afk', 'offline'] as const) {
      rerender(<PresenceDot state={state} />);
      const dot = container.firstElementChild as HTMLElement;
      expect(dot.getAttribute('data-testid')).toBe('presence-dot');
      expect(dot.getAttribute('data-state')).toBe(state);
    }
  });
});
