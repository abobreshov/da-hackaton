import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormError } from './form-error';

describe('<FormError />', () => {
  it('renders nothing when children is null', () => {
    const { container } = render(<FormError>{null}</FormError>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when children is undefined', () => {
    const { container } = render(<FormError>{undefined}</FormError>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when children is an empty string', () => {
    const { container } = render(<FormError>{''}</FormError>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('default variant is "block" — role alert, aria-live assertive, text visible', () => {
    render(<FormError>Bad</FormError>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Bad');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    // Block variant uses the error-container tonal card classes.
    expect(alert.className).toContain('rounded-xl');
    expect(alert.className).toContain('bg-error-container/80');
    expect(alert.className).toContain('text-on-error-container');
  });

  it('variant="field" uses aria-live polite + inline classes', () => {
    render(<FormError variant="field">Required</FormError>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Required');
    expect(alert).toHaveAttribute('aria-live', 'polite');
    expect(alert.className).toContain('ml-1');
    expect(alert.className).toContain('text-body-sm');
    expect(alert.className).toContain('text-error');
    // Field variant must NOT have the block card classes.
    expect(alert.className).not.toContain('bg-error-container');
  });

  it('forwards extra props (id, className, data-*) to root element', () => {
    render(
      <FormError id="email-error" className="custom" data-testid="fe">
        Broken
      </FormError>,
    );
    const alert = screen.getByTestId('fe');
    expect(alert).toHaveAttribute('id', 'email-error');
    expect(alert.className).toContain('custom');
  });
});
