import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

describe('MailService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('envia verificacion y recuperacion mediante Brevo', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }));
    const service = new MailService(
      new ConfigService({
        BREVO_ENABLED: 'true',
        BREVO_API_KEY: 'test-key',
        BREVO_SENDER_EMAIL: 'no-reply@norbitex.pe',
        BREVO_SENDER_NAME: 'Norbitex',
        FRONTEND_URL: 'https://app.norbitex.pe',
      }),
    );

    await service.sendVerificationCode('cliente@example.com', '123456');
    await service.sendPasswordResetToken('cliente@example.com', 'token-test');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const verification = fetchMock.mock.calls[0][1]?.body;
    const passwordReset = fetchMock.mock.calls[1][1]?.body;
    if (typeof verification !== 'string' || typeof passwordReset !== 'string') {
      throw new Error('Brevo debe recibir un cuerpo JSON');
    }
    expect(verification).toContain('cliente@example.com');
    expect(verification).toContain('email-verification');
    expect(verification).toContain('123456');
    expect(passwordReset).toContain(
      'https://app.norbitex.pe/forgot-password?token=token-test',
    );
  });
});
