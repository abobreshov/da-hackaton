import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { PASSWORD_MAX, PASSWORD_MIN } from '@app/contracts';

export class PasswordChangeDto {
  // currentPassword only needs length caps — we still accept a weak
  // legacy password as "proof of identity" before upgrading to the new one.
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX)
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  @Matches(/[a-z]/, { message: 'password must contain a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'password must contain an uppercase letter' })
  @Matches(/\d/, { message: 'password must contain a digit' })
  newPassword!: string;
}
