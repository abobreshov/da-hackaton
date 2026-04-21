import { IsEmail, IsString, MinLength, MaxLength, Matches, IsOptional } from 'class-validator';
import { EMAIL_MAX, PASSWORD_MAX, PASSWORD_MIN, TOTP_REGEX } from '@app/contracts';

export class CustomerLoginDto {
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email!: string;

  // Login is intentionally lenient on complexity so pre-policy users can
  // still sign in. Length caps only.
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password!: string;

  @IsOptional()
  @IsString()
  @Matches(TOTP_REGEX, { message: 'totpCode must be six digits' })
  totpCode?: string;

  /**
   * Optional request metadata forwarded by the BFF for the active-sessions
   * tracker (EPIC-02 §2.2.4). Persisted on the `user_sessions` row written
   * after successful tokens are minted. Absent today; bumping these in from
   * the BFF is the next slice — no contract change required when that lands.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  userAgent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;
}
