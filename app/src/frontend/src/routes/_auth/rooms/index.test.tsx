import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
}));

const navigateMock = vi.fn();

// Wholesale mock of `@/lib/rooms` so no test touches real fetch.
const listCatalogMock = vi.fn();
const createRoomMock = vi.fn();
vi.mock('@/lib/rooms', () => ({
  listCatalog: (...args: unknown[]) => listCatalogMock(...args),
  createRoom: (...args: unknown[]) => createRoomMock(...args),
  joinRoom: vi.fn(),
  leaveRoom: vi.fn(),
}));

import { Route } from './index';

const getComponent = () =>
  (Route as unknown as { options: { component: () => JSX.Element } }).options.component;

// Drop any portaled nodes between tests — RTL's `cleanup()` only unmounts
// the container it rendered into, leaving `createPortal` escapees behind.
function removeStrayPortals(): void {
  Array.from(document.body.children).forEach((child) => {
    if ((child as HTMLElement).dataset?.testid === 'create-room-dialog') {
      child.remove();
    }
  });
}

describe('<RoomsCatalog /> (/rooms)', () => {
  beforeEach(() => {
    listCatalogMock.mockReset();
    createRoomMock.mockReset();
    navigateMock.mockReset();
  });
  afterEach(() => {
    cleanup();
    removeStrayPortals();
  });

  it('invokes listCatalog() on mount', async () => {
    listCatalogMock.mockResolvedValueOnce({ rooms: [], total: 0 });
    const RoomsCatalog = getComponent();
    render(<RoomsCatalog />);

    await waitFor(() => expect(listCatalogMock).toHaveBeenCalledTimes(1));
  });

  it('shows a loading skeleton while the request is pending', async () => {
    let resolve: (v: { rooms: []; total: 0 }) => void = () => {};
    listCatalogMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const RoomsCatalog = getComponent();
    render(<RoomsCatalog />);

    expect(screen.getByTestId('rooms-loading')).toBeInTheDocument();

    await act(async () => {
      resolve({ rooms: [], total: 0 });
    });
    await waitFor(() => expect(screen.queryByTestId('rooms-loading')).not.toBeInTheDocument());
  });

  it('renders empty state when catalog is empty', async () => {
    listCatalogMock.mockResolvedValueOnce({ rooms: [], total: 0 });
    const RoomsCatalog = getComponent();
    render(<RoomsCatalog />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /no public rooms yet/i })).toBeInTheDocument();
    });
  });

  it('renders a list of rooms (name, description, member count) when non-empty', async () => {
    listCatalogMock.mockResolvedValueOnce({
      rooms: [
        { id: 1, name: 'general', description: 'Everyone welcome', memberCount: 12 },
        { id: 2, name: 'random', description: 'Off-topic chatter', memberCount: 3 },
      ],
      total: 2,
    });
    const RoomsCatalog = getComponent();
    render(<RoomsCatalog />);

    await waitFor(() => {
      expect(screen.getByText('general')).toBeInTheDocument();
    });
    expect(screen.getByText('random')).toBeInTheDocument();
    expect(screen.getByText('Everyone welcome')).toBeInTheDocument();
    expect(screen.getByText('Off-topic chatter')).toBeInTheDocument();
    expect(screen.getByText(/12 members?/i)).toBeInTheDocument();
    expect(screen.getByText(/3 members?/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /no public rooms yet/i })).not.toBeInTheDocument();
  });

  it('renders error message + retry button when listCatalog throws, retries on click', async () => {
    listCatalogMock.mockRejectedValueOnce(new Error('Backend is down'));
    const RoomsCatalog = getComponent();
    render(<RoomsCatalog />);

    await waitFor(() => {
      expect(screen.getByText(/backend is down/i)).toBeInTheDocument();
    });
    const retry = screen.getByRole('button', { name: /retry/i });
    expect(retry).toBeInTheDocument();

    listCatalogMock.mockResolvedValueOnce({ rooms: [], total: 0 });
    await act(async () => {
      fireEvent.click(retry);
    });
    await waitFor(() => {
      expect(screen.queryByText(/backend is down/i)).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /no public rooms yet/i })).toBeInTheDocument();
    });
    expect(listCatalogMock).toHaveBeenCalledTimes(2);
  });
});

