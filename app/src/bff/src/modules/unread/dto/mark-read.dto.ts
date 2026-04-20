import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * Payload for POST /rooms/:id/read and /dms/:userId/read. `lastReadId` is
 * a message id (bigint on the backend, decimal string on the wire).
 */
export class MarkReadDto {
  @IsString()
  @MaxLength(32)
  @Matches(/^\d+$/, { message: 'lastReadId must be a decimal integer string' })
  lastReadId!: string;
}
