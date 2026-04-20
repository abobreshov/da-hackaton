import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { listCatalog, type CatalogRoom } from '@/lib/rooms';
import { ApiError } from '@/lib/api-client';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/_auth/rooms/')({
  component: RoomsCatalog,
});

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; rooms: CatalogRoom[] }
  | { status: 'error'; message: string };

export function RoomsCatalog() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const { rooms } = await listCatalog();
      setState({ status: 'ok', rooms });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to load rooms';
      setState({ status: 'error', message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-3xl">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Rooms</h1>
        <p className="text-sm text-gray-500 mt-1">
          Browse public rooms the community has opened up.
        </p>
      </header>

      {state.status === 'loading' && (
        <div data-testid="rooms-loading" className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 rounded-lg border border-gray-100 bg-gray-50 animate-pulse"
            />
          ))}
        </div>
      )}

      {state.status === 'error' && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-red-700">Couldn&apos;t load rooms</p>
            <p className="text-sm text-red-600 mt-1">{state.message}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      {state.status === 'ok' && state.rooms.length === 0 && (
        <EmptyState
          title="No public rooms yet"
          description="Once people open up public rooms they'll show up here."
          action={
            <Button type="button" disabled>
              Create room
            </Button>
          }
        />
      )}

      {state.status === 'ok' && state.rooms.length > 0 && (
        <ul className="space-y-3" aria-label="Public rooms">
          {state.rooms.map((room) => (
            <li
              key={room.id}
              className="rounded-lg border border-gray-200 bg-white p-4 flex items-start justify-between gap-4"
            >
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-gray-900 truncate">
                  {room.name}
                </h2>
                {room.description && (
                  <p className="text-sm text-gray-600 mt-1">{room.description}</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-gray-500">
                {room.memberCount} {room.memberCount === 1 ? 'member' : 'members'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
