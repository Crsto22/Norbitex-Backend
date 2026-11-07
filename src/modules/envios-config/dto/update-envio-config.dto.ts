import { IsBoolean } from 'class-validator';

export class UpdateEnvioConfigDto {
  @IsBoolean()
  activo!: boolean;
}
