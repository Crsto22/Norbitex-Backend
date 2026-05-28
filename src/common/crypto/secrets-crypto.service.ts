import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const CIPHER_ALGORITHM = 'aes-256-gcm';
const ENCRYPTED_VALUE_PREFIX = 'v1';

@Injectable()
export class SecretsCryptoService {
  constructor(private readonly configService: ConfigService) {}

  encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(CIPHER_ALGORITHM, this.getKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      ENCRYPTED_VALUE_PREFIX,
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  decrypt(value: string) {
    const [version, iv, authTag, encrypted] = value.split(':');

    if (version !== ENCRYPTED_VALUE_PREFIX || !iv || !authTag || !encrypted) {
      throw new InternalServerErrorException(
        'El formato del secreto cifrado no es valido',
      );
    }

    const decipher = createDecipheriv(
      CIPHER_ALGORITHM,
      this.getKey(),
      Buffer.from(iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private getKey() {
    const configuredKey = this.configService.get<string>(
      'SUNAT_SECRETS_ENCRYPTION_KEY',
    );

    if (!configuredKey) {
      throw new InternalServerErrorException(
        'Configura SUNAT_SECRETS_ENCRYPTION_KEY para proteger secretos SUNAT',
      );
    }

    const normalizedKey = configuredKey.trim();
    const key = this.parseKey(normalizedKey);

    if (key.length !== 32) {
      throw new InternalServerErrorException(
        'SUNAT_SECRETS_ENCRYPTION_KEY debe tener 32 bytes',
      );
    }

    return key;
  }

  private parseKey(value: string) {
    if (/^[a-f0-9]{64}$/i.test(value)) {
      return Buffer.from(value, 'hex');
    }

    const base64Key = Buffer.from(value, 'base64');
    if (base64Key.length === 32) {
      return base64Key;
    }

    return Buffer.from(value, 'utf8');
  }
}
