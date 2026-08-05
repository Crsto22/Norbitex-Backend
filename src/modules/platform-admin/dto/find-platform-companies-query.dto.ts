import { Type } from 'class-transformer';
import { EmpresaEstado, PlanCodigo } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class FindPlatformCompaniesQueryDto {
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
  limit?: number = 12;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(PlanCodigo)
  plan?: PlanCodigo;

  @IsOptional()
  @IsEnum(EmpresaEstado)
  state?: EmpresaEstado;

  @IsOptional()
  @IsIn(['trial', 'active', 'expired'])
  planStatus?: 'trial' | 'active' | 'expired';
}
