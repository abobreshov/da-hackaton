import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './empty-state';

describe('<EmptyState />', () => {
  it('renders headline + description', () => {
    render(
      <EmptyState title="No rooms yet" description="Start a conversation to see it here." />,
    );
    expect(screen.getByRole('heading', { name: /no rooms yet/i })).toBeInTheDocument();
    expect(screen.getByText(/start a conversation to see it here/i)).toBeInTheDocument();
  });

  it('renders the action slot below the description', () => {
    render(
      <EmptyState
        title="Nothing here"
        description="Try creating something new."
        action={<button type="button">Create</button>}
      />,
    );
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
  });

  it('renders the children CTA slot when provided', () => {
    render(
      <EmptyState title="Nothing here">
        <button type="button">Invite friends</button>
      </EmptyState>,
    );
    expect(screen.getByRole('button', { name: /invite friends/i })).toBeInTheDocument();
  });

  it('does not render any border in its default output (No-Line rule)', () => {
    const { container } = render(
      <EmptyState title="No rooms yet" description="blah" />,
    );
    // Tonal shift is the only separator — no border-* utility anywhere.
    expect(container.querySelector('.border')).toBeNull();
    expect(container.querySelector('[class*="border-"]')).toBeNull();
    // No <hr> either.
    expect(container.querySelector('hr')).toBeNull();
  });

  it('uses tokenised surface + typography classes', () => {
    const { container } = render(<EmptyState title="Hello" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('bg-surface-container-low/60');
    expect(root.className).toContain('rounded-[2rem]');
    const heading = screen.getByRole('heading', { name: /hello/i });
    expect(heading.className).toContain('font-display');
    expect(heading.className).toContain('text-title-lg');
  });

  it('forwards className and extra props to the root element', () => {
    const { container } = render(
      <EmptyState title="Hello" className="extra-class" data-testid="empty-root" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-testid', 'empty-root');
    expect(root.className).toContain('extra-class');
  });
});
