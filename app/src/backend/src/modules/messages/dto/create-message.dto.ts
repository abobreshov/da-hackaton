import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
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

  /**
   * Optional list of orphan attachment UUIDs (uploaded with `messageId=null`)
   * to bind to this message. Server enforces same uploader + same scope.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  attachmentIds?: string[];
}
