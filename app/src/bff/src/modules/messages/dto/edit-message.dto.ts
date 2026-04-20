import { IsString, MaxLength, MinLength } from 'class-validator';

export class EditMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  body!: string;
}
