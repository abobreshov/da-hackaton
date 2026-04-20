import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class FriendRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  text?: string;
}
