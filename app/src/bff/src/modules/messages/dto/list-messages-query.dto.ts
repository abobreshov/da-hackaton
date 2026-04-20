import { Transform } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * Query string for paginated message history fetches.
 *
 * Cursor is `(before, beforeId)` — both optional, both server-interpreted.
 * `limit` is clamped client-side (1..100) and defaults to 50 when omitted.
 */
export class ListMessagesQueryDto {
  /** ISO-8601 timestamp of the oldest already-seen message. */
  @IsOptional()
  @IsISO8601()
  before?: string;

  /** BigInt message id (decimal string) — the newest message in the cursor. */
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'beforeId must be a decimal string (bigint)' })
  beforeId?: string;

  @IsOptional()
  @Transform(({ value }) => {
    const n = typeof value === 'string' ? Number.parseInt(value, 10) : value;
    return Number.isFinite(n) ? n : value;
  })
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
