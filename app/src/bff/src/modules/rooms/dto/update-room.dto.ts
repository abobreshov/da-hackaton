import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Partial room update. All fields optional — the backend applies whichever
 * subset the caller sent. Empty body is allowed and treated as a no-op.
 */
export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^[^\s].*[^\s]$|^[^\s]$/, { message: 'name may not start or end with whitespace' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';
}
