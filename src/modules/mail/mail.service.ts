import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  sendVerificationCode(email: string, code: string) {
    this.logger.log(`Codigo de verificacion para ${email}: ${code}`);
  }

  sendPasswordResetToken(email: string, token: string) {
    const appUrl = process.env.FRONTEND_URL ?? 'http://localhost:3001';
    const resetUrl = `${appUrl.replace(/\/$/, '')}/forgot-password?token=${encodeURIComponent(token)}`;

    this.logger.log(`Enlace para cambiar contrasena de ${email}: ${resetUrl}`);
  }
}
