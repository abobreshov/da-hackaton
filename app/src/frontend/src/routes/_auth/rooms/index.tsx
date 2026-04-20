import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { listCatalog, type CatalogRoom } from '@/lib/rooms';
import { ApiError } from '@/lib/api-client';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { GlassCard, SectionHeading } from '@/components/ui/surface';

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
    <div className="animate-fade-up flex max-w-3xl flex-col gap-8">
      <header>
        <SectionHeading level="h1" eyebrow="Community" title="Rooms" />
        <p className="mt-3 max-w-xl font-body text-body-lg text-on-surface-variant">
          Browse public rooms the community has opened up.
        </p>
      </header>

      {state.status === 'loading' && (
        <div data-testid="rooms-loading" className="flex flex-col gap-4" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-[2rem] bg-surface-container-low/60"
            />
          ))}
        </div>
      )}

      {state.status === 'error' && (
        <FormError className="flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-title-sm font-semibold">Couldn&apos;t load rooms</p>
            <p className="mt-1 font-body text-body-md">{state.message}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </FormError>
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
        <ul className="flex flex-col gap-4" aria-label="Public rooms">
          {state.rooms.map((room) => (
            <li key={room.id}>
              <GlassCard
                as="article"
                radius="lg"
                padding="md"
                shadow="ambient"
                className="flex items-start justify-between gap-4"
              >
                <div className="min-w-0">
                  <h2 className="truncate font-display text-title-md font-bold text-on-surface">
                    {room.name}
                  </h2>
                  {room.description && (
                    <p className="mt-1 font-body text-body-md text-on-surface-variant">
                      {room.description}
                    </p>
                  )}
                </div>
                <span className="shrink-0 font-display text-label-md font-semibold text-on-surface-variant">
                  {room.memberCount} {room.memberCount === 1 ? 'member' : 'members'}
                </span>
              </GlassCard>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
