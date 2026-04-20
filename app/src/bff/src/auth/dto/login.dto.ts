import { IsEmail, IsString, MinLength, MaxLength, Matches, IsOptional } from 'class-validator';
import { EMAIL_MAX, PASSWORD_MAX, PASSWORD_MIN, TOTP_REGEX } from '@app/contracts';

export class LoginDto {
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email!: string;

  // Login is intentionally lenient on complexity — a user who predates the
  // current password policy must still be able to sign in. We only gate
  // length, not character classes, here. Complexity lives on register /
  // password-change / reset-confirm.
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password!: string;

  @IsOptional()
  @IsString()
  @Matches(TOTP_REGEX, { message: 'totpCode must be six digits' })
  totpCode?: string;

  @IsOptional()
  @IsString()
  type?: 'admin' | 'user';
}
