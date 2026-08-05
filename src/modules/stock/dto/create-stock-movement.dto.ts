import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumberString,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { StockItemDto } from './stock-item.dto';

export class CreateStockMovementDto {
  @IsIn(['entrada', 'salida'])
  direccion!: 'entrada' | 'salida';

  @IsNumberString()
  sucursalId!: string;

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
