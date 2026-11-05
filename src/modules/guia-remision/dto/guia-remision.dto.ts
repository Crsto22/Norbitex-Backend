import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  GuiaRemisionEstado,
  GuiaRemisionParticipanteTipo,
  SunatEstado,
} from '@prisma/client';

export class GuiaRemisionDetalleDto {
  @IsOptional()
  @IsString()
  productoVarianteId?: string;

  @IsString()
  descripcion: string;

  @IsString()
  cantidad: string;

  @IsOptional()
  @IsString()
  unidadMedida?: string;

  @IsOptional()
  @IsString()
  codigoProducto?: string;

  @IsOptional()
  @IsString()
  pesoUnitario?: string;
}

export class GuiaRemisionDocumentoRelacionadoDto {
  @IsString()
  @Matches(/^(01|03|04|09|12|48|49|50|52|7[1-8]|80|81|91|92)$/)
  tipoDocumento: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  serie?: string;

  @IsString()
  @MaxLength(100)
  numero: string;
}

export class GuiaRemisionParticipanteDto {
  @IsEnum(GuiaRemisionParticipanteTipo)
  tipo: GuiaRemisionParticipanteTipo;

  @IsString()
  tipoDocumento: string;

  @IsString()
  numeroDocumento: string;

  @IsOptional()
  @IsString()
  nombres?: string;

  @IsOptional()
  @IsString()
  apellidos?: string;

  @IsOptional()
  @IsString()
  razonSocial?: string;

  @IsOptional()
  @IsString()
  licencia?: string;

  @IsOptional()
  @IsString()
  registroMtc?: string;

  @IsOptional()
  @IsBoolean()
  esPrincipal?: boolean;
}

export class GuiaRemisionVehiculoDto {
  @IsString()
  placa: string;

  @IsOptional()
  @IsBoolean()
  esPrincipal?: boolean;
}

export class CreateGuiaRemisionDto {
  @IsOptional()
  @IsString()
  sucursalId?: string;

  @IsOptional()
  @IsString()
  serie?: string;

  @IsString()
  fechaInicioTraslado: string;

  @IsOptional()
  @IsString()
  fechaEntregaTransportista?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(01|02|03|04|05|06|07|08|09|13|14|17|18|19)$/)
  motivoTraslado?: string;

  @IsOptional()
  @IsString()
  descripcionMotivo?: string;

  @IsString()
  @Matches(/^(01|02)$/)
  modalidadTransporte: string;

  @IsString()
  pesoBrutoTotal: string;

  @IsOptional()
  @IsString()
  unidadPeso?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  numeroBultos?: number;

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsOptional()
  @IsString()
  sucursalPartidaId?: string;

  @IsOptional()
  @IsString()
  ubigeoPartida?: string;

  @IsOptional()
  @IsString()
  direccionPartida?: string;

  @IsOptional()
  @IsString()
  sucursalLlegadaId?: string;

  @IsOptional()
  @IsString()
  ubigeoLlegada?: string;

  @IsOptional()
  @IsString()
  direccionLlegada?: string;

  @IsString()
  destinatarioTipoDoc: string;

  @IsString()
  destinatarioNroDoc: string;

  @IsString()
  destinatarioRazonSocial: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuiaRemisionDetalleDto)
  detalles: GuiaRemisionDetalleDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuiaRemisionDocumentoRelacionadoDto)
  documentosRelacionados?: GuiaRemisionDocumentoRelacionadoDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuiaRemisionParticipanteDto)
  participantes?: GuiaRemisionParticipanteDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  catalogoParticipanteIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuiaRemisionVehiculoDto)
  vehiculos?: GuiaRemisionVehiculoDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  catalogoVehiculoIds?: string[];

  @IsOptional()
  @IsBoolean()
  emitirDirectamente?: boolean;
}

export class UpdateGuiaRemisionDto extends CreateGuiaRemisionDto {}

export class FindGuiasRemisionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  sucursalId?: string;

  @IsOptional()
  @IsEnum(GuiaRemisionEstado)
  estado?: GuiaRemisionEstado;

  @IsOptional()
  @IsEnum(SunatEstado)
  sunatEstado?: SunatEstado;
}

export class AutocompletarGuiaVentaQueryDto {
  @IsOptional()
  @IsString()
  tipoDocumento?: string;

  @IsString()
  serie: string;

  @IsString()
  numero: string;
}

export class AnnulGuiaRemisionDto {
  @IsString()
  razon: string;
}

export class ConfirmVoidGuiaRemisionDto {
  @IsString()
  @Matches(/^.{3,120}$/)
  referenciaSol: string;
}
