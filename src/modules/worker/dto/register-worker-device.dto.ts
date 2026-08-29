import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterWorkerDeviceDto {
  @IsString()
  @MaxLength(120)
  deviceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  userAgent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  platform?: string;

  @IsNumber()
  latitud!: number;

  @IsNumber()
  longitud!: number;

  @IsOptional()
  @IsNumber()
  precisionMetros?: number;
}
