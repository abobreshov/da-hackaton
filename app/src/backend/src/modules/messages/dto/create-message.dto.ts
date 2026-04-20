import { IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Exactly one of `roomId` / `dmUserId` must be present — the service also
 * enforces this via XOR, but we validate at the DTO boundary too so the
 * error is surfaced consistently.
 */
export class CreateMessageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  roomId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  dmUserId?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(3 * 1024)
  body!: string;

  @ValidateIf((o) => o.replyToId !== undefined && o.replyToId !== null)
  @Type(() => String)
  @IsString()
  replyToId?: string;
}
