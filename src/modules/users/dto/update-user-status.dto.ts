import { IsIn } from 'class-validator';

export class UpdateUserStatusDto {
  @IsIn(['activo', 'inactivo'])
  estado: 'activo' | 'inactivo';
}
