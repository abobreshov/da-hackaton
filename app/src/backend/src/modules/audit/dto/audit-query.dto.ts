import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class AuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  actor?: number;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @Type(() => Date)
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  to?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /**
   * Keyset cursor — client echoes back `beforeCreatedAt` + `beforeId` from
   * the last row of the previous page. Both must be provided together.
   */
  @IsOptional()
  @Type(() => Date)
  beforeCreatedAt?: Date;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return BigInt(value);
    return value;
  })
  beforeId?: bigint;
}
