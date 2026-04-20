import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './empty-state';

describe('<EmptyState />', () => {
  it('renders title only (no icon, description or action by default)', () => {
    const { container } = render(<EmptyState title="No rooms yet" />);
    expect(screen.getByRole('heading', { name: /no rooms yet/i })).toBeInTheDocument();
    // Icon slot (<div class="mb-4 ..."> wrapping the icon) should not be rendered.
    expect(container.querySelectorAll('h3')).toHaveLength(1);
    // No description or action nodes.
    expect(screen.queryByText(/description/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders icon, description and action when provided', () => {
    render(
      <EmptyState
        icon={<svg data-testid="icon" aria-hidden="true" />}
        title="Nothing here"
        description="Try creating something new."
        action={<button type="button">Create</button>}
      />,
    );

    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /nothing here/i })).toBeInTheDocument();
    expect(screen.getByText(/try creating something new/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
  });

  it('forwards className and extra div props to the root element', () => {
    const { container } = render(
      <EmptyState title="Hello" className="custom-class" data-testid="empty-root" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-testid', 'empty-root');
    expect(root.className).toContain('custom-class');
    // Base layout classes from the component still present.
    expect(root.className).toContain('flex');
  });
});
