import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnreadBadge } from './unread-badge';

describe('UnreadBadge', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<UnreadBadge count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when count is negative or non-finite', () => {
    const neg = render(<UnreadBadge count={-5} />);
    expect(neg.container).toBeEmptyDOMElement();
    const nan = render(<UnreadBadge count={Number.NaN} />);
    expect(nan.container).toBeEmptyDOMElement();
  });

  it('renders the count verbatim up to 99', () => {
    render(<UnreadBadge count={42} />);
    expect(screen.getByRole('status')).toHaveTextContent('42');
    expect(screen.getByRole('status')).toHaveAccessibleName('42 unread');
  });

  it('renders "99+" for counts above 99 (AC-09-03)', () => {
    render(<UnreadBadge count={500} />);
    expect(screen.getByRole('status')).toHaveTextContent('99+');
    expect(screen.getByRole('status')).toHaveAccessibleName('99+ unread');
  });

  it('honours a custom aria-label', () => {
    render(<UnreadBadge count={3} label="3 new in #general" />);
    expect(screen.getByRole('status')).toHaveAccessibleName('3 new in #general');
  });

  it('exposes aria-live="polite" so AT announces badge bumps', () => {
    render(<UnreadBadge count={1} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});
