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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateProductDto } from './dto/create-product.dto';
import { FindProductsQueryDto } from './dto/find-products-query.dto';
import { ProductsService } from './products.service';

@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindProductsQueryDto,
  ) {
    return this.productsService.findAll(this.getEmpresaId(user), query);
  }

  @Get(':publicId')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.productsService.findOne(this.getEmpresaId(user), publicId);
  }

  @Post()
  @UseInterceptors(
    FilesInterceptor('images', 40, {
      storage: memoryStorage(),
      limits: {
        files: 40,
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProductDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.productsService.create(this.getEmpresaId(user), dto, files);
  }

  @Patch(':publicId')
  @UseInterceptors(
    FilesInterceptor('images', 40, {
      storage: memoryStorage(),
      limits: {
        files: 40,
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  update(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: CreateProductDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.productsService.update(this.getEmpresaId(user), publicId, dto, files);
  }

  @Delete(':publicId')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.productsService.remove(this.getEmpresaId(user), publicId);
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }
}
