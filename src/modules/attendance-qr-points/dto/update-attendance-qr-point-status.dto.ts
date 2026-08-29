import { IsIn } from 'class-validator';

export class UpdateAttendanceQrPointStatusDto {
  @IsIn(['activo', 'inactivo'])
  estado!: 'activo' | 'inactivo';
}
