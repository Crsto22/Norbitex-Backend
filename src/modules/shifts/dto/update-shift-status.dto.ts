import { IsIn } from 'class-validator';

export class UpdateShiftStatusDto {
  @IsIn(['activo', 'inactivo'])
  estado!: 'activo' | 'inactivo';
}
