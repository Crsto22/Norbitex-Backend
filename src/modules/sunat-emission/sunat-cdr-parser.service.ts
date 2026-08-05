import { Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { SunatEstado } from '@prisma/client';

@Injectable()
export class SunatCdrParserService {
  async parse(cdrZipBytes: Buffer) {
    const zip = await JSZip.loadAsync(cdrZipBytes);
    const xmlEntry = Object.values(zip.files).find(
      (entry) => !entry.dir && entry.name.toLowerCase().endsWith('.xml'),
    );

    if (!xmlEntry) {
      throw new Error('El CDR devuelto por SUNAT no contiene XML');
    }

    const xml = await xmlEntry.async('string');
    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
    });
    const parsed = parser.parse(xml) as unknown;
    const response = this.findResponse(parsed);
    const code = this.toText(response?.ResponseCode);
    const description = this.toText(response?.Description);
    const notes = this.toArray(response?.Note).map((note) =>
      String(note).trim(),
    );

    return {
      estado: this.resolveEstado(code, notes),
      codigo: code || null,
      mensaje: [description || 'SUNAT respondio sin descripcion', ...notes]
        .filter(Boolean)
        .join(' | '),
      xmlFileName: xmlEntry.name,
      xml,
    };
  }

  private resolveEstado(code: string, notes: string[]) {
    if (code === '0') {
      return notes.length > 0 ? SunatEstado.observado : SunatEstado.aceptado;
    }

    return SunatEstado.rechazado;
  }

  private findResponse(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const object = value as Record<string, unknown>;
    if (object.ResponseCode || object.Description) {
      return object;
    }

    for (const child of Object.values(object)) {
      const found = this.findResponse(child);
      if (found) {
        return found;
      }
    }

    return null;
  }

  private toArray(value: unknown): unknown[] {
    if (value === undefined || value === null) {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  }

  private toText(value: unknown) {
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value).trim();
    }

    return '';
  }
}
