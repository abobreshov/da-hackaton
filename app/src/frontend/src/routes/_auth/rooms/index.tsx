import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoom, listCatalog, type CatalogRoom } from '@/lib/rooms';
import { ApiError } from '@/lib/api-client';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard, SectionHeading } from '@/components/ui/surface';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_auth/rooms/')({
  component: RoomsCatalog,
});

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; rooms: CatalogRoom[] }
  | { status: 'error'; message: string };

const NAME_MIN = 2;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;

export function RoomsCatalog() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [createOpen, setCreateOpen] = useState(false);

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
    <div className="animate-fade-up flex flex-col gap-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <SectionHeading level="h1" eyebrow="Community" title="Rooms" />
          <p className="mt-3 max-w-xl font-body text-body-lg text-on-surface-variant">
            Browse public rooms the community has opened up.
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          size="md"
          data-testid="create-room-button"
          onClick={() => setCreateOpen(true)}
        >
          Create room
        </Button>
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
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Create room
            </Button>
          }
        />
      )}

      {state.status === 'ok' && state.rooms.length > 0 && (
        <ul className="flex flex-col gap-4" aria-label="Public rooms">
          {state.rooms.map((room) => (
            <li key={room.id}>
              <Link
                to="/rooms/$roomId"
                params={{ roomId: String(room.id) }}
                className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-[2rem]"
                aria-label={`Open ${room.name}`}
              >
                <GlassCard
                  as="article"
                  radius="lg"
                  padding="md"
                  shadow="ambient"
                  className="flex items-start justify-between gap-4 transition-transform hover:scale-[1.01]"
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
                    {typeof room.memberCount === 'number'
                      ? `${room.memberCount} ${room.memberCount === 1 ? 'member' : 'members'}`
                      : 'members'}
                  </span>
                </GlassCard>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {createOpen ? <CreateRoomDialog onClose={() => setCreateOpen(false)} /> : null}
    </div>
  );
}

interface CreateRoomDialogProps {
  onClose: () => void;
}

/**
 * Portal'd create-room dialog.
 *
 * Portal'd to `document.body` for the same reason as `$roomId.tsx`'s
 * delete-confirmation dialog: the outer `animate-fade-up` wrapper creates
 * a `transform` containing-block that retargets `position:fixed`, so an
 * inline modal would pin to the left column instead of the viewport.
 */
function CreateRoomDialog({ onClose }: CreateRoomDialogProps): React.ReactElement {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const nameValid = trimmedName.length >= NAME_MIN && trimmedName.length <= NAME_MAX;
  const descriptionValid = trimmedDescription.length <= DESCRIPTION_MAX;
  const canSubmit = nameValid && descriptionValid && !submitting;

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createRoom({
        name: trimmedName,
        ...(trimmedDescription.length > 0 ? { description: trimmedDescription } : {}),
        visibility,
      });
      onClose();
      void navigate({
        to: '/rooms/$roomId',
        params: { roomId: String(created.id) },
      });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to create room.';
      setError(message);
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-room-title"
      data-testid="create-room-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <form
        className="mx-4 flex w-full max-w-lg flex-col gap-5 rounded-[1.75rem] bg-surface-container px-6 py-6 shadow-ambient-xl"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <div>
          <p className="font-display text-label-lg font-semibold uppercase tracking-[0.18em] text-on-surface-variant">
            New room
          </p>
          <h2
            id="create-room-title"
            className="mt-1 font-display text-headline-sm font-extrabold text-on-surface"
          >
            Create a room
          </h2>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="create-room-name">Name</Label>
          <Input
            id="create-room-name"
            data-testid="create-room-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. rubber-duck-club"
            minLength={NAME_MIN}
            maxLength={NAME_MAX}
            autoFocus
            required
          />
          <p className="ml-1 font-body text-body-sm text-on-surface-variant">
            {NAME_MIN}–{NAME_MAX} characters.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="create-room-description">Description (optional)</Label>
          <textarea
            id="create-room-description"
            data-testid="create-room-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this room for?"
            maxLength={DESCRIPTION_MAX}
            rows={3}
            className="min-h-[5rem] w-full resize-y rounded-[1.5rem] bg-surface-container-low px-5 py-3 font-body text-body-md text-on-surface placeholder:text-on-surface-variant/60 focus:bg-surface-container focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <p className="ml-1 font-body text-body-sm text-on-surface-variant">
            {description.length}/{DESCRIPTION_MAX}
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-display text-label-lg font-semibold tracking-wide text-on-surface">
            Visibility
          </legend>
          <div
            role="radiogroup"
            aria-label="Visibility"
            className="flex flex-col gap-2 sm:flex-row"
          >
            <VisibilityOption
              value="public"
              checked={visibility === 'public'}
              onChange={() => setVisibility('public')}
              title="Public"
              hint="Shows in the catalog for anyone."
              disabled={submitting}
            />
            <VisibilityOption
              value="private"
              checked={visibility === 'private'}
              onChange={() => setVisibility('private')}
              title="Private"
              hint="Invite-only — hidden from the catalog."
              disabled={submitting}
            />
          </div>
        </fieldset>

        <FormError>{error}</FormError>

        <div className="mt-1 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            data-testid="create-room-submit"
            disabled={!canSubmit}
          >
            {submitting ? 'Creating…' : 'Create room'}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

interface VisibilityOptionProps {
  value: 'public' | 'private';
  checked: boolean;
  onChange: () => void;
  title: string;
  hint: string;
  disabled?: boolean;
}

/**
 * Tonal radio tile. Selected state lifts the surface tier
 * (`surface_container_low` → `primary_container/60`) AND renders an outline
 * ring in `primary` so the selection is legible on quick-scan without
 * relying on the colour shift alone. `ring` is used instead of `border` so
 * we don't add a sectioning 1 px rule (design-system rule) and so the ring
 * composes cleanly with the existing rounded-[1.25rem] shape. The keyboard
 * focus ring stacks on top via `focus-within:ring-offset`.
 */
function VisibilityOption({
  value,
  checked,
  onChange,
  title,
  hint,
  disabled,
}: VisibilityOptionProps): React.ReactElement {
  return (
    <label
      className={cn(
        'flex-1 cursor-pointer rounded-[1.25rem] px-4 py-3 transition-all',
        'ring-2 ring-inset',
        checked
          ? 'bg-primary-container/70 text-on-primary-container ring-primary/70 shadow-ambient'
          : 'bg-surface-container-low text-on-surface ring-transparent hover:bg-surface-container hover:ring-outline-variant/40',
        'focus-within:ring-primary focus-within:ring-offset-2 focus-within:ring-offset-surface',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        type="radio"
        name="create-room-visibility"
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        data-testid={`create-room-visibility-${value}`}
        className="sr-only"
      />
      <span className="block font-display text-title-sm font-semibold">{title}</span>
      <span
        className={cn(
          'mt-1 block font-body text-body-sm',
          checked ? 'text-on-primary-container/80' : 'text-on-surface-variant',
        )}
      >
        {hint}
      </span>
    </label>
  );
}
