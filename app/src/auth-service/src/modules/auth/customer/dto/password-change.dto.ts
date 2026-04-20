import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX } from '@app/contracts';

export class PasswordChangeDto {
  // currentPassword is the legacy credential the user is about to retire;
  // cap length but don't enforce the strong-password rule on it.
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(PASSWORD_MAX)
  @Matches(/[a-z]/, { message: 'password must contain a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'password must contain an uppercase letter' })
  @Matches(/\d/, { message: 'password must contain a digit' })
  newPassword!: string;
}
