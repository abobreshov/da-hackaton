import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MessageComposer, MAX_BODY_LENGTH } from './message-composer';
import type { Message } from '@/lib/messages';

const baseMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 1n,
  roomId: 42,
  dmId: null,
  author: { id: 1, username: 'alice' },
  body: 'hello',
  replyTo: null,
  editedAt: null,
  deletedAt: null,
  createdAt: '2026-04-20T10:00:00.000Z',
  ...overrides,
});

describe('<MessageComposer />', () => {
  it('renders the textarea and send button with the expected testids', () => {
    render(<MessageComposer onSubmit={() => {}} />);
    expect(screen.getByTestId('message-composer-input')).toBeInTheDocument();
    expect(screen.getByTestId('message-composer-send')).toBeInTheDocument();
  });

  it('disables send when the input is empty', () => {
    render(<MessageComposer onSubmit={() => {}} />);
    expect(screen.getByTestId('message-composer-send')).toBeDisabled();
  });

  it('enables send when the user types', () => {
    render(<MessageComposer onSubmit={() => {}} />);
    fireEvent.change(screen.getByTestId('message-composer-input'), {
      target: { value: 'hi' },
    });
    expect(screen.getByTestId('message-composer-send')).not.toBeDisabled();
  });

  it('disables send when body is whitespace only', () => {
    render(<MessageComposer onSubmit={() => {}} />);
    fireEvent.change(screen.getByTestId('message-composer-input'), {
      target: { value: '   \n  ' },
    });
    expect(screen.getByTestId('message-composer-send')).toBeDisabled();
  });

  it('submits on Enter and clears the input', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MessageComposer onSubmit={onSubmit} />);
    const input = screen.getByTestId('message-composer-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    });
    expect(onSubmit).toHaveBeenCalledWith('hello');
    expect(input.value).toBe('');
  });

  it('inserts a newline on Shift+Enter (does NOT submit)', () => {
    const onSubmit = vi.fn();
    render(<MessageComposer onSubmit={onSubmit} />);
    const input = screen.getByTestId('message-composer-input');
    fireEvent.change(input, { target: { value: 'line1' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('surfaces a too-long error and disables send beyond MAX_BODY_LENGTH', () => {
    render(<MessageComposer onSubmit={() => {}} />);
    fireEvent.change(screen.getByTestId('message-composer-input'), {
      target: { value: 'x'.repeat(MAX_BODY_LENGTH + 1) },
    });
    expect(screen.getByTestId('message-composer-error')).toBeInTheDocument();
    expect(screen.getByTestId('message-composer-send')).toBeDisabled();
  });

  it('renders the reply strip when replyingTo is set and fires onCancelReply', () => {
    const onCancelReply = vi.fn();
    render(
      <MessageComposer
        onSubmit={() => {}}
        replyingTo={baseMessage({ body: 'hi there' })}
        onCancelReply={onCancelReply}
      />,
    );
    const strip = screen.getByTestId('message-composer-reply-strip');
    expect(strip).toHaveTextContent(/alice/);
    expect(strip).toHaveTextContent(/hi there/);
    fireEvent.click(screen.getByTestId('message-composer-cancel-reply'));
    expect(onCancelReply).toHaveBeenCalled();
  });

  it('disables the composer when frozen is true', () => {
    render(<MessageComposer onSubmit={() => {}} frozen={true} />);
    expect(screen.getByTestId('message-composer-input')).toBeDisabled();
    expect(screen.getByTestId('message-composer-send')).toBeDisabled();
  });

  it('does not call onSubmit when Enter is pressed on an empty input', () => {
    const onSubmit = vi.fn();
    render(<MessageComposer onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByTestId('message-composer-input'), {
      key: 'Enter',
      shiftKey: false,
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
