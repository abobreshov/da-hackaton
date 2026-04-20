import { IsEmail, MaxLength } from 'class-validator';

export class PasswordResetRequestDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
