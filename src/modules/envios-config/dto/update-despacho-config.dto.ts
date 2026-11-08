import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class UpdateDespachoConfigDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  diasSemana!: number[];

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'La hora de corte debe tener el formato HH:mm',
  })
  horaCorte!: string;
}
