import { IsNotEmpty, IsString } from 'class-validator';

export class AnnulSaleDto {
  @IsNotEmpty()
  @IsString()
  razon: string;
}
