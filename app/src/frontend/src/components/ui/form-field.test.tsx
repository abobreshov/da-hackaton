import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormField } from './form-field';

describe('<FormField />', () => {
  it('wires label htmlFor to input id', () => {
    render(<FormField id="email" label="Email address" />);
    const input = screen.getByLabelText('Email address');
    expect(input).toHaveAttribute('id', 'email');
    expect(input.tagName).toBe('INPUT');
  });

  it('sets aria-invalid + renders inline error alert when error is provided', () => {
    render(<FormField id="email" label="Email" error="Required" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'email-error');

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Required');
    expect(alert).toHaveAttribute('id', 'email-error');
    // Field variant = polite politeness.
    expect(alert).toHaveAttribute('aria-live', 'polite');
  });

  it('does not set aria-invalid when there is no error', () => {
    render(<FormField id="email" label="Email" />);
    const input = screen.getByLabelText('Email');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('renders hint + wires aria-describedby to the hint id when no error', () => {
    render(<FormField id="pwd" label="Password" hint="At least 8 chars" />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('aria-describedby', 'pwd-hint');

    const hint = screen.getByText('At least 8 chars');
    expect(hint).toHaveAttribute('id', 'pwd-hint');
    // No error alert rendered.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('error trumps hint — hint is suppressed and aria-describedby points at error', () => {
    render(<FormField id="pwd" label="Password" hint="At least 8 chars" error="Too short" />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('aria-describedby', 'pwd-error');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    expect(screen.queryByText('At least 8 chars')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Too short');
  });

  it('renders labelAction beside the label when provided', () => {
    render(
      <FormField
        id="pwd"
        label="Password"
        labelAction={<a href="/reset-password">Forgot it?</a>}
      />,
    );
    const forgot = screen.getByRole('link', { name: /forgot it\?/i });
    expect(forgot).toBeInTheDocument();

    // labelAction sits in the same row as the label (flex justify-between wrapper).
    const wrapper = forgot.parentElement as HTMLElement;
    expect(wrapper.className).toContain('flex');
    expect(wrapper.className).toContain('justify-between');
    // Label is a sibling of the action inside the same wrapper.
    expect(wrapper.querySelector('label')).not.toBeNull();
  });

  it('forwards onChange + defaultValue to the underlying input', () => {
    const handleChange = vi.fn();
    render(<FormField id="email" label="Email" defaultValue="a@b.co" onChange={handleChange} />);
    const input = screen.getByLabelText('Email') as HTMLInputElement;
    expect(input.value).toBe('a@b.co');

    fireEvent.change(input, { target: { value: 'new@example.com' } });
    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('new@example.com');
  });

  it('forwards other InputProps (type, placeholder, autoComplete)', () => {
    render(
      <FormField
        id="email"
        label="Email"
        type="email"
        placeholder="you@example.com"
        autoComplete="email"
      />,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('placeholder', 'you@example.com');
    expect(input).toHaveAttribute('autocomplete', 'email');
  });
});
