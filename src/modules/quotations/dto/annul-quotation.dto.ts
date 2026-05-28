import { IsNotEmpty, IsString } from 'class-validator';

export class AnnulQuotationDto {
  @IsNotEmpty()
  @IsString()
  razon: string;
}
