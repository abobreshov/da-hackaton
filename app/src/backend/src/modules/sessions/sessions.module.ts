import { Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { SessionsTcpController } from './sessions.tcp';
import { DrizzleSessionsRepository } from './sessions.repository';
import { SESSIONS_REPOSITORY } from './sessions.types';

/**
 * EPIC-02 §2.2.4 active-sessions module. Pure backend feature; no
 * scheduler, no workers. TCP-only surface consumed by:
 *   - auth-service (sessions.recordLogin) on successful login.
 *   - BFF (sessions.listForUser, sessions.revoke) for the active-sessions UI.
 */
@Module({
  controllers: [SessionsTcpController],
  providers: [
    SessionsService,
    { provide: SESSIONS_REPOSITORY, useClass: DrizzleSessionsRepository },
  ],
  exports: [SessionsService],
})
export class SessionsModule {}
