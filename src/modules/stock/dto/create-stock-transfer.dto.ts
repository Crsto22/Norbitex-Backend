import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumberString,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { StockItemDto } from './stock-item.dto';

export class CreateStockTransferDto {
  @IsNumberString()
  origenSucursalId!: string;

  @IsNumberString()
  destinoSucursalId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  motivo!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockItemDto)
  items!: StockItemDto[];
}
