import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ProductoTipo,
  StockMovimientoTipo,
  SucursalEstado,
} from '@prisma/client';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  resolveScopedBranchId,
  type CommercialScope,
} from '../../common/commercial-access';
import { PlansService } from '../plans/plans.service';
import { StockService } from '../stock/stock.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { CreateProductDto } from './dto/create-product.dto';
import { FindProductsQueryDto } from './dto/find-products-query.dto';

type ProductColorInput = {
  colorId: string;
  activo?: boolean;
};

type ProductVariantStockInput = {
  sucursalId: string;
  stockActual?: number | string;
  stockMinimo?: number | string;
};

type ProductVariantInput = {
  colorId: string;
  tallaId: string;
  sku?: string;
  codigoBarras?: string;
  precioCompra?: number | string | null;
  precioVenta: number | string;
  precioMayorista?: number | string | null;
  activo?: boolean;
  stocks?: ProductVariantStockInput[];
};

type SimpleProductInput = Omit<ProductVariantInput, 'colorId' | 'tallaId'>;

type ProductImageInput = {
  colorId?: string;
  orden?: number;
  esPrincipal?: boolean;
  serverId?: string;
};

const productInclude = {
  marca: true,
  categoria: true,
  unidadMedida: true,
  tipoAfectacionIgv: true,
  colores: {
    where: { activo: true },
    include: {
      color: true,
      imagenes: {
        orderBy: [{ esPrincipal: 'desc' }, { orden: 'asc' }, { id: 'asc' }],
      },
    },
    orderBy: { id: 'asc' },
  },
  variantes: {
    where: { deletedAt: null },
    include: {
      talla: true,
      productoColor: {
        include: {
          color: true,
        },
      },
      inventarios: {
        include: {
          sucursal: true,
        },
        orderBy: { id: 'asc' },
      },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.ProductoInclude;

type ProductWithRelations = Prisma.ProductoGetPayload<{
  include: typeof productInclude;
}>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly r2StorageService: R2StorageService,
    private readonly plansService: PlansService,
    private readonly stockService: StockService,
  ) {}

  async findAll(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindProductsQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const categoriaId = this.parseOptionalId(query.categoriaId, 'categoriaId');
    const marcaId = this.parseOptionalId(query.marcaId, 'marcaId');
    const colorId = this.parseOptionalId(query.colorId, 'colorId');
    const tallaId = this.parseOptionalId(query.tallaId, 'tallaId');
    const sucursalId = resolveScopedBranchId(scope, query.sucursalId);
    const variantWhere = this.buildProductVariantWhere({
      empresaId,
      colorId,
      tallaId,
      sucursalId,
    });
    const where: Prisma.ProductoWhereInput = {
      empresaId,
      deletedAt: null,
      ...(query.status ? { activo: query.status === 'active' } : {}),
      ...(categoriaId ? { categoriaId } : {}),
      ...(marcaId ? { marcaId } : {}),
      ...(variantWhere
        ? {
            variantes: {
              some: variantWhere,
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { nombre: { contains: search, mode: 'insensitive' } },
              { nombreKey: { contains: this.buildNameKey(search) } },
              { descripcion: { contains: search, mode: 'insensitive' } },
              { marca: { nombre: { contains: search, mode: 'insensitive' } } },
              {
                categoria: {
                  nombre: { contains: search, mode: 'insensitive' },
                },
              },
              {
                variantes: {
                  some: {
                    sku: { contains: search, mode: 'insensitive' },
                  },
                },
              },
              {
                variantes: {
                  some: {
                    codigoBarras: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [products, total, activeTotal, inactiveTotal] =
      await this.prisma.$transaction([
        this.prisma.producto.findMany({
          where,
          include: productInclude,
          orderBy: [{ activo: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.producto.count({ where }),
        this.prisma.producto.count({
          where: {
            empresaId,
            deletedAt: null,
            activo: true,
          },
        }),
        this.prisma.producto.count({
          where: {
            empresaId,
            deletedAt: null,
            activo: false,
          },
        }),
      ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: products.map((product) => this.toResponse(product, { sucursalId })),
      meta: {
        page,
        limit,
        total,
        totalPages,
        activeTotal,
        inactiveTotal,
      },
    };
  }

  async create(
    empresaId: bigint,
    scope: CommercialScope,
    dto: CreateProductDto,
    files: Express.Multer.File[] = [],
  ) {
    const nombre = this.cleanText(dto.nombre);
    const nombreKey = this.buildNameKey(nombre);
    const tipo =
      dto.tipo === 'normal' ? ProductoTipo.normal : ProductoTipo.variantes;
    const { colores, variantes, imagenes } = await this.resolveProductInputs(
      empresaId,
      tipo,
      dto,
    );

    if (colores.length === 0) {
      throw new BadRequestException('Agrega al menos un color al producto');
    }

    if (variantes.length === 0) {
      throw new BadRequestException('Agrega al menos una variante al producto');
    }

    if (files.length !== imagenes.length) {
      throw new BadRequestException(
        'La cantidad de imagenes no coincide con la metadata enviada',
      );
    }

    const marcaId = this.parseOptionalId(dto.marcaId, 'marcaId');
    const categoriaId = this.parseOptionalId(dto.categoriaId, 'categoriaId');
    const colorIds = this.uniqueBigIntIds(
      colores.map((color) => color.colorId),
    );
    const tallaIds = this.uniqueBigIntIds(
      variantes.map((variant) => variant.tallaId),
    );
    const stockSucursalIds = this.uniqueBigIntIds(
      variantes.flatMap((variant) =>
        (variant.stocks ?? []).map((stock) => stock.sucursalId),
      ),
    );
    this.assertStockScope(scope, stockSucursalIds);

    this.validateVariantsBelongToColors(variantes, colorIds);
    this.validateUniqueVariants(variantes);
    this.validateStockInputs(variantes);

    await this.ensureCatalogReferences({
      empresaId,
      marcaId,
      categoriaId,
      colorIds,
      tallaIds,
      stockSucursalIds,
    });

    let productId: bigint | null = null;

    try {
      const product = await this.prisma.$transaction(
        async (tx) => {
          await this.plansService.assertResourceLimits(tx, empresaId, {
            products: 1,
            variants: tipo === ProductoTipo.variantes ? variantes.length : 0,
            storageBytes: files.reduce((total, file) => total + file.size, 0),
          });
          const unidadMedida = await this.upsertUnidadMedida(
            tx,
            dto.unidadMedidaCodigo ?? 'NIU',
          );
          const tipoAfectacionIgv = await this.upsertTipoAfectacionIgv(
            tx,
            dto.tipoAfectacionIgvCodigo ?? '10',
          );
          const createdProduct = await tx.producto.create({
            data: {
              empresaId,
              marcaId,
              categoriaId,
              unidadMedidaId: unidadMedida.id,
              tipoAfectacionIgvId: tipoAfectacionIgv.id,
              nombre,
              nombreKey,
              tipo,
              descripcion: this.cleanOptionalText(dto.descripcion),
              activo: this.parseBoolean(dto.activo, true),
            },
          });
          const productColors = await Promise.all(
            colores.map((color) =>
              tx.productoColor.create({
                data: {
                  empresaId,
                  productoId: createdProduct.id,
                  colorId: this.parseId(color.colorId, 'colorId'),
                  activo: color.activo ?? true,
                },
              }),
            ),
          );
          const productColorByColorId = new Map(
            productColors.map((productColor) => [
              productColor.colorId.toString(),
              productColor,
            ]),
          );
          const colorNameById = await this.getColorNameById(
            tx,
            empresaId,
            colorIds,
          );
          const sizeNameById = await this.getSizeNameById(
            tx,
            empresaId,
            tallaIds,
          );
          const reservedSkus = new Set<string>();
          const reservedBarcodes = new Set<string>();

          for (const variant of variantes) {
            const productColor = productColorByColorId.get(variant.colorId);

            if (!productColor) {
              throw new BadRequestException(
                'Todas las variantes deben pertenecer a un color del producto',
              );
            }

            const createdVariant = await tx.productoVariante.create({
              data: {
                empresaId,
                productoId: createdProduct.id,
                productoColorId: productColor.id,
                tallaId: this.parseId(variant.tallaId, 'tallaId'),
                sku: await this.resolveVariantSku({
                  tx,
                  empresaId,
                  productName: nombre,
                  colorName: colorNameById.get(variant.colorId) ?? 'GEN',
                  sizeName: sizeNameById.get(variant.tallaId) ?? 'UNI',
                  inputSku: variant.sku,
                  reservedSkus,
                }),
                codigoBarras: await this.resolveVariantBarcode({
                  tx,
                  empresaId,
                  inputBarcode: variant.codigoBarras,
                  reservedBarcodes,
                }),
                precioCompra: this.toOptionalDecimal(variant.precioCompra),
                precioVenta: this.toRequiredDecimal(
                  variant.precioVenta,
                  'precioVenta',
                ),
                precioMayorista: this.toOptionalDecimal(
                  variant.precioMayorista,
                ),
                activo: variant.activo ?? true,
              },
            });

            for (const stock of variant.stocks ?? []) {
              await this.stockService.setStock(tx, {
                empresaId,
                sucursalId: this.parseId(stock.sucursalId, 'sucursalId'),
                productoVarianteId: createdVariant.id,
                stockActual: this.toPositiveInt(
                  stock.stockActual ?? 0,
                  'stockActual',
                ),
                stockMinimo: this.toPositiveInt(
                  stock.stockMinimo ?? 0,
                  'stockMinimo',
                ),
                tipo: StockMovimientoTipo.stock_inicial,
                motivo: 'Stock inicial del producto',
                creadoPorId: scope.userId,
              });
            }
          }

          if (files.length > 0) {
            await this.createProductImages({
              tx,
              empresaId,
              productoId: createdProduct.id,
              productColors,
              imagenes,
              files,
            });
          }

          return {
            product: createdProduct,
            productColors,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 120_000,
        },
      );

      productId = product.product.id;

      return this.findOne(empresaId, scope, product.product.publicId);
    } catch (error) {
      if (productId) {
        await this.prisma.producto
          .delete({ where: { id: productId } })
          .catch(() => {});
      }

      this.handlePrismaError(error);
    }
  }

  async findOne(empresaId: bigint, scope: CommercialScope, publicId: string) {
    const product = await this.prisma.producto.findFirst({
      where: {
        publicId,
        empresaId,
        deletedAt: null,
      },
      include: productInclude,
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    return this.toResponse(product, { sucursalId: scope.branchId });
  }

  async update(
    empresaId: bigint,
    scope: CommercialScope,
    publicId: string,
    dto: CreateProductDto,
    files: Express.Multer.File[] = [],
  ) {
    const existing = await this.prisma.producto.findFirst({
      where: { publicId, empresaId, deletedAt: null },
      include: productInclude,
    });

    if (!existing) {
      throw new NotFoundException('Producto no encontrado');
    }

    const id = existing.id;

    const tipo = dto.tipo
      ? dto.tipo === 'normal'
        ? ProductoTipo.normal
        : ProductoTipo.variantes
      : existing.tipo;
    if (tipo !== existing.tipo) {
      throw new BadRequestException('El tipo de producto no se puede cambiar');
    }

    const nombre = this.cleanText(dto.nombre);
    const nombreKey = this.buildNameKey(nombre);
    const { colores, variantes, imagenes } = await this.resolveProductInputs(
      empresaId,
      tipo,
      dto,
    );

    if (colores.length === 0) {
      throw new BadRequestException('Agrega al menos un color al producto');
    }

    if (variantes.length === 0) {
      throw new BadRequestException('Agrega al menos una variante al producto');
    }

    const newImageCount = imagenes.filter((img) => !img.serverId).length;
    if (files.length !== newImageCount) {
      throw new BadRequestException(
        'La cantidad de imagenes no coincide con la metadata enviada',
      );
    }
    const inputImageIds = new Set(
      imagenes
        .filter((image) => image.serverId)
        .map((image) => image.serverId!),
    );
    const removedImageBytes = existing.colores
      .flatMap((color) => color.imagenes)
      .filter((image) => !inputImageIds.has(image.id.toString()))
      .reduce((total, image) => total + image.sizeBytes, 0);
    const storageIncrement =
      files.reduce((total, file) => total + file.size, 0) - removedImageBytes;
    const variantIncrement =
      tipo === ProductoTipo.variantes
        ? Math.max(0, variantes.length - existing.variantes.length)
        : 0;

    const marcaId = this.parseOptionalId(dto.marcaId, 'marcaId');
    const categoriaId = this.parseOptionalId(dto.categoriaId, 'categoriaId');
    const colorIds = this.uniqueBigIntIds(
      colores.map((color) => color.colorId),
    );
    const tallaIds = this.uniqueBigIntIds(
      variantes.map((variant) => variant.tallaId),
    );
    const stockSucursalIds = this.uniqueBigIntIds(
      variantes.flatMap((variant) =>
        (variant.stocks ?? []).map((stock) => stock.sucursalId),
      ),
    );
    this.assertStockScope(scope, stockSucursalIds);

    this.validateVariantsBelongToColors(variantes, colorIds);
    this.validateUniqueVariants(variantes);
    this.validateStockInputs(variantes);

    await this.ensureCatalogReferences({
      empresaId,
      marcaId,
      categoriaId,
      colorIds,
      tallaIds,
      stockSucursalIds,
    });

    await this.prisma.$transaction(
      async (tx) => {
        await this.plansService.assertResourceLimits(tx, empresaId, {
          variants: variantIncrement,
          storageBytes: storageIncrement,
        });
        const unidadMedida = await this.upsertUnidadMedida(
          tx,
          dto.unidadMedidaCodigo ?? 'NIU',
        );
        const tipoAfectacionIgv = await this.upsertTipoAfectacionIgv(
          tx,
          dto.tipoAfectacionIgvCodigo ?? '10',
        );

        await tx.producto.update({
          where: { id },
          data: {
            nombre,
            nombreKey,
            descripcion: this.cleanOptionalText(dto.descripcion),
            marcaId,
            categoriaId,
            unidadMedidaId: unidadMedida.id,
            tipoAfectacionIgvId: tipoAfectacionIgv.id,
            activo: this.parseBoolean(dto.activo, true),
          },
        });

        const existingColors = await tx.productoColor.findMany({
          where: { productoId: id },
          select: { id: true, colorId: true },
        });
        const existingColorIdSet = new Set(
          existingColors.map((c) => c.colorId.toString()),
        );
        const inputColorMap = new Map(
          colores.map((c) => [c.colorId, c.activo ?? true]),
        );

        for (const existingColor of existingColors) {
          const isActive = inputColorMap.get(existingColor.colorId.toString());
          if (isActive === undefined) {
            await tx.productoColor.delete({ where: { id: existingColor.id } });
          } else {
            await tx.productoColor.update({
              where: { id: existingColor.id },
              data: { activo: isActive },
            });
          }
        }

        const colorsToAdd = colores.filter(
          (c) => !existingColorIdSet.has(c.colorId),
        );
        if (colorsToAdd.length > 0) {
          await Promise.all(
            colorsToAdd.map((color) =>
              tx.productoColor.create({
                data: {
                  empresaId,
                  productoId: id,
                  colorId: this.parseId(color.colorId, 'colorId'),
                  activo: color.activo ?? true,
                },
              }),
            ),
          );
        }

        const allProductColors = await tx.productoColor.findMany({
          where: { productoId: id },
        });
        const productColorByColorId = new Map(
          allProductColors.map((pc) => [pc.colorId.toString(), pc]),
        );
        const colorNameById = await this.getColorNameById(
          tx,
          empresaId,
          colorIds,
        );
        const sizeNameById = await this.getSizeNameById(
          tx,
          empresaId,
          tallaIds,
        );

        const existingVariants = await tx.productoVariante.findMany({
          where: { productoId: id, deletedAt: null },
          include: { productoColor: true, inventarios: true },
        });
        const reservedSkus = new Set(
          existingVariants
            .map((item) => item.sku)
            .filter((value): value is string => Boolean(value)),
        );
        const reservedBarcodes = new Set(
          existingVariants
            .map((item) => item.codigoBarras)
            .filter((value): value is string => Boolean(value)),
        );
        const existingVariantKeyMap = new Map(
          existingVariants.map((v) => [
            `${v.productoColor.colorId.toString()}-${v.tallaId.toString()}`,
            v,
          ]),
        );

        const inputVariantKeys = new Set(
          variantes.map((v) => `${v.colorId}-${v.tallaId}`),
        );

        for (const existingVariant of existingVariants) {
          const key = `${existingVariant.productoColor.colorId.toString()}-${existingVariant.tallaId.toString()}`;
          if (!inputVariantKeys.has(key)) {
            await tx.productoVariante.update({
              where: { id: existingVariant.id },
              data: { deletedAt: new Date() },
            });
          }
        }

        for (const variant of variantes) {
          const key = `${variant.colorId}-${variant.tallaId}`;
          const existingVariant = existingVariantKeyMap.get(key);
          const productColor = productColorByColorId.get(variant.colorId);
          if (existingVariant?.sku) reservedSkus.delete(existingVariant.sku);
          if (existingVariant?.codigoBarras) {
            reservedBarcodes.delete(existingVariant.codigoBarras);
          }

          if (!productColor) {
            throw new BadRequestException(
              'Todas las variantes deben pertenecer a un color del producto',
            );
          }

          const variantData = {
            empresaId,
            productoId: id,
            productoColorId: productColor.id,
            tallaId: this.parseId(variant.tallaId, 'tallaId'),
            sku: await this.resolveVariantSku({
              tx,
              empresaId,
              productName: nombre,
              colorName: colorNameById.get(variant.colorId) ?? 'GEN',
              sizeName: sizeNameById.get(variant.tallaId) ?? 'UNI',
              inputSku: variant.sku,
              existingSku: existingVariant?.sku,
              excludeVariantId: existingVariant?.id,
              reservedSkus,
            }),
            codigoBarras: await this.resolveVariantBarcode({
              tx,
              empresaId,
              inputBarcode: variant.codigoBarras,
              existingBarcode: existingVariant?.codigoBarras,
              excludeVariantId: existingVariant?.id,
              reservedBarcodes,
            }),
            precioCompra: this.toOptionalDecimal(variant.precioCompra),
            precioVenta: this.toRequiredDecimal(
              variant.precioVenta,
              'precioVenta',
            ),
            precioMayorista: this.toOptionalDecimal(variant.precioMayorista),
            activo: variant.activo ?? true,
          };

          if (existingVariant) {
            await tx.productoVariante.update({
              where: { id: existingVariant.id },
              data: variantData,
            });
          } else {
            await tx.productoVariante.create({ data: variantData });
          }

          if (variantData.sku) reservedSkus.add(variantData.sku);
          if (variantData.codigoBarras) {
            reservedBarcodes.add(variantData.codigoBarras);
          }
        }

        const allVariants = await tx.productoVariante.findMany({
          where: { productoId: id, deletedAt: null },
          include: { productoColor: true },
        });

        for (const variant of allVariants) {
          const inputVariant = variantes.find(
            (v) =>
              v.colorId === variant.productoColor.colorId.toString() &&
              v.tallaId === variant.tallaId.toString(),
          );

          if (!inputVariant) {
            continue;
          }

          for (const stock of inputVariant.stocks ?? []) {
            await this.stockService.setStock(tx, {
              empresaId,
              sucursalId: this.parseId(stock.sucursalId, 'sucursalId'),
              productoVarianteId: variant.id,
              stockActual: this.toPositiveInt(
                stock.stockActual ?? 0,
                'stockActual',
              ),
              stockMinimo: this.toPositiveInt(
                stock.stockMinimo ?? 0,
                'stockMinimo',
              ),
              tipo: StockMovimientoTipo.ajuste_producto,
              motivo: 'Stock actualizado desde el producto',
              creadoPorId: scope.userId,
            });
          }
        }

        const existingImages = await tx.productoColorImagen.findMany({
          where: { productoColor: { productoId: id } },
        });
        const inputImageIds = new Set(
          imagenes.filter((img) => img.serverId).map((img) => img.serverId!),
        );

        const imagesToDelete = existingImages.filter(
          (img) => !inputImageIds.has(img.id.toString()),
        );

        for (const img of imagesToDelete) {
          await this.r2StorageService.deleteProductImage({
            r2KeyOriginal: img.r2KeyOriginal,
            r2KeyWebp: img.r2KeyWebp,
            r2KeyThumbnail: img.r2KeyThumbnail,
          });
        }

        if (imagesToDelete.length > 0) {
          await tx.productoColorImagen.deleteMany({
            where: { id: { in: imagesToDelete.map((img) => img.id) } },
          });
        }

        const imageUpdateMap = new Map<
          string,
          { orden: number; esPrincipal: boolean }
        >();
        for (const img of imagenes) {
          if (img.serverId) {
            imageUpdateMap.set(img.serverId, {
              orden: img.orden ?? 0,
              esPrincipal: img.esPrincipal ?? false,
            });
          }
        }

        for (const [serverId, updateData] of imageUpdateMap) {
          await tx.productoColorImagen.update({
            where: { id: BigInt(serverId) },
            data: updateData,
          });
        }

        if (files.length > 0) {
          const allProductColors = await tx.productoColor.findMany({
            where: { productoId: id },
          });

          await this.createProductImages({
            tx,
            empresaId,
            productoId: id,
            productColors: allProductColors,
            imagenes: imagenes.filter((img) => !img.serverId),
            files,
          });
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 120_000,
      },
    );

    return this.findOne(empresaId, scope, existing.publicId);
  }

  private assertStockScope(scope: CommercialScope, branchIds: bigint[]) {
    if (
      scope.branchId &&
      branchIds.some((branchId) => branchId !== scope.branchId)
    ) {
      throw new BadRequestException(
        'No puedes modificar stock de otra sucursal',
      );
    }
  }

  async remove(empresaId: bigint, publicId: string) {
    const product = await this.prisma.producto.findFirst({
      where: {
        publicId,
        empresaId,
        deletedAt: null,
      },
      select: {
        id: true,
        publicId: true,
        nombre: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    const images = await this.prisma.productoColorImagen.findMany({
      where: {
        productoColor: {
          productoId: product.id,
        },
      },
      select: {
        r2KeyOriginal: true,
        r2KeyWebp: true,
        r2KeyThumbnail: true,
      },
    });

    await Promise.all(
      images.map((image) =>
        this.r2StorageService.deleteProductImage({
          r2KeyOriginal: image.r2KeyOriginal,
          r2KeyWebp: image.r2KeyWebp,
          r2KeyThumbnail: image.r2KeyThumbnail,
        }),
      ),
    );

    const deletedAt = new Date();

    await this.prisma.$transaction([
      this.prisma.producto.update({
        where: { id: product.id },
        data: {
          activo: false,
          deletedAt,
        },
      }),
      this.prisma.productoVariante.updateMany({
        where: {
          productoId: product.id,
          empresaId,
          deletedAt: null,
        },
        data: {
          activo: false,
          deletedAt,
        },
      }),
      this.prisma.productoColor.updateMany({
        where: {
          productoId: product.id,
          empresaId,
        },
        data: {
          activo: false,
        },
      }),
      this.prisma.productoColorImagen.deleteMany({
        where: {
          productoColor: {
            productoId: product.id,
            empresaId,
          },
        },
      }),
    ]);

    return {
      publicId: product.publicId,
      nombre: product.nombre,
      activo: false,
      deletedAt,
    };
  }

  private async getColorNameById(
    tx: Prisma.TransactionClient,
    empresaId: bigint,
    colorIds: bigint[],
  ) {
    const colors = await tx.color.findMany({
      where: {
        id: { in: colorIds },
        empresaId,
      },
      select: {
        id: true,
        nombre: true,
      },
    });

    return new Map(colors.map((color) => [color.id.toString(), color.nombre]));
  }

  private async getSizeNameById(
    tx: Prisma.TransactionClient,
    empresaId: bigint,
    tallaIds: bigint[],
  ) {
    const sizes = await tx.talla.findMany({
      where: {
        id: { in: tallaIds },
        empresaId,
      },
      select: {
        id: true,
        nombre: true,
      },
    });

    return new Map(sizes.map((size) => [size.id.toString(), size.nombre]));
  }

  private async resolveVariantSku(params: {
    tx: Prisma.TransactionClient;
    empresaId: bigint;
    productName: string;
    colorName: string;
    sizeName: string;
    inputSku?: string | null;
    existingSku?: string | null;
    excludeVariantId?: bigint;
    reservedSkus: Set<string>;
  }) {
    const inputSku = this.cleanOptionalText(params.inputSku)?.toUpperCase();

    if (inputSku) {
      params.reservedSkus.add(inputSku);
      return inputSku;
    }

    if (params.existingSku) {
      params.reservedSkus.add(params.existingSku);
      return params.existingSku;
    }

    const baseSku = [
      this.buildSkuSegment(params.productName, 3),
      this.buildSkuSegment(params.colorName, 3),
      this.buildSkuSegment(params.sizeName, 6),
    ].join('-');

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const sku = `${baseSku}-${randomInt(0, 1000)
        .toString()
        .padStart(3, '0')}`;

      if (
        !params.reservedSkus.has(sku) &&
        !(await this.variantSkuExists(params.tx, params.empresaId, sku))
      ) {
        params.reservedSkus.add(sku);
        return sku;
      }
    }

    throw new ConflictException('No se pudo generar un SKU unico');
  }

  private async resolveVariantBarcode(params: {
    tx: Prisma.TransactionClient;
    empresaId: bigint;
    inputBarcode?: string | null;
    existingBarcode?: string | null;
    excludeVariantId?: bigint;
    reservedBarcodes: Set<string>;
  }) {
    const inputBarcode = this.cleanOptionalText(params.inputBarcode);

    if (inputBarcode) {
      params.reservedBarcodes.add(inputBarcode);
      return inputBarcode;
    }

    if (params.existingBarcode) {
      params.reservedBarcodes.add(params.existingBarcode);
      return params.existingBarcode;
    }

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const barcode = this.generateEan13Barcode();

      if (
        !params.reservedBarcodes.has(barcode) &&
        !(await this.variantBarcodeExists(params.tx, params.empresaId, barcode))
      ) {
        params.reservedBarcodes.add(barcode);
        return barcode;
      }
    }

    throw new ConflictException('No se pudo generar un codigo de barras unico');
  }

  private async variantSkuExists(
    tx: Prisma.TransactionClient,
    empresaId: bigint,
    sku: string,
  ) {
    const variant = await tx.productoVariante.findFirst({
      where: {
        empresaId,
        sku,
      },
      select: { id: true },
    });

    return Boolean(variant);
  }

  private async variantBarcodeExists(
    tx: Prisma.TransactionClient,
    empresaId: bigint,
    codigoBarras: string,
  ) {
    const variant = await tx.productoVariante.findFirst({
      where: {
        empresaId,
        codigoBarras,
      },
      select: { id: true },
    });

    return Boolean(variant);
  }

  private generateEan13Barcode() {
    const body = `775${randomInt(0, 1_000_000_000)
      .toString()
      .padStart(9, '0')}`;

    return `${body}${this.calculateEan13CheckDigit(body)}`;
  }

  private calculateEan13CheckDigit(firstTwelveDigits: string) {
    const sum = firstTwelveDigits.split('').reduce((total, digit, index) => {
      const value = Number(digit);
      return total + value * (index % 2 === 0 ? 1 : 3);
    }, 0);

    return (10 - (sum % 10)) % 10;
  }

  private buildSkuSegment(value: string, maxLength: number) {
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

    return (normalized || 'GEN').slice(0, maxLength);
  }

  private async createProductImages(params: {
    tx: Prisma.TransactionClient;
    empresaId: bigint;
    productoId: bigint;
    productColors: { id: bigint; colorId: bigint }[];
    imagenes: ProductImageInput[];
    files: Express.Multer.File[];
  }) {
    const productColorByColorId = new Map(
      params.productColors.map((productColor) => [
        productColor.colorId.toString(),
        productColor,
      ]),
    );
    const principalAssigned = new Set<string>();
    const imageRows: Prisma.ProductoColorImagenCreateManyInput[] = [];

    for (const [index, file] of params.files.entries()) {
      const imageMeta = params.imagenes[index];
      if (!imageMeta.colorId) {
        throw new BadRequestException('La imagen no tiene una presentación');
      }
      const productColor = productColorByColorId.get(imageMeta.colorId);

      if (!productColor) {
        throw new BadRequestException(
          'Todas las imagenes deben pertenecer a un color del producto',
        );
      }

      const uploaded = await this.r2StorageService.uploadProductColorImage({
        empresaId: params.empresaId,
        productoId: params.productoId,
        colorId: productColor.colorId,
        file,
      });
      const forcePrincipal = imageMeta.esPrincipal === true;
      const shouldBePrincipal =
        forcePrincipal || !principalAssigned.has(imageMeta.colorId);

      if (shouldBePrincipal) {
        principalAssigned.add(imageMeta.colorId);
      }

      imageRows.push({
        empresaId: params.empresaId,
        productoColorId: productColor.id,
        urlOriginal: uploaded.urlOriginal,
        urlWebp: uploaded.urlWebp,
        urlThumbnail: uploaded.urlThumbnail,
        r2KeyOriginal: uploaded.r2KeyOriginal,
        r2KeyWebp: uploaded.r2KeyWebp,
        r2KeyThumbnail: uploaded.r2KeyThumbnail,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        width: uploaded.width,
        height: uploaded.height,
        orden: this.toPositiveInt(imageMeta.orden ?? index, 'orden'),
        esPrincipal: shouldBePrincipal,
      });
    }

    await params.tx.productoColorImagen.createMany({ data: imageRows });
  }

  private async ensureCatalogReferences(params: {
    empresaId: bigint;
    marcaId: bigint | null;
    categoriaId: bigint | null;
    colorIds: bigint[];
    tallaIds: bigint[];
    stockSucursalIds: bigint[];
  }) {
    const [marca, categoria, colors, sizes, branches] = await Promise.all([
      params.marcaId
        ? this.prisma.marca.findFirst({
            where: {
              id: params.marcaId,
              empresaId: params.empresaId,
              activo: true,
              deletedAt: null,
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      params.categoriaId
        ? this.prisma.categoria.findFirst({
            where: {
              id: params.categoriaId,
              empresaId: params.empresaId,
              activo: true,
              deletedAt: null,
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      this.prisma.color.findMany({
        where: {
          id: { in: params.colorIds },
          empresaId: params.empresaId,
          activo: true,
          deletedAt: null,
        },
        select: { id: true },
      }),
      this.prisma.talla.findMany({
        where: {
          id: { in: params.tallaIds },
          empresaId: params.empresaId,
          activo: true,
          deletedAt: null,
        },
        select: { id: true },
      }),
      params.stockSucursalIds.length > 0
        ? this.prisma.sucursal.findMany({
            where: {
              id: { in: params.stockSucursalIds },
              empresaId: params.empresaId,
              estado: SucursalEstado.activo,
            },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);

    if (params.marcaId && !marca) {
      throw new BadRequestException('La marca no existe o esta inactiva');
    }

    if (params.categoriaId && !categoria) {
      throw new BadRequestException('La categoria no existe o esta inactiva');
    }

    if (colors.length !== params.colorIds.length) {
      throw new BadRequestException(
        'Uno o mas colores no existen o estan inactivos',
      );
    }

    if (sizes.length !== params.tallaIds.length) {
      throw new BadRequestException(
        'Una o mas tallas no existen o estan inactivas',
      );
    }

    if (branches.length !== params.stockSucursalIds.length) {
      throw new BadRequestException(
        'Una o mas sucursales no existen o estan inactivas',
      );
    }
  }

  private upsertUnidadMedida(
    tx: Prisma.TransactionClient,
    codigoInput: string,
  ) {
    const codigo = codigoInput.trim().toUpperCase() || 'NIU';

    return tx.unidadMedida.upsert({
      where: { codigo },
      update: { activo: true },
      create: {
        codigo,
        descripcion: codigo === 'NIU' ? 'Unidad' : codigo,
        activo: true,
      },
    });
  }

  private upsertTipoAfectacionIgv(
    tx: Prisma.TransactionClient,
    codigoInput: string,
  ) {
    const codigo = codigoInput.trim() || '10';

    return tx.tipoAfectacionIgv.upsert({
      where: { codigo },
      update: { activo: true },
      create: {
        codigo,
        descripcion:
          codigo === '10' ? 'Gravado - Operacion Onerosa' : `Tipo ${codigo}`,
        activo: true,
      },
    });
  }

  private async resolveProductInputs(
    empresaId: bigint,
    tipo: ProductoTipo,
    dto: CreateProductDto,
  ) {
    const imagenes = this.parseJsonArray<ProductImageInput>(
      dto.imagenes ?? '[]',
      'imagenes',
    );

    if (tipo === ProductoTipo.variantes) {
      return {
        colores: this.parseJsonArray<ProductColorInput>(
          dto.colores ?? '[]',
          'colores',
        ),
        variantes: this.parseJsonArray<ProductVariantInput>(
          dto.variantes ?? '[]',
          'variantes',
        ),
        imagenes: imagenes.map((image) => {
          if (!image.colorId) {
            throw new BadRequestException(
              'Todas las imágenes deben pertenecer a un color',
            );
          }
          return { ...image, colorId: image.colorId };
        }),
      };
    }

    if (!dto.simple) {
      throw new BadRequestException('Completa los datos del producto normal');
    }
    const simple = this.parseJsonObject<SimpleProductInput>(
      dto.simple,
      'simple',
    );
    const refs = await this.prisma.$transaction((tx) =>
      this.ensureSimpleCatalogs(tx, empresaId),
    );

    return {
      colores: [{ colorId: refs.colorId.toString(), activo: true }],
      variantes: [
        {
          ...simple,
          colorId: refs.colorId.toString(),
          tallaId: refs.sizeId.toString(),
        },
      ],
      imagenes: imagenes.map((image) => ({
        ...image,
        colorId: refs.colorId.toString(),
      })),
    };
  }

  private async ensureSimpleCatalogs(
    tx: Prisma.TransactionClient,
    empresaId: bigint,
  ) {
    const [color, size] = await Promise.all([
      tx.color.upsert({
        where: {
          empresaId_sistemaCodigo: {
            empresaId,
            sistemaCodigo: 'PRODUCTO_NORMAL',
          },
        },
        update: { activo: true, deletedAt: null },
        create: {
          empresaId,
          nombre: 'Presentación única',
          nombreKey: '__norbitex_producto_normal_color__',
          sistemaCodigo: 'PRODUCTO_NORMAL',
          hex: '#94A3B8',
          activo: true,
        },
      }),
      tx.talla.upsert({
        where: {
          empresaId_sistemaCodigo: {
            empresaId,
            sistemaCodigo: 'PRODUCTO_NORMAL',
          },
        },
        update: { activo: true, deletedAt: null },
        create: {
          empresaId,
          nombre: 'Única',
          nombreKey: '__norbitex_producto_normal_talla__',
          sistemaCodigo: 'PRODUCTO_NORMAL',
          activo: true,
        },
      }),
    ]);
    return { colorId: color.id, sizeId: size.id };
  }

  private parseJsonObject<T>(value: string, fieldName: string): T {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('No es un objeto');
      }
      return parsed as T;
    } catch {
      throw new BadRequestException(`${fieldName} debe ser un JSON valido`);
    }
  }

  private parseJsonArray<T>(value: string, fieldName: string): T[] {
    try {
      const parsed = JSON.parse(value) as unknown;

      if (!Array.isArray(parsed)) {
        throw new Error('No es un arreglo');
      }

      return parsed as T[];
    } catch {
      throw new BadRequestException(`${fieldName} debe ser un JSON valido`);
    }
  }

  private validateVariantsBelongToColors(
    variantes: ProductVariantInput[],
    colorIds: bigint[],
  ) {
    const colorSet = new Set(colorIds.map((id) => id.toString()));

    for (const variant of variantes) {
      if (!colorSet.has(variant.colorId)) {
        throw new BadRequestException(
          'Todas las variantes deben pertenecer a un color del producto',
        );
      }
    }
  }

  private validateUniqueVariants(variantes: ProductVariantInput[]) {
    const variantKeys = new Set<string>();

    for (const variant of variantes) {
      const key = `${variant.colorId}-${variant.tallaId}`;

      if (variantKeys.has(key)) {
        throw new BadRequestException(
          'Hay variantes duplicadas por color y talla',
        );
      }

      variantKeys.add(key);
    }
  }

  private validateStockInputs(variantes: ProductVariantInput[]) {
    for (const variant of variantes) {
      const stockKeys = new Set<string>();

      for (const stock of variant.stocks ?? []) {
        if (stockKeys.has(stock.sucursalId)) {
          throw new BadRequestException(
            'No repitas la misma sucursal dentro de una variante',
          );
        }

        stockKeys.add(stock.sucursalId);
      }
    }
  }

  private uniqueBigIntIds(values: string[]) {
    return Array.from(
      new Set(values.map((value) => this.parseId(value, 'id'))),
    );
  }

  private parseOptionalId(value: string | undefined, fieldName: string) {
    if (!value) {
      return null;
    }

    return this.parseId(value, fieldName);
  }

  private parseId(value: string, fieldName: string) {
    if (!/^\d+$/.test(String(value))) {
      throw new BadRequestException(`${fieldName} debe ser un id valido`);
    }

    return BigInt(value);
  }

  private parseBoolean(value: string | undefined, defaultValue: boolean) {
    if (value === undefined) {
      return defaultValue;
    }

    return value === 'true';
  }

  private toRequiredDecimal(value: number | string, fieldName: string) {
    const decimal = this.toOptionalDecimal(value);

    if (!decimal) {
      throw new BadRequestException(`${fieldName} es obligatorio`);
    }

    return decimal;
  }

  private toOptionalDecimal(value?: number | string | null) {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    const numericValue = Number(value);

    if (!Number.isFinite(numericValue) || numericValue < 0) {
      throw new BadRequestException(
        'Los precios deben ser mayores o iguales a cero',
      );
    }

    return new Prisma.Decimal(numericValue.toFixed(2));
  }

  private toPositiveInt(value: number | string, fieldName: string) {
    const numberValue = Number(value);

    if (!Number.isInteger(numberValue) || numberValue < 0) {
      throw new BadRequestException(`${fieldName} debe ser un entero positivo`);
    }

    return numberValue;
  }

  private cleanText(value: string) {
    return value.trim().replace(/\s+/g, ' ');
  }

  private getDefaultPaginationLimit() {
    const defaultLimit = Number(
      this.configService.get<string>('PAGINATION_DEFAULT_LIMIT') ?? 12,
    );
    const maxLimit = Number(
      this.configService.get<string>('PAGINATION_MAX_LIMIT') ?? 100,
    );

    if (!Number.isInteger(defaultLimit) || defaultLimit <= 0) {
      return 12;
    }

    if (!Number.isInteger(maxLimit) || maxLimit <= 0) {
      return defaultLimit;
    }

    return Math.min(defaultLimit, maxLimit);
  }

  private buildProductVariantWhere(params: {
    empresaId: bigint;
    colorId: bigint | null;
    tallaId: bigint | null;
    sucursalId: bigint | null;
  }) {
    if (!params.colorId && !params.tallaId && !params.sucursalId) {
      return null;
    }

    return {
      empresaId: params.empresaId,
      activo: true,
      deletedAt: null,
      ...(params.tallaId ? { tallaId: params.tallaId } : {}),
      ...(params.colorId
        ? {
            productoColor: {
              colorId: params.colorId,
              activo: true,
            },
          }
        : {}),
      ...(params.sucursalId
        ? {
            inventarios: {
              some: {
                empresaId: params.empresaId,
                sucursalId: params.sucursalId,
              },
            },
          }
        : {}),
    } satisfies Prisma.ProductoVarianteWhereInput;
  }

  private cleanOptionalText(value?: string | null) {
    const cleanValue = value?.trim().replace(/\s+/g, ' ');
    return cleanValue || null;
  }

  private buildNameKey(value: string) {
    return this.cleanText(value).toLowerCase();
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Ya existe un producto, SKU o codigo de barras con esos datos',
      );
    }

    throw error;
  }

  private toResponse(
    product: ProductWithRelations,
    options: { sucursalId?: bigint | null } = {},
  ) {
    const stockTotal = product.variantes.reduce(
      (total, variant) =>
        total +
        variant.inventarios.reduce(
          (variantTotal, inventory) => variantTotal + inventory.stockActual,
          0,
        ),
      0,
    );
    const stockSucursal = options.sucursalId
      ? product.variantes.reduce(
          (total, variant) =>
            total +
            variant.inventarios
              .filter(
                (inventory) => inventory.sucursalId === options.sucursalId,
              )
              .reduce(
                (variantTotal, inventory) =>
                  variantTotal + inventory.stockActual,
                0,
              ),
          0,
        )
      : null;

    return {
      id: product.id.toString(),
      publicId: product.publicId,
      empresaId: product.empresaId.toString(),
      nombre: product.nombre,
      tipo: product.tipo,
      descripcion: product.descripcion,
      activo: product.activo,
      stockTotal,
      stockSucursal,
      marca: product.marca
        ? {
            id: product.marca.id.toString(),
            nombre: product.marca.nombre,
          }
        : null,
      categoria: product.categoria
        ? {
            id: product.categoria.id.toString(),
            nombre: product.categoria.nombre,
          }
        : null,
      unidadMedida: {
        id: product.unidadMedida.id.toString(),
        codigo: product.unidadMedida.codigo,
        descripcion: product.unidadMedida.descripcion,
      },
      tipoAfectacionIgv: {
        id: product.tipoAfectacionIgv.id.toString(),
        codigo: product.tipoAfectacionIgv.codigo,
        descripcion: product.tipoAfectacionIgv.descripcion,
      },
      colores: product.colores.map((productColor) => ({
        id: productColor.id.toString(),
        activo: productColor.activo,
        color: {
          id: productColor.color.id.toString(),
          nombre: productColor.color.nombre,
          hex: productColor.color.hex,
        },
        imagenes: productColor.imagenes.map((image) => ({
          id: image.id.toString(),
          urlOriginal: image.urlOriginal,
          urlWebp: image.urlWebp,
          urlThumbnail: image.urlThumbnail,
          orden: image.orden,
          esPrincipal: image.esPrincipal,
          width: image.width,
          height: image.height,
        })),
      })),
      variantes: product.variantes.map((variant) => ({
        id: variant.id.toString(),
        productoColorId: variant.productoColorId.toString(),
        color: {
          id: variant.productoColor.color.id.toString(),
          nombre: variant.productoColor.color.nombre,
          hex: variant.productoColor.color.hex,
        },
        talla: {
          id: variant.talla.id.toString(),
          nombre: variant.talla.nombre,
        },
        sku: variant.sku,
        codigoBarras: variant.codigoBarras,
        precioCompra: variant.precioCompra?.toString() ?? null,
        precioVenta: variant.precioVenta.toString(),
        precioMayorista: variant.precioMayorista?.toString() ?? null,
        activo: variant.activo,
        stockTotal: variant.inventarios.reduce(
          (total, inventory) => total + inventory.stockActual,
          0,
        ),
        stockSucursal: options.sucursalId
          ? variant.inventarios
              .filter(
                (inventory) => inventory.sucursalId === options.sucursalId,
              )
              .reduce((total, inventory) => total + inventory.stockActual, 0)
          : null,
        inventarios: variant.inventarios
          .filter(
            (inventory) =>
              !options.sucursalId ||
              inventory.sucursalId === options.sucursalId,
          )
          .map((inventory) => ({
            id: inventory.id.toString(),
            sucursal: {
              id: inventory.sucursal.id.toString(),
              nombre: inventory.sucursal.nombre,
              tipo: inventory.sucursal.tipo,
            },
            stockActual: inventory.stockActual,
            stockMinimo: inventory.stockMinimo,
          })),
      })),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }
}
