import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AnnulSaleDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  razon: string;

  @IsOptional()
  @IsBoolean()
  documentDelivered?: boolean;
}
