import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^[^\s].*[^\s]$|^[^\s]$/, { message: 'name may not start or end with whitespace' })
  name!: string;

  @IsIn(['public', 'private'])
  visibility!: 'public' | 'private';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
