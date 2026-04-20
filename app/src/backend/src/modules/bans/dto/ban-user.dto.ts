import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Used by the TCP path where the banner id comes from the authenticated
 * session inside the RPC payload. HTTP binds `userId` via `:userId` route
 * param directly.
 */
export class BanUserDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bannerId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  bannedId!: number;
}
