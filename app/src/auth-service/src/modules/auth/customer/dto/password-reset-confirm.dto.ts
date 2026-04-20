import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX, PASSWORD_MIN } from '@app/contracts';

export class PasswordResetConfirmDto {
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  token!: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  @Matches(/[a-z]/, { message: 'password must contain a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'password must contain an uppercase letter' })
  @Matches(/\d/, { message: 'password must contain a digit' })
  newPassword!: string;
}
