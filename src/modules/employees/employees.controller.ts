import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { FindEmployeesQueryDto } from './dto/find-employees-query.dto';
import { UpdateEmployeeStatusDto } from './dto/update-employee-status.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';

@UseGuards(ModuleAccessGuard)
@RequireModule('asistencias-personal')
@Controller('attendance/employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindEmployeesQueryDto,
  ) {
    return this.employeesService.findAll(this.getEmpresaId(user), query);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(this.getEmpresaId(user), dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.employeesService.findOne(this.getEmpresaId(user), BigInt(id));
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.update(
      this.getEmpresaId(user),
      BigInt(id),
      dto,
    );
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeStatusDto,
  ) {
    return this.employeesService.updateStatus(
      this.getEmpresaId(user),
      BigInt(id),
      dto,
    );
  }

  @Post(':id/access-token')
  generateAccessToken(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.employeesService.generateAccessToken(
      this.getEmpresaId(user),
      BigInt(id),
    );
  }

  @Patch(':id/device/reset')
  resetDevice(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.employeesService.resetDevice(
      this.getEmpresaId(user),
      BigInt(id),
    );
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.employeesService.remove(this.getEmpresaId(user), BigInt(id));
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }
}
