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
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { getCommercialScope } from '../../common/commercial-access';
import { CreateProductDto } from './dto/create-product.dto';
import { FindProductsQueryDto } from './dto/find-products-query.dto';
import { ProductsService } from './products.service';

@UseGuards(ModuleAccessGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequireModule(
    'productos',
    'gre-remitente',
    'stock-movimientos',
    'stock-traspasos',
    'stock-kardex',
  )
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindProductsQueryDto,
  ) {
    return this.productsService.findAll(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Get(':publicId')
  @RequireModule(
    'productos',
    'gre-remitente',
    'stock-movimientos',
    'stock-traspasos',
    'stock-kardex',
  )
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.productsService.findOne(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
    );
  }

  @Post()
  @RequireModule('productos')
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
    return this.productsService.create(
      this.getEmpresaId(user),
      getCommercialScope(user),
      dto,
      files,
    );
  }

  @Patch(':publicId')
  @RequireModule('productos')
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
    return this.productsService.update(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
      dto,
      files,
    );
  }

  @Delete(':publicId')
  @RequireModule('productos')
  remove(@CurrentUser() user: JwtPayload, @Param('publicId') publicId: string) {
    return this.productsService.remove(this.getEmpresaId(user), publicId);
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }
}
