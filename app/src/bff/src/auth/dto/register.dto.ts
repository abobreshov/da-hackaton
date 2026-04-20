import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import {
  EMAIL_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_REGEX,
} from '@app/contracts';

export class RegisterDto {
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email!: string;

  @IsString()
  @MinLength(USERNAME_MIN)
  @MaxLength(USERNAME_MAX)
  @Matches(USERNAME_REGEX, {
    message: 'username must contain only letters, digits, underscore, dot or hyphen',
  })
  username!: string;

  // Strong-password rules — must match the zod `passwordSchema` in
  // @app/contracts so client-side and server-side never drift.
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  @Matches(/[a-z]/, { message: 'password must contain a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'password must contain an uppercase letter' })
  @Matches(/\d/, { message: 'password must contain a digit' })
  password!: string;
}
