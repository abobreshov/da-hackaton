import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ActorType, AuditAppendInput, AuditService } from '../../modules/audit/audit.service';
import { EVENT_PUBLISHER, IEventPublisher } from './event-publisher.interface';

/**
 * Per-event mapper from a domain event payload to an `AuditAppendInput`.
 * Returning `null` skips the audit append (defensive — payload was malformed).
 */
type EventMap = {
  [event: string]: (payload: any) => AuditAppendInput | null;
};

/**
 * Translates EPIC-06 moderation + report domain events into audit-log
 * writes. Producer services (`ModerationService`, `AbuseReportsService`)
 * stay ignorant of the audit module; they `events.emit('room.ban', ...)`
 * and this subscriber translates the event into `audit.append(...)`.
 *
 * Wired as a provider in `EventsModule`. `onApplicationBootstrap` runs
 * after every module's providers exist, which guarantees the publisher
 * (a global, app-wide singleton) is ready when we register handlers.
 *
 * Failure isolation: `AuditService.append()` already swallows + logs its
 * own errors so the subscriber stays best-effort.
 */
@Injectable()
export class AuditSubscriber implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuditSubscriber.name);

  constructor(
    @Inject(EVENT_PUBLISHER)
    private readonly events: IEventPublisher,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    for (const [event, mapper] of Object.entries(this.handlers())) {
      this.events.on(event, async (payload) => {
        const input = mapper(payload);
        if (!input) {
          this.logger.debug(`audit.subscriber skip event=${event} (no input from mapper)`);
          return;
        }
        await this.audit.append(input);
      });
    }
  }

  /** Public for unit tests — mapping table is the actual contract. */
  handlers(): EventMap {
    return {
      'room.ban': (p) => banPayloadToAudit(p, 'room.ban'),
      'room.unban': (p) => banPayloadToAudit(p, 'room.unban'),
      'room.role.promote': (p) => roleChangeToAudit(p, 'room.role.promote', 'admin'),
      'room.role.demote': (p) => roleChangeToAudit(p, 'room.role.demote', 'member'),
      'room.delete': (p) => roomDeleteToAudit(p),
      'report.create': (p) => reportCreateToAudit(p),
      'report.resolve': (p) => reportResolveToAudit(p, 'report.resolve'),
      'report.dismiss': (p) => reportResolveToAudit(p, 'report.dismiss'),
    };
  }
}

// ---------------------------------------------------------------------------
// payload mappers — pulled out so unit tests can target them directly.
// ---------------------------------------------------------------------------

function bigOf(v: unknown): bigint | null {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(v);
  if (typeof v === 'string' && v.length > 0) {
    try {
      return BigInt(v);
    } catch {
      return null;
    }
  }
  return null;
}

function banPayloadToAudit(p: any, action: 'room.ban' | 'room.unban'): AuditAppendInput | null {
  if (!p) return null;
  const targetId = bigOf(p.userId);
  if (targetId == null) return null;
  return {
    actorId: typeof p.actorId === 'number' ? p.actorId : null,
    actorType: 'admin' satisfies ActorType,
    action,
    targetType: 'user',
    targetId,
    metadata: { roomId: p.roomId },
  };
}

function roleChangeToAudit(
  p: any,
  action: 'room.role.promote' | 'room.role.demote',
  newRole: 'admin' | 'member',
): AuditAppendInput | null {
  if (!p) return null;
  const targetId = bigOf(p.userId);
  if (targetId == null) return null;
  return {
    actorId: typeof p.actorId === 'number' ? p.actorId : null,
    actorType: 'admin' satisfies ActorType,
    action,
    targetType: 'user',
    targetId,
    metadata: { roomId: p.roomId, newRole },
  };
}

function roomDeleteToAudit(p: any): AuditAppendInput | null {
  if (!p) return null;
  const targetId = bigOf(p.roomId);
  if (targetId == null) return null;
  return {
    actorId: typeof p.actorId === 'number' ? p.actorId : null,
    actorType: 'admin' satisfies ActorType,
    action: 'room.delete',
    targetType: 'room',
    targetId,
    metadata: { roomId: p.roomId },
  };
}

function reportCreateToAudit(p: any): AuditAppendInput | null {
  if (!p) return null;
  const targetId = bigOf(p.reportId);
  if (targetId == null) return null;
  return {
    actorId: typeof p.actorId === 'number' ? p.actorId : null,
    actorType: 'user' satisfies ActorType,
    action: 'report.create',
    targetType: 'abuse_report',
    targetId,
    metadata: { targetType: p.targetType, targetId: bigOf(p.targetId)?.toString() ?? null },
  };
}

function reportResolveToAudit(
  p: any,
  action: 'report.resolve' | 'report.dismiss',
): AuditAppendInput | null {
  if (!p) return null;
  const targetId = bigOf(p.reportId);
  if (targetId == null) return null;
  return {
    actorId: typeof p.actorId === 'number' ? p.actorId : null,
    actorType: 'admin' satisfies ActorType,
    action,
    targetType: 'abuse_report',
    targetId,
    metadata: p.note ? { note: p.note } : undefined,
  };
}
