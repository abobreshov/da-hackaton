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
        id: 1,
        email: 'alice@x',
        name: 'Alice',
        type: 'user',
        scopes: ['rooms:read', 'rooms:write'],
      },
    });

    const Dashboard = getComponent();
    render(<Dashboard />);

    expect(screen.getByRole('heading', { name: /hey, alice/i })).toBeInTheDocument();
    // Email appears twice — in hero copy and profile StatRow. Use getAllByText.
    expect(screen.getAllByText('alice@x').length).toBeGreaterThan(0);
    // Display-name row surfaces the name again in the profile card;
    // the hero heading also contains it, so multiple matches are expected.
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
  });

  it('falls back to email when name is absent', () => {
    useSession.setState({
      // name omitted on purpose — `??` only falls back on null/undefined.
      session: {
        id: 1,
        email: 'bob@x',
        type: 'user',
        scopes: [],
      } as unknown as NonNullable<ReturnType<typeof useSession.getState>['session']>,
    });
    const Dashboard = getComponent();
    render(<Dashboard />);
    expect(screen.getByRole('heading', { name: /hey, bob@x/i })).toBeInTheDocument();
  });

  it('renders nothing broken when session is null', () => {
    const Dashboard = getComponent();
    const { container } = render(<Dashboard />);
    expect(container.querySelector('h1')).not.toBeNull();
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
