import { MessageList } from '@/components/chat/message-list';
import { MessageComposer } from '@/components/chat/message-composer';
import { useMessages } from '@/hooks/useMessages';

/**
 * Chat viewport for a single room.
 *
 * Owns the live message stream (`useMessages`) plus the list/composer pair,
 * so the orchestrator route only deals with join state + role gating. The
 * outer surface (rounded panel, padding) is rendered here so the viewport
 * is drop-in for both rooms and DMs once the DM route adopts it.
 *
 * `roomId` is `undefined` until the route has parsed a finite numeric param
 * (matches `useMessages`' contract: `undefined` keys disable hydration).
 */
export interface RoomChatViewportProps {
  roomId: number | undefined;
  currentUserId: number | null | undefined;
}

export function RoomChatViewport({ roomId, currentUserId }: RoomChatViewportProps) {
  const { messages, sendMessage, loadOlder, hasMore } = useMessages({ roomId });

  return (
    <div className="mt-8 flex flex-1 flex-col overflow-hidden rounded-[1.5rem] bg-surface-container-low">
      <div className="flex-1 overflow-hidden">
        <MessageList
          messages={messages}
          currentUserId={currentUserId}
          hasMore={hasMore}
          onLoadOlder={loadOlder}
        />
      </div>
      <div className="border-0 px-4 pb-4 pt-2">
        <MessageComposer
          onSubmit={async (body) => {
            await sendMessage({ body });
          }}
        />
      </div>
    </div>
  );
}
