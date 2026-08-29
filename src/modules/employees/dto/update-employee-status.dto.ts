import { IsIn } from 'class-validator';

export class UpdateEmployeeStatusDto {
  @IsIn(['activo', 'inactivo'])
  estado!: 'activo' | 'inactivo';
}
