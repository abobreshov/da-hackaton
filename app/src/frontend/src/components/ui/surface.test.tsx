import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GlassCard, HeroCard, SectionHeading, StatRow, Chip } from './surface';

describe('<GlassCard />', () => {
  it('renders with default shadow-ambient, 2rem radius, and p-8 padding', () => {
    const { container } = render(<GlassCard data-testid="card">hi</GlassCard>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('shadow-ambient');
    expect(root.className).toContain('rounded-[2rem]');
    expect(root.className).toContain('p-8');
  });

  it('radius="xl" swaps to rounded-[2.5rem]', () => {
    const { container } = render(<GlassCard radius="xl">hi</GlassCard>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('rounded-[2.5rem]');
    expect(root.className).not.toContain('rounded-[2rem]');
  });

  it('radius="pill" renders rounded-full', () => {
    const { container } = render(<GlassCard radius="pill">hi</GlassCard>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('rounded-full');
  });

  it('padding variants control spacing', () => {
    const { container, rerender } = render(<GlassCard padding="md">hi</GlassCard>);
    expect((container.firstElementChild as HTMLElement).className).toContain('p-6');

    rerender(<GlassCard padding="xl">hi</GlassCard>);
    expect((container.firstElementChild as HTMLElement).className).toContain('p-10');

    rerender(<GlassCard padding="none">hi</GlassCard>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toMatch(/\bp-\d/);
  });

  it('consumer className overrides padding cleanly via cn() / tailwind-merge', () => {
    const { container } = render(
      <GlassCard padding="lg" className="p-4">
        hi
      </GlassCard>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('p-4');
    // tailwind-merge drops the earlier p-8 so cascade is deterministic.
    expect(root.className).not.toMatch(/\bp-8\b/);
  });

  it('renders with `as` tag when provided', () => {
    const { container } = render(
      <GlassCard as="section" data-testid="card">
        hi
      </GlassCard>,
    );
    expect(container.firstElementChild?.tagName).toBe('SECTION');
  });

  it('shadow="none" drops the shadow utility entirely', () => {
    const { container } = render(<GlassCard shadow="none">hi</GlassCard>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toMatch(/shadow-ambient/);
  });
});

describe('<HeroCard />', () => {
  it('renders a gradient section with a blob element', () => {
    const { container } = render(
      <HeroCard data-testid="hero">
        <h2>Welcome</h2>
      </HeroCard>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe('SECTION');
    expect(root.className).toContain('bg-gradient-to-br');
    expect(root.className).toContain('from-primary-container');
    // Blob is the first child, aria-hidden, absolutely positioned.
    const blob = root.querySelector('[aria-hidden="true"]');
    expect(blob).not.toBeNull();
    expect(blob!.className).toContain('bg-primary');
    expect(blob!.className).toContain('rounded-full');
  });

  it('tone="secondary" swaps the gradient family and blob colour', () => {
    const { container } = render(<HeroCard tone="secondary">content</HeroCard>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('from-secondary-container');
    expect(root.className).toContain('to-tertiary-container');
    const blob = root.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(blob.className).toContain('bg-secondary');
  });
});

describe('<Chip />', () => {
  it('renders tertiary (default) tone', () => {
    render(<Chip>New</Chip>);
    const chip = screen.getByText('New');
    expect(chip.className).toContain('bg-tertiary-container');
    expect(chip.className).toContain('text-on-tertiary-container');
  });

  it('tone variants render the correct background colour', () => {
    const { rerender } = render(<Chip tone="primary">A</Chip>);
    expect(screen.getByText('A').className).toContain('bg-primary-container');

    rerender(<Chip tone="secondary">B</Chip>);
    expect(screen.getByText('B').className).toContain('bg-secondary-container');

    rerender(<Chip tone="neutral">C</Chip>);
    expect(screen.getByText('C').className).toContain('bg-surface-container-high');
  });

  it('is always pill-shaped (rounded-full)', () => {
    render(<Chip>pill</Chip>);
    expect(screen.getByText('pill').className).toContain('rounded-full');
  });
});

describe('<SectionHeading />', () => {
  it('renders an h2 by default', () => {
    render(<SectionHeading title="Inbox" />);
    const heading = screen.getByRole('heading', { name: /inbox/i });
    expect(heading.tagName).toBe('H2');
    expect(heading.className).toContain('text-title-lg');
  });

  it('renders the eyebrow when provided', () => {
    render(<SectionHeading eyebrow="Today" title="Inbox" />);
    const eyebrow = screen.getByText('Today');
    expect(eyebrow.tagName).toBe('P');
    expect(eyebrow.className).toContain('uppercase');
  });

  it('level="h1" uses display-sm scale', () => {
    render(<SectionHeading level="h1" title="Hello" />);
    const heading = screen.getByRole('heading', { name: /hello/i });
    expect(heading.tagName).toBe('H1');
    expect(heading.className).toContain('text-display-sm');
  });

  it('level="h3" renders a <h3>', () => {
    render(<SectionHeading level="h3" title="Sub" />);
    expect(screen.getByRole('heading', { name: /sub/i }).tagName).toBe('H3');
  });
});

describe('<StatRow />', () => {
  it('renders dt label + dd value', () => {
    const { container } = render(<StatRow label="Email" value="ada@example.com" />);
    const dt = container.querySelector('dt');
    const dd = container.querySelector('dd');
    expect(dt).not.toBeNull();
    expect(dd).not.toBeNull();
    expect(dt!).toHaveTextContent('Email');
    expect(dd!).toHaveTextContent('ada@example.com');
  });

  it('applies display-font label + body-font value typography', () => {
    const { container } = render(<StatRow label="Email" value="a@b.co" />);
    const dt = container.querySelector('dt') as HTMLElement;
    const dd = container.querySelector('dd') as HTMLElement;
    expect(dt.className).toContain('font-display');
    expect(dd.className).toContain('font-body');
  });
});
