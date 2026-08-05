import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Prisma,
  VentaDescuentoTipo,
  VentaTipoComprobante,
} from '@prisma/client';
import { isElectronicSaleType } from './sunat-comprobante.helper';

const HUNDRED = new Prisma.Decimal(100);
const ZERO = new Prisma.Decimal(0);

export type TaxInputLine = {
  productoVarianteId: bigint;
  cantidad: number;
  precioUnitario: Prisma.Decimal;
  descuentoTipo: VentaDescuentoTipo | null;
  descuentoValor: Prisma.Decimal | null;
  descripcion: string | null;
  unidadMedidaCodigo: string;
  tipoAfectacionIgvCodigo: string;
};

export type CalculatedSaleLine = TaxInputLine & {
  descuentoMonto: Prisma.Decimal;
  descuentoGlobalMonto: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  total: Prisma.Decimal;
  valorUnitario: Prisma.Decimal;
  valorVenta: Prisma.Decimal;
  igvMonto: Prisma.Decimal;
};

export type CalculatedSaleTotals = {
  subtotal: Prisma.Decimal;
  descuentoMonto: Prisma.Decimal;
  total: Prisma.Decimal;
  igvPorcentaje: Prisma.Decimal;
  opGravadas: Prisma.Decimal;
  opExoneradas: Prisma.Decimal;
  opInafectas: Prisma.Decimal;
  igvMonto: Prisma.Decimal;
  lines: CalculatedSaleLine[];
};

@Injectable()
export class SunatTaxService {
  calculate(params: {
    tipoComprobante: VentaTipoComprobante;
    lines: TaxInputLine[];
    descuentoTipo?: VentaDescuentoTipo;
    descuentoValor?: Prisma.Decimal | null;
    igvPorcentaje: Prisma.Decimal;
  }): CalculatedSaleTotals {
    const electronic = isElectronicSaleType(params.tipoComprobante);
    const baseLines = params.lines.map((line) =>
      this.calculateLineBeforeGlobalDiscount(line, electronic),
    );
    const subtotal = this.money(
      baseLines.reduce((sum, line) => sum.add(line.subtotal), ZERO),
    );
    const descuentoMonto = this.resolveGlobalDiscount(
      subtotal,
      params.descuentoTipo,
      params.descuentoValor,
    );

    if (descuentoMonto.gt(subtotal)) {
      throw new BadRequestException(
        'El descuento total no puede superar el total base de la venta',
      );
    }

    if (!electronic) {
      return {
        subtotal,
        descuentoMonto,
        total: this.money(subtotal.sub(descuentoMonto)),
        igvPorcentaje: params.igvPorcentaje,
        opGravadas: ZERO,
        opExoneradas: ZERO,
        opInafectas: ZERO,
        igvMonto: ZERO,
        lines: baseLines.map((line) => ({
          ...line,
          descuentoGlobalMonto: ZERO,
          valorUnitario: line.precioUnitario,
          valorVenta: line.total,
          igvMonto: ZERO,
        })),
      };
    }

    let descuentoPendiente = descuentoMonto;
    let opGravadas = ZERO;
    let opExoneradas = ZERO;
    let opInafectas = ZERO;
    let igvMonto = ZERO;

    const lines = baseLines.map((line, index) => {
      const descuentoGlobalMonto =
        index === baseLines.length - 1
          ? descuentoPendiente
          : subtotal.equals(0)
            ? ZERO
            : this.money(line.subtotal.mul(descuentoMonto).div(subtotal));
      descuentoPendiente = this.money(
        descuentoPendiente.sub(descuentoGlobalMonto),
      );
      const total = this.money(line.total.sub(descuentoGlobalMonto));
      const base = this.calculateBase(
        total,
        params.igvPorcentaje,
        line.tipoAfectacionIgvCodigo,
      );
      const igv = this.afectaIgv(line.tipoAfectacionIgvCodigo)
        ? this.money(total.sub(base))
        : ZERO;
      const baseBeforeDiscount = this.calculateBase(
        line.subtotal,
        params.igvPorcentaje,
        line.tipoAfectacionIgvCodigo,
      );
      const valorUnitario =
        line.cantidad > 0
          ? this.decimal(baseBeforeDiscount).div(line.cantidad)
          : ZERO;

      if (this.afectaIgv(line.tipoAfectacionIgvCodigo)) {
        opGravadas = this.money(opGravadas.add(base));
      } else if (line.tipoAfectacionIgvCodigo.startsWith('2')) {
        opExoneradas = this.money(opExoneradas.add(base));
      } else {
        opInafectas = this.money(opInafectas.add(base));
      }
      igvMonto = this.money(igvMonto.add(igv));

      return {
        ...line,
        descuentoMonto: this.money(
          line.descuentoMonto.add(descuentoGlobalMonto),
        ),
        descuentoGlobalMonto,
        total,
        valorUnitario,
        valorVenta: base,
        igvMonto: igv,
      };
    });

    return {
      subtotal,
      descuentoMonto,
      total: this.money(subtotal.sub(descuentoMonto)),
      igvPorcentaje: params.igvPorcentaje,
      opGravadas,
      opExoneradas,
      opInafectas,
      igvMonto,
      lines,
    };
  }

