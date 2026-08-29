import { ArrayMaxSize, ArrayUnique, IsArray, IsString } from 'class-validator';

export class UpdateCompanyModulesDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  moduleKeys!: string[];
}
