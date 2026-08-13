import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PdfConcurrencyService {
  private active = 0;

  constructor(private readonly configService: ConfigService) {}

  async run<T>(factory: () => Promise<T>) {
    const limit = this.limit();
    if (this.active >= limit) {
      throw new HttpException(
        {
          code: 'PDF_CONCURRENCY_LIMIT',
          message:
            'Hay demasiados PDFs generandose en este momento. Intenta nuevamente en unos segundos.',
          limit,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.active += 1;
    try {
      return await factory();
    } finally {
      this.active -= 1;
    }
  }

  private limit() {
    const value = Number(
      this.configService.get<string>('PDF_CONCURRENCY_LIMIT'),
    );
    return Number.isInteger(value) && value > 0 ? value : 3;
  }
}
