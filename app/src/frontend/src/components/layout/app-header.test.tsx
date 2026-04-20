import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The router's <Link> needs a routing context at runtime — for unit tests we
// stand it up as a plain <a> so the header renders in isolation.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { AppHeader } from './app-header';
import { AppShell } from './app-shell';

describe('<AppHeader />', () => {
  it('renders a <nav> landmark wrapping the pill', () => {
    render(<AppHeader />);
    expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument();
  });

  it('default brand renders the ChatChat logo + wordmark linking to /dashboard', () => {
    render(<AppHeader />);
    const brandLink = screen.getByRole('link', { name: /chatchat home/i });
    expect(brandLink).toBeInTheDocument();
    expect(brandLink).toHaveAttribute('href', '/dashboard');
    // Wordmark text is inside the same link.
    expect(brandLink).toHaveTextContent('ChatChat');
  });

  it('custom brand slot overrides the default', () => {
    render(<AppHeader brand={<div data-testid="custom-brand">Custom</div>} />);
    expect(screen.getByTestId('custom-brand')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /chatchat home/i })).toBeNull();
  });

  it('renders the user display name inside an sm+-only span when user is provided', () => {
    render(<AppHeader user={{ name: 'Ada Lovelace', email: 'ada@example.com' }} />);
    // Disambiguate from the AvatarDisc's sr-only name — pick the visible-on-sm+ span.
    const nameNode = screen.getByText('Ada Lovelace', { selector: 'span.sm\\:inline' });
    // Hidden on mobile, visible sm+ — enforced by tailwind classes on the span.
    expect(nameNode.className).toContain('hidden');
    expect(nameNode.className).toContain('sm:inline');
  });

  it('falls back to email as display text when name is absent', () => {
    render(<AppHeader user={{ email: 'fallback@x' }} />);
    expect(screen.getByText('fallback@x')).toBeInTheDocument();
  });

  it('renders AvatarDisc with the user name as aria-label', () => {
    render(<AppHeader user={{ name: 'Ada Lovelace', email: 'ada@example.com' }} />);
    const disc = screen.getByRole('img', { name: /ada lovelace/i });
    expect(disc).toBeInTheDocument();
  });

  it('wires onLogout to the Log out button click', () => {
    const onLogout = vi.fn();
    render(<AppHeader user={{ name: 'Ada' }} onLogout={onLogout} />);
    const btn = screen.getByRole('button', { name: /log ?out/i });
    fireEvent.click(btn);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('does not render a Log out button when onLogout is omitted', () => {
    render(<AppHeader user={{ name: 'Ada' }} />);
    expect(screen.queryByRole('button', { name: /log ?out/i })).toBeNull();
  });

  it('renders actions slot content before the user block', () => {
    render(
      <AppHeader
        user={{ name: 'Ada', email: 'ada@example.com' }}
        onLogout={() => {}}
        actions={<button type="button">Notifications</button>}
      />,
    );
    const actionBtn = screen.getByRole('button', { name: /notifications/i });
    const logoutBtn = screen.getByRole('button', { name: /log ?out/i });
    expect(actionBtn).toBeInTheDocument();
    // Document order: actions render before logout button.
    expect(
      actionBtn.compareDocumentPosition(logoutBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  it('renders as a pill-shaped glass card (rounded-full)', () => {
    const { container } = render(<AppHeader user={{ name: 'Ada' }} />);
    // GlassCard with radius="pill" → rounded-full somewhere inside the nav.
    expect(container.querySelector('.rounded-full')).not.toBeNull();
  });

  it('inherits the surrounding AppShell maxWidth on the nav container', () => {
    render(
      <AppShell maxWidth="lg" header={<AppHeader user={{ name: 'Ada' }} />}>
        <p>body</p>
      </AppShell>,
    );
    const nav = screen.getByRole('navigation', { name: /primary/i });
    expect(nav.className).toContain('max-w-lg');
  });

  it('falls back to max-w-6xl when rendered outside any AppShell', () => {
    render(<AppHeader user={{ name: 'Ada' }} />);
    const nav = screen.getByRole('navigation', { name: /primary/i });
    expect(nav.className).toContain('max-w-6xl');
  });
});
