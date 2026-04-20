import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Owner-only partial update — EPIC-05 AC-05-13. Every field is optional;
 * the service treats an empty body as a no-op and returns the current row.
 */
export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^[^\s].*[^\s]$|^[^\s]$/, {
    message: 'name may not start or end with whitespace',
  })
  name?: string;

  // `description` accepts explicit null to clear it; treat any non-undefined
  // value as "set this". class-validator doesn't support `null | string`
  // directly so we validate only when present AND not null.
  @ValidateIf((o) => o.description !== undefined && o.description !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';
}
