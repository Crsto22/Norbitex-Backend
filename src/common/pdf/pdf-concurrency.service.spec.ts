import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PdfConcurrencyService } from './pdf-concurrency.service';

describe('PdfConcurrencyService', () => {
  it('rejects work above the configured limit and releases capacity', async () => {
    const service = new PdfConcurrencyService({
      get: jest.fn().mockReturnValue('1'),
    } as unknown as ConfigService);
    let release!: () => void;
    const running = service.run(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('done');
        }),
    );

    await expect(
      service.run(() => Promise.resolve('blocked')),
    ).rejects.toBeInstanceOf(HttpException);
    release();
    await expect(running).resolves.toBe('done');
    await expect(service.run(() => Promise.resolve('next'))).resolves.toBe(
      'next',
    );
  });
});
