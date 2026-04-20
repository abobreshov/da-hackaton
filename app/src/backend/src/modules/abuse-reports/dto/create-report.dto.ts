import { IsIn, IsInt, IsString, MaxLength, MinLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateReportDto {
  @IsIn(['message', 'user'])
  targetType!: 'message' | 'user';

  /**
   * Accepts a number or numeric string and normalises to bigint for the
   * service. `target_id` is BIGINT in the database because it must
   * accommodate both `users(id)` (int) and `messages(id)` (bigint).
   */
  @Transform(({ value }) => {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return BigInt(value);
    if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return BigInt(value);
    return value;
  })
  targetId!: bigint;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
