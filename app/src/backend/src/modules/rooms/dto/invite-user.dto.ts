import { IsInt, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class InviteUserDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  invitedUserId!: number;
}
