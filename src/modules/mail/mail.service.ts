import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BREVO_EMAIL_URL = 'https://api.brevo.com/v3/smtp/email';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendVerificationCode(email: string, code: string) {
    await this.sendEmail(
      email,
      'Verifica tu correo en Norbitex',
      this.layout(
        'Verifica tu correo',
        `Usa este codigo para continuar con tu registro:<div style="margin:24px 0;padding:16px;border-radius:8px;background:#f3f4f6;color:#17206f;font-size:30px;font-weight:800;letter-spacing:6px;text-align:center">${escapeHtml(code)}</div><p style="margin:0;color:#667085">El codigo vence en 10 minutos. Si no solicitaste el registro, ignora este mensaje.</p>`,
      ),
      'email-verification',
    );
  }

  async sendPasswordResetToken(email: string, token: string) {
    const appUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3001';
    const resetUrl = `${appUrl.replace(/\/$/, '')}/forgot-password?token=${encodeURIComponent(token)}`;

    await this.sendEmail(
      email,
      'Restablece tu contrasena de Norbitex',
      this.layout(
        'Restablece tu contrasena',
        `<p>Recibimos una solicitud para cambiar tu contrasena.</p><p style="margin:24px 0"><a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#17206f;color:#ffffff;text-decoration:none;font-weight:700">Crear nueva contrasena</a></p><p style="margin:0;color:#667085">Este enlace vence en 30 minutos. Si no hiciste esta solicitud, puedes ignorar el mensaje.</p>`,
      ),
      'password-reset',
    );
  }

  sendPlatformReceipt(email: string, correlativo: string) {
    this.logger.log(
      `Comprobante Nobitex ${correlativo} disponible para ${email}`,
    );
  }

  private async sendEmail(
    recipient: string,
    subject: string,
    htmlContent: string,
    tag: string,
  ) {
    const enabled =
      this.configService.get<string>('BREVO_ENABLED', 'false') === 'true';
    const apiKey = this.configService.get<string>('BREVO_API_KEY')?.trim();
    const senderEmail = this.configService
      .get<string>('BREVO_SENDER_EMAIL')
      ?.trim();

    if (!enabled) {
      throw new ServiceUnavailableException(
        'El servicio de correo Brevo no esta habilitado.',
      );
    }
    if (!apiKey || !senderEmail) {
      throw new ServiceUnavailableException(
        'El servicio de correo Brevo no esta configurado.',
      );
    }

    const replyTo = this.configService
      .get<string>('BREVO_REPLY_TO_EMAIL')
      ?.trim();
    const response = await fetch(BREVO_EMAIL_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: {
          email: senderEmail,
          name:
            this.configService.get<string>('BREVO_SENDER_NAME')?.trim() ||
            'Norbitex',
        },
        to: [{ email: recipient }],
        subject,
        htmlContent,
        tags: [tag],
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch((error: unknown) => {
      this.logger.error('No se pudo conectar con Brevo', error);
      throw new ServiceUnavailableException(
        'No se pudo enviar el correo. Intenta nuevamente.',
      );
    });

    if (!response.ok) {
      this.logger.error(
        `Brevo rechazo el correo (${response.status}): ${await response.text()}`,
      );
      throw new ServiceUnavailableException(
        'No se pudo enviar el correo. Verifica la configuracion de Brevo.',
      );
    }
  }

  private layout(title: string, content: string) {
    return `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:Arial,sans-serif;color:#101828"><div style="max-width:560px;margin:0 auto;padding:32px 16px"><div style="padding:28px;border-radius:10px;background:#ffffff;border:1px solid #e5e7eb"><div style="margin-bottom:24px;color:#17206f;font-size:22px;font-weight:800">NORBITEX</div><h1 style="margin:0 0 16px;font-size:22px">${title}</h1><div style="font-size:15px;line-height:1.6">${content}</div></div><p style="margin:16px 0 0;text-align:center;color:#98a2b3;font-size:12px">Mensaje automatico de Norbitex</p></div></body></html>`;
  }
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[character]!,
  );
}
