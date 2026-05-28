import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { SecretsCryptoService } from './secrets-crypto.service';

describe('SecretsCryptoService', () => {
  function createService(key: string) {
    return new SecretsCryptoService({
      get: jest.fn().mockReturnValue(key),
    } as unknown as ConfigService);
  }

  it('encrypts and decrypts a secret value', () => {
    const key = randomBytes(32).toString('base64');
    const service = createService(key);
    const encrypted = service.encrypt('clave-sol-secreta');

    expect(encrypted).not.toBe('clave-sol-secreta');
    expect(service.decrypt(encrypted)).toBe('clave-sol-secreta');
  });

  it('uses a random iv for every encrypted value', () => {
    const key = randomBytes(32).toString('base64');
    const service = createService(key);

    expect(service.encrypt('same-secret')).not.toBe(
      service.encrypt('same-secret'),
    );
  });

  it('rejects invalid encryption keys', () => {
    const service = createService('too-short');

    expect(() => service.encrypt('secret')).toThrow(
      InternalServerErrorException,
    );
  });
});