describe('<CreateRoomDialog /> (/rooms — create flow)', () => {
  beforeEach(() => {
    listCatalogMock.mockReset();
    createRoomMock.mockReset();
    navigateMock.mockReset();
    listCatalogMock.mockResolvedValue({ rooms: [], total: 0 });
  });
  afterEach(() => {
    cleanup();
    removeStrayPortals();
  });

  const renderRoute = () => {
    const RoomsCatalog = getComponent();
    return render(<RoomsCatalog />);
  };

  it('header "Create room" button opens the modal', async () => {
    const { container } = renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('create-room-button')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('create-room-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('create-room-button'));

    const dialog = await screen.findByTestId('create-room-dialog');
    expect(dialog).toBeInTheDocument();
    // Portal assertion: dialog must live on document.body, not inside the
    // route wrapper (`animate-fade-up` would retarget position:fixed).
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
  });

  it('submit button is disabled when name is empty or below min length', async () => {
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('create-room-button')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('create-room-button'));

    const submit = await screen.findByTestId('create-room-submit');
    expect(submit).toBeDisabled();

    // 1 char still below min (2) — stays disabled.
    fireEvent.change(screen.getByTestId('create-room-name'), { target: { value: 'a' } });
    expect(submit).toBeDisabled();

    // 2 chars passes threshold.
    fireEvent.change(screen.getByTestId('create-room-name'), { target: { value: 'ab' } });
    expect(submit).not.toBeDisabled();
  });

  it('valid submit calls createRoom with {name, description, visibility}', async () => {
    createRoomMock.mockResolvedValueOnce({
      id: 42,
      name: 'hackers',
      description: 'welcome all',
      visibility: 'private',
      ownerId: 7,
    });
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('create-room-button')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('create-room-button'));

    fireEvent.change(await screen.findByTestId('create-room-name'), {
      target: { value: 'hackers' },
    });
    fireEvent.change(screen.getByTestId('create-room-description'), {
      target: { value: 'welcome all' },
    });
    fireEvent.click(screen.getByTestId('create-room-visibility-private'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('create-room-submit'));
    });

    expect(createRoomMock).toHaveBeenCalledWith({
      name: 'hackers',
      description: 'welcome all',
      visibility: 'private',
    });
  });

  it('on success: closes modal and navigates to /rooms/$roomId', async () => {
    createRoomMock.mockResolvedValueOnce({
      id: 99,
      name: 'hackers',
      description: null,
      visibility: 'public',
      ownerId: 1,
    });
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('create-room-button')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('create-room-button'));

    fireEvent.change(await screen.findByTestId('create-room-name'), {
      target: { value: 'hackers' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('create-room-submit'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('create-room-dialog')).not.toBeInTheDocument();
    });
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/rooms/$roomId',
      params: { roomId: '99' },
    });
  });

  it('on ApiError: surfaces message inside the modal and keeps it open', async () => {
    const { ApiError } = await import('@/lib/api-client');
    const { ErrorCode } = await import('@app/contracts');
    createRoomMock.mockRejectedValueOnce(
      new ApiError({
        status: 409,
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Name already taken.',
      }),
    );
    renderRoute();
    await waitFor(() => {
      expect(screen.getByTestId('create-room-button')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('create-room-button'));

    fireEvent.change(await screen.findByTestId('create-room-name'), {
      target: { value: 'dup-room' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('create-room-submit'));
    });

    expect(screen.getByTestId('create-room-dialog')).toBeInTheDocument();
    expect(screen.getByText(/name already taken/i)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
