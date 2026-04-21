import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Create a chat message.
 *
 * XOR invariant: exactly one of `roomId` or `dmUserId` must be provided. The
 * validation decorators below enforce this by marking each field required
 * iff the other is absent.
 *
 * `body` capped at 3 KB (3000 chars) — matches the backend contract. The
 * backend performs the final authoritative length check.
 */
export class CreateMessageDto {
  /** Target room. Required when `dmUserId` is absent. */
  @ValidateIf((o) => o.dmUserId === undefined || o.dmUserId === null)
  @IsInt()
  @IsPositive()
  roomId?: number;

  /** Target peer in a DM thread. Required when `roomId` is absent. */
  @ValidateIf((o) => o.roomId === undefined || o.roomId === null)
  @IsInt()
  @IsPositive()
  dmUserId?: number;

  // Empty body is legal iff `attachmentIds` carries at least one entry.
  // Cross-field validation is enforced server-side in MessagesService; the
  // DTO only enforces the size cap.
  @IsString()
  @MaxLength(3000)
  body!: string;

  /**
   * Optional parent message id. Kept as a string since message ids are
   * bigints on the backend and we never treat them as numbers in JS.
   */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  replyToId?: string;

  /**
   * Orphan attachment ids to bind on the new message (EPIC-08). Backend
   * filters to uploader + scope; mismatches silently ignored. Max 10
   * matches multipart limit.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  attachmentIds?: string[];
}
