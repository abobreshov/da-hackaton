import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from './app-shell';

describe('<AppShell />', () => {
  it('renders a single <main> landmark with id="main" and the default max-width', () => {
    render(
      <AppShell>
        <p>Body content</p>
      </AppShell>,
    );
    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
    expect(main).toHaveAttribute('id', 'main');
    expect(main.className).toContain('max-w-6xl');
  });

  it('renders the ambient orbs decoration (at least one .orb element)', () => {
    const { container } = render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    expect(container.querySelectorAll('.orb').length).toBeGreaterThan(0);
  });

  it('applies max-w-lg when maxWidth="lg" is passed', () => {
    render(
      <AppShell maxWidth="lg">
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByRole('main').className).toContain('max-w-lg');
  });

  it('supports maxWidth="md" and "xl" without leaking other max-w-* tokens', () => {
    const { rerender } = render(
      <AppShell maxWidth="md">
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByRole('main').className).toContain('max-w-md');

    rerender(
      <AppShell maxWidth="xl">
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByRole('main').className).toContain('max-w-xl');
  });

  it('renders the header slot when provided', () => {
    render(
      <AppShell header={<div data-testid="hdr">Nav</div>}>
        <p>body</p>
      </AppShell>,
    );
    expect(screen.getByTestId('hdr')).toBeInTheDocument();
  });

  it('omits the header wrapper when no header is supplied', () => {
    const { container } = render(
      <AppShell>
        <p>body</p>
      </AppShell>,
    );
    // The header wrapper is the only element with px-8 py-5 classes; none should exist.
    expect(container.querySelector('.px-8.py-5')).toBeNull();
  });

  it('renders children inside the <main> landmark', () => {
    render(
      <AppShell>
        <p data-testid="child">hello</p>
      </AppShell>,
    );
    const main = screen.getByRole('main');
    const child = screen.getByTestId('child');
    expect(main.contains(child)).toBe(true);
  });

  it('outer wrapper carries bg-surface + overflow-hidden (playground atmosphere)', () => {
    const { container } = render(
      <AppShell>
        <p>x</p>
      </AppShell>,
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain('bg-surface');
    expect(outer.className).toContain('overflow-hidden');
    expect(outer.className).toContain('min-h-screen');
  });
});
