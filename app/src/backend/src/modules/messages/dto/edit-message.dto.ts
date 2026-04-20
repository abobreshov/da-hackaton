import { IsString, MaxLength, MinLength } from 'class-validator';

export class EditMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(3 * 1024)
  body!: string;
}
