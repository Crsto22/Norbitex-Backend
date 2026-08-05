import { IsInt, IsNumberString, Min } from 'class-validator';

export class StockItemDto {
  @IsNumberString()
  productoVarianteId!: string;

  @IsInt()
  @Min(1)
  cantidad!: number;
}
