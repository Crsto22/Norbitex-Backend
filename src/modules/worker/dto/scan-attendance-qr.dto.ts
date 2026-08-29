import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class ScanAttendanceQrDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  qrContent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  codigo?: string;

  @IsString()
  @MaxLength(120)
  deviceId!: string;

  @IsNumber()
  latitud!: number;

  @IsNumber()
  longitud!: number;

  @IsOptional()
  @IsNumber()
  precisionMetros?: number;
}
