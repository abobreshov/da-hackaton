import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DismissReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