  private calculateLineBeforeGlobalDiscount(
    line: TaxInputLine,
    electronic: boolean,
  ) {
    const subtotal = this.money(line.precioUnitario.mul(line.cantidad));
    const descuentoMonto = this.resolveLineDiscount(
      subtotal,
      line.descuentoTipo,
      line.descuentoValor,
    );

    if (electronic && descuentoMonto.gt(0)) {
      throw new BadRequestException(
        'Para facturas y boletas use solo descuento global',
      );
    }

    if (descuentoMonto.gt(subtotal)) {
      throw new BadRequestException(
        'El descuento de una linea no puede superar su subtotal',
      );
    }

    return {
      ...line,
      descuentoMonto,
      descuentoGlobalMonto: ZERO,
      subtotal,
      total: this.money(subtotal.sub(descuentoMonto)),
      valorUnitario: ZERO,
      valorVenta: ZERO,
      igvMonto: ZERO,
    };
  }

  private resolveLineDiscount(
    subtotal: Prisma.Decimal,
    tipo?: VentaDescuentoTipo | null,
    valor?: Prisma.Decimal | null,
  ) {
    if (!tipo || !valor || valor.equals(0)) {
      return ZERO;
    }

    return tipo === VentaDescuentoTipo.porcentaje
      ? this.money(subtotal.mul(valor).div(HUNDRED))
      : this.money(valor);
  }

  private resolveGlobalDiscount(
    subtotal: Prisma.Decimal,
    tipo?: VentaDescuentoTipo,
    valor?: Prisma.Decimal | null,
  ) {
    if (!tipo || !valor || valor.equals(0)) {
      return ZERO;
    }

    if (tipo === VentaDescuentoTipo.porcentaje && valor.gt(100)) {
      throw new BadRequestException(
        'El descuento porcentual no puede superar 100',
      );
    }

    return tipo === VentaDescuentoTipo.porcentaje
      ? this.money(subtotal.mul(valor).div(HUNDRED))
      : this.money(valor);
  }

  private calculateBase(
    totalConIgv: Prisma.Decimal,
    igvPorcentaje: Prisma.Decimal,
    afectacion: string,
  ) {
    if (!this.afectaIgv(afectacion) || totalConIgv.equals(0)) {
      return this.money(totalConIgv);
    }

    const factor = new Prisma.Decimal(1).add(igvPorcentaje.div(HUNDRED));
    return this.money(totalConIgv.div(factor));
  }

  private afectaIgv(codigo: string) {
    return !codigo || codigo.startsWith('1');
  }

  private money(value: Prisma.Decimal) {
    return this.decimal(value).toDecimalPlaces(2);
  }

  private decimal(value: Prisma.Decimal) {
    return new Prisma.Decimal(value);
  }
}
