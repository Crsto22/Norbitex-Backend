import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

export class AssignShiftEmployeesDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  employeeIds!: string[];
}
