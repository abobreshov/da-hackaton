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
}
