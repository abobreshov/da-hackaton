import { IsIn, IsInt, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateReportDto {
  @IsIn(['message', 'user'])
  targetType!: 'message' | 'user';

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  targetId!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
