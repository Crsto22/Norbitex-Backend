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
import { AssignShiftEmployeesDto } from './dto/assign-shift-employees.dto';
import { CreateShiftDto } from './dto/create-shift.dto';
import { FindShiftsQueryDto } from './dto/find-shifts-query.dto';
import { UpdateShiftStatusDto } from './dto/update-shift-status.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { ShiftsService } from './shifts.service';

@UseGuards(ModuleAccessGuard)
@RequireModule('asistencias-turnos')
@Controller('attendance/shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query() query: FindShiftsQueryDto) {
    return this.shiftsService.findAll(this.getEmpresaId(user), query);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateShiftDto) {
    return this.shiftsService.create(this.getEmpresaId(user), dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.shiftsService.findOne(this.getEmpresaId(user), BigInt(id));
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateShiftDto,
  ) {
    return this.shiftsService.update(this.getEmpresaId(user), BigInt(id), dto);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateShiftStatusDto,
  ) {
    return this.shiftsService.updateStatus(
      this.getEmpresaId(user),
      BigInt(id),
      dto,
    );
  }

  @Patch(':id/employees')
  assignEmployees(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AssignShiftEmployeesDto,
  ) {
    return this.shiftsService.assignEmployees(
      this.getEmpresaId(user),
      BigInt(id),
      dto,
    );
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.shiftsService.remove(this.getEmpresaId(user), BigInt(id));
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }
}
