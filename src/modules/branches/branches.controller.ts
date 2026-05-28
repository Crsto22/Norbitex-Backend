import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { FindBranchesQueryDto } from './dto/find-branches-query.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@UseGuards(JwtAuthGuard)
@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query() query: FindBranchesQueryDto) {
    return this.branchesService.findAll(this.getEmpresaId(user), query);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateBranchDto) {
    return this.branchesService.create(this.getEmpresaId(user), dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchesService.update(this.getEmpresaId(user), BigInt(id), dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.branchesService.remove(this.getEmpresaId(user), BigInt(id));
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }
}
