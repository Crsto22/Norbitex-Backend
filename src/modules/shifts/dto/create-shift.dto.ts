import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  Max,
} from 'class-validator';

export class CreateShiftDto {
  @IsString()
  @MaxLength(120)
  nombre!: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  horaEntrada!: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  horaSalida!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  diasLaborables!: number[];

  @IsOptional()
  @IsIn(['activo', 'inactivo'])
  estado?: 'activo' | 'inactivo';
}
