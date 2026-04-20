import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class CustomerLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  totpCode?: string;
}
