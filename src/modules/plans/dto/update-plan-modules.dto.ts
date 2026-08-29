import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsString,
} from 'class-validator';

export class UpdatePlanModulesDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  moduleKeys!: string[];

  @IsDateString()
  expectedUpdatedAt!: string;
}
