import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DismissReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
