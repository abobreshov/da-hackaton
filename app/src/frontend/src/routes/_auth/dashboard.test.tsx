import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { Route } from './dashboard';
import { useSession } from '@/hooks/useSession';

const getComponent = () =>
  (Route as unknown as { options: { component: () => JSX.Element } }).options.component;

describe('<Dashboard />', () => {
  beforeEach(() => {
    useSession.setState({ session: null });
  });
  afterEach(() => {
    useSession.setState({ session: null });
  });

  it('greets the user by name when a name is present', () => {
    useSession.setState({
      session: {
        userId: 1,
        email: 'alice@x',
        name: 'Alice',
        type: 'user',
        scopes: ['rooms:read', 'rooms:write'],
      },
    });

    const Dashboard = getComponent();
    render(<Dashboard />);

    expect(screen.getByRole('heading', { name: /hey, alice/i })).toBeInTheDocument();
    // Email appears twice — in hero copy and profile Row. Use getAllByText.
    expect(screen.getAllByText('alice@x').length).toBeGreaterThan(0);
    expect(screen.getByText(/rooms:read/)).toBeInTheDocument();
    expect(screen.getByText(/rooms:write/)).toBeInTheDocument();
    // `type` is displayed via `capitalize` class — the raw text is still 'user'.
    expect(screen.getByText('user')).toBeInTheDocument();
  });

  it('falls back to email when name is absent', () => {
    useSession.setState({
      // name omitted on purpose — `??` only falls back on null/undefined.
      session: {
        userId: 1,
        email: 'bob@x',
        type: 'user',
        scopes: [],
      } as unknown as NonNullable<ReturnType<typeof useSession.getState>['session']>,
    });
    const Dashboard = getComponent();
    render(<Dashboard />);
    expect(screen.getByRole('heading', { name: /hey, bob@x/i })).toBeInTheDocument();
    expect(screen.getByText(/no scopes assigned/i)).toBeInTheDocument();
  });

  it('renders nothing broken when session is null', () => {
    const Dashboard = getComponent();
    const { container } = render(<Dashboard />);
    expect(container.querySelector('h1')).not.toBeNull();
    expect(screen.getByText(/no scopes assigned/i)).toBeInTheDocument();
  });

  it('renders a "Browse rooms" link that navigates to /rooms', () => {
    const Dashboard = getComponent();
    render(<Dashboard />);
    const link = screen.getByRole('link', { name: /browse rooms/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/rooms');
  });

  it('renders a "Contacts" link that navigates to /contacts', () => {
    const Dashboard = getComponent();
    render(<Dashboard />);
    const link = screen.getByRole('link', { name: /contacts/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/contacts');
  });
});
