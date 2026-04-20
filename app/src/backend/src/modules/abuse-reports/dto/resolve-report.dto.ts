import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
