import { IsString, MinLength, MaxLength } from 'class-validator';

export class PasswordResetConfirmDto {
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
