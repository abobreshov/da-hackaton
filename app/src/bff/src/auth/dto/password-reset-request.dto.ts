import { IsEmail, MaxLength } from 'class-validator';
import { EMAIL_MAX } from '@app/contracts';

export class PasswordResetRequestDto {
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email!: string;
}
