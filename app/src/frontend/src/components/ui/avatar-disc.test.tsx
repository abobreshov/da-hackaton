import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AvatarDisc, initialsOf } from './avatar-disc';

describe('initialsOf()', () => {
  it('returns "?" for empty / whitespace input', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
  });

  it('uppercases the first two letters of a single word', () => {
    expect(initialsOf('ada')).toBe('AD');
    expect(initialsOf('bo')).toBe('BO');
  });

  it('takes first letter of first two whitespace-separated words', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('john ronald reuel tolkien')).toBe('JR');
  });

  it('splits email on "@" to derive initials', () => {
    expect(initialsOf('ada@example.com')).toBe('AE');
  });

  it('splits on dots, underscores, and dashes', () => {
    expect(initialsOf('ada.lovelace')).toBe('AL');
    expect(initialsOf('ada_lovelace')).toBe('AL');
    expect(initialsOf('ada-lovelace')).toBe('AL');
  });

  it('returns uppercase even for already-uppercase input', () => {
    expect(initialsOf('ADA LOVELACE')).toBe('AL');
  });
});

describe('<AvatarDisc />', () => {
  it('renders initials derived from name as visible content', () => {
    render(<AvatarDisc name="Ada Lovelace" />);
    const disc = screen.getByRole('img', { name: /ada lovelace/i });
    expect(disc).toBeInTheDocument();
    expect(disc).toHaveTextContent('AL');
  });

  it('aria-label falls back through name → email → "User"', () => {
    const { rerender } = render(<AvatarDisc name="Ada Lovelace" />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Ada Lovelace');

    rerender(<AvatarDisc email="ada@example.com" />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'ada@example.com');

    rerender(<AvatarDisc />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'User');
  });

  it('renders an sr-only span with the full name when name is provided', () => {
    render(<AvatarDisc name="Ada Lovelace" />);
    const srOnly = screen.getByText('Ada Lovelace', { selector: '.sr-only' });
    expect(srOnly).toBeInTheDocument();
  });

  it('does not render an sr-only name span when only email is available', () => {
    const { container } = render(<AvatarDisc email="ada@example.com" />);
    expect(container.querySelector('.sr-only')).toBeNull();
  });

  it('tone="primary" uses primary→tertiary gradient classes', () => {
    render(<AvatarDisc name="Ada" tone="primary" />);
    const disc = screen.getByRole('img');
    expect(disc.className).toContain('from-primary-container');
    expect(disc.className).toContain('to-tertiary-container');
    expect(disc.className).toContain('text-on-primary-container');
  });

  it('tone="tertiary" swaps to secondary→tertiary gradient classes', () => {
    render(<AvatarDisc name="Ada" tone="tertiary" />);
    const disc = screen.getByRole('img');
    expect(disc.className).toContain('from-secondary-container');
    expect(disc.className).toContain('to-tertiary-container');
    expect(disc.className).toContain('text-on-secondary-container');
    expect(disc.className).not.toContain('from-primary-container');
  });

  it('size maps to the expected h/w utility classes', () => {
    const { rerender } = render(<AvatarDisc name="A" size="sm" />);
    expect(screen.getByRole('img').className).toMatch(/h-8\b/);
    expect(screen.getByRole('img').className).toMatch(/w-8\b/);

    rerender(<AvatarDisc name="A" size="md" />);
    expect(screen.getByRole('img').className).toMatch(/h-10\b/);
    expect(screen.getByRole('img').className).toMatch(/w-10\b/);

    rerender(<AvatarDisc name="A" size="lg" />);
    expect(screen.getByRole('img').className).toMatch(/h-14\b/);
    expect(screen.getByRole('img').className).toMatch(/w-14\b/);
  });

  it('is always a full-rounded, grid-centered disc with ambient shadow', () => {
    render(<AvatarDisc name="Ada" />);
    const disc = screen.getByRole('img');
    expect(disc.className).toContain('rounded-full');
    expect(disc.className).toContain('grid');
    expect(disc.className).toContain('place-items-center');
    expect(disc.className).toContain('shadow-ambient-sm');
  });

  it('asChild renders the child as the root node (e.g. an <a>)', () => {
    render(
      <AvatarDisc asChild name="Ada Lovelace">
        <a href="/me">
          <span className="sr-only">Ada Lovelace</span>
          <span aria-hidden="true">AL</span>
        </a>
      </AvatarDisc>,
    );
    const link = screen.getByRole('link', { name: /ada lovelace/i });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/me');
    // The outer role="img" + aria-label gets merged onto the <a> via Slot.
    expect(link).toHaveAttribute('aria-label', 'Ada Lovelace');
    expect(link.className).toContain('rounded-full');
  });
});
