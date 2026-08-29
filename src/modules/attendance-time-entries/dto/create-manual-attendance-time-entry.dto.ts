import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

export class CreateManualAttendanceTimeEntryDto {
  @IsString()
  empleadoId!: string;

  @IsIn(['entrada', 'salida'])
  tipo!: 'entrada' | 'salida';

  @IsISO8601()
  fechaHora!: string;

  @IsOptional()
  @IsString()
  sucursalId?: string;
}
