import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { UserPopover } from './user-popover';

// TanStack router mock — the component uses useNavigate when no onOpenDm is supplied.
const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const openPopover = () => {
  const trigger = screen.getByRole('button', { name: /open .* actions/i });
  fireEvent.click(trigger);
};

describe('<UserPopover />', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    navigateMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'csrf=tok',
      set: () => {},
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders trigger children wrapped in a button and stays closed by default', () => {
    render(
      <UserPopover userId={1} username="alice" isFriend={false} isBlocked={false}>
        alice
      </UserPopover>,
    );
    expect(screen.getByTestId('user-popover-trigger')).toBeInTheDocument();
    expect(screen.queryByTestId('user-popover')).not.toBeInTheDocument();
  });

  it('opens the popover panel when the trigger is clicked', () => {
    render(
      <UserPopover userId={1} username="alice" isFriend={false} isBlocked={false}>
        alice
      </UserPopover>,
    );
    openPopover();
    expect(screen.getByTestId('user-popover')).toBeInTheDocument();
  });

  it('shows Add friend when !isFriend and triggers sendFriendRequest by username', async () => {
    render(
      <UserPopover userId={7} username="alice" isFriend={false} isBlocked={false}>
        alice
      </UserPopover>,
    );
    openPopover();

    const add = screen.getByTestId('user-popover-action-add-friend');
    expect(add).toBeInTheDocument();
    expect(screen.queryByTestId('user-popover-action-remove-friend')).not.toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 100 }, 201));
    await act(async () => {
      fireEvent.click(add);
    });

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(calls.some((u) => /\/api\/v1\/friends\/requests$/.test(u))).toBe(true);
    });
    const createCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/api\/v1\/friends\/requests$/.test(c[0] as string),
    );
    const body = JSON.parse((createCall![1] as RequestInit).body as string);
    expect(body).toEqual({ username: 'alice' });

    // Popover closes after success.
    await waitFor(() => {
      expect(screen.queryByTestId('user-popover')).not.toBeInTheDocument();
    });
  });

  it('shows Remove friend when isFriend and calls DELETE /friends/:userId', async () => {
    render(
      <UserPopover userId={7} username="alice" isFriend={true} isBlocked={false}>
        alice
      </UserPopover>,
    );
    openPopover();

    expect(screen.queryByTestId('user-popover-action-add-friend')).not.toBeInTheDocument();
    const remove = screen.getByTestId('user-popover-action-remove-friend');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await act(async () => {
      fireEvent.click(remove);
    });

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && /\/api\/v1\/friends\/7$/.test(c[0] as string),
      );
      expect(call).toBeTruthy();
      expect((call![1] as RequestInit).method).toBe('DELETE');
    });
  });

  it('shows Block when !isBlocked and POSTs /users/:id/ban', async () => {
    render(
      <UserPopover userId={7} username="alice" isFriend={true} isBlocked={false}>
        alice
      </UserPopover>,
    );
    openPopover();

    const block = screen.getByTestId('user-popover-action-block');
    expect(screen.queryByTestId('user-popover-action-unblock')).not.toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await act(async () => {
      fireEvent.click(block);
    });

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && /\/api\/v1\/users\/7\/ban$/.test(c[0] as string),
      );
      expect(call).toBeTruthy();
      expect((call![1] as RequestInit).method).toBe('POST');
    });

    await waitFor(() => {
      expect(screen.queryByTestId('user-popover')).not.toBeInTheDocument();
    });
  });

  it('shows Unblock when isBlocked and DELETEs /users/:id/ban', async () => {
    render(
      <UserPopover userId={7} username="alice" isFriend={false} isBlocked={true}>
        alice
      </UserPopover>,
    );
    openPopover();

    expect(screen.queryByTestId('user-popover-action-block')).not.toBeInTheDocument();
    const unblock = screen.getByTestId('user-popover-action-unblock');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await act(async () => {
      fireEvent.click(unblock);
    });

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && /\/api\/v1\/users\/7\/ban$/.test(c[0] as string),
      );
      expect(call).toBeTruthy();
      expect((call![1] as RequestInit).method).toBe('DELETE');
    });
  });

  it('opens a reason form for Report and submits to /api/v1/reports', async () => {
    render(
      <UserPopover userId={7} username="alice" isFriend={false} isBlocked={false}>
        alice
      </UserPopover>,
    );
    openPopover();

    const reportBtn = screen.getByTestId('user-popover-action-report');
    fireEvent.click(reportBtn);

    const textarea = screen.getByTestId('user-popover-report-reason') as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.getAttribute('maxlength')).toBe('500');

    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 55 }, 201));
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'spamming me' } });
      fireEvent.click(screen.getByTestId('user-popover-report-submit'));
    });

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && /\/api\/v1\/reports$/.test(c[0] as string),
      );
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body).toEqual({ targetType: 'user', targetId: 7, reason: 'spamming me' });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('user-popover')).not.toBeInTheDocument();
    });
  });

  it('Open DM calls onOpenDm when supplied, bypassing navigate', async () => {
    const onOpenDm = vi.fn();
    render(
      <UserPopover
        userId={7}
        username="alice"
        isFriend={true}
        isBlocked={false}
        onOpenDm={onOpenDm}
      >
        alice
      </UserPopover>,
    );
    openPopover();

    const dm = screen.getByTestId('user-popover-action-open-dm');
    await act(async () => {
      fireEvent.click(dm);
    });
    expect(onOpenDm).toHaveBeenCalledWith(7);
    expect(navigateMock).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByTestId('user-popover')).not.toBeInTheDocument();
    });
  });

  it('Open DM navigates to /dm/:userId when no onOpenDm is supplied', async () => {
    render(
      <UserPopover userId={7} username="alice" isFriend={true} isBlocked={false}>
        alice
      </UserPopover>,
    );
    openPopover();

    await act(async () => {
      fireEvent.click(screen.getByTestId('user-popover-action-open-dm'));
    });
    expect(navigateMock).toHaveBeenCalledWith({ to: '/dm/$userId', params: { userId: '7' } });
  });

  it('invokes onClose when popover closes after a successful action', async () => {
    const onClose = vi.fn();
    render(
      <UserPopover
        userId={7}
        username="alice"
        isFriend={false}
        isBlocked={false}
        onClose={onClose}
      >
        alice
      </UserPopover>,
    );
    openPopover();

    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1 }, 201));
    await act(async () => {
      fireEvent.click(screen.getByTestId('user-popover-action-add-friend'));
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('closes on Escape key', () => {
    render(
      <UserPopover userId={7} username="alice" isFriend={false} isBlocked={false}>
        alice
      </UserPopover>,
    );
    openPopover();
    expect(screen.getByTestId('user-popover')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('user-popover')).not.toBeInTheDocument();
  });
});
