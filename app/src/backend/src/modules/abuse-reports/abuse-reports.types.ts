/**
 * Types + repository port for EPIC-06 abuse reports. Mirrors the rooms /
 * messages / moderation pattern (port in its own file) so unit tests can
 * import the types without pulling the Drizzle / env chain.
 *
 * The service depends on `AbuseReportsRepositoryPort`; the Drizzle adapter
 * (`DrizzleAbuseReportsRepository`) and an in-memory test fake both
 * satisfy it. Keeping the partial-UNIQUE behaviour (`status='open'` dedup
 * → 23505) in the adapter lets the service map errors uniformly without
 * peeking at the underlying engine.
 */

export type TargetType = 'message' | 'user';
export type ReportStatus = 'open' | 'resolved' | 'dismissed';

export interface AbuseReportRow {
  id: bigint;
  reporterId: number;
  targetType: TargetType;
  targetId: bigint;
  reason: string;
  status: ReportStatus;
  resolvedBy: number | null;
  resolvedAt: Date | null;
  createdAt: Date | null;
}

export interface InsertAbuseReportInput {
  reporterId: number;
  targetType: TargetType;
  targetId: bigint;
  reason: string;
}

export interface ListOpenRepoInput {
  limit: number;
  before?: { createdAt: Date; id: bigint };
}

export interface UserRoleRow {
  id: number;
  role: string;
}

export interface AbuseReportsRepositoryPort {
  /**
   * Insert a new abuse report (status defaults to 'open' at the schema
   * layer). The adapter is expected to re-throw the partial-UNIQUE
   * violation (`err.code === '23505'`) unchanged so the service can map
   * to wire-level CONFLICT.
   */
  insert(input: InsertAbuseReportInput): Promise<AbuseReportRow>;

  /**
   * Fetch the user record for an admin-gate check. Returns null when
   * there is no such user.
   */
  findUserById(id: number): Promise<UserRoleRow | null>;

  /**
   * Keyset-paginated list of open reports DESC by (createdAt, id).
   */
  listOpen(input: ListOpenRepoInput): Promise<AbuseReportRow[]>;

  findById(id: bigint): Promise<AbuseReportRow | null>;

  /**
   * Update status + resolver bookkeeping. Returns nothing — the caller
   * already verified existence via `findById`.
   */
  updateStatus(
    id: bigint,
    status: Exclude<ReportStatus, 'open'>,
    resolvedBy: number,
    resolvedAt: Date,
  ): Promise<void>;
}

export const ABUSE_REPORTS_REPOSITORY = Symbol('ABUSE_REPORTS_REPOSITORY');
