import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ValidateResetTokenDto } from './dto/validate-reset-token.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import type { JwtPayload } from './types/jwt-payload.type';

const refreshCookieName = 'refresh_token';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('create-company')
  createCompany(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCompanyDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.withRefreshCookie(
      response,
      this.authService.createCompany(user, dto),
    );
  }

  @Post('login')
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    return this.withRefreshCookie(response, this.authService.login(dto));
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('validate-reset-token')
  validateResetToken(@Body() dto: ValidateResetTokenDto) {
    return this.authService.validateResetToken(dto);
  }

  @Post('refresh')
  refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = request.cookies?.[refreshCookieName] as string | undefined;
    return this.withRefreshCookie(response, this.authService.refresh(refreshToken));
  }

  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.[refreshCookieName] as string | undefined;
    await this.authService.logout(refreshToken);
    this.clearRefreshCookie(response);
    return { message: 'Sesion cerrada correctamente' };
  }

  private async withRefreshCookie(
    response: Response,
    authResponsePromise: ReturnType<AuthService['login']>,
  ) {
    const authResponse = await authResponsePromise;
    this.setRefreshCookie(response, authResponse.refreshToken);

    const { refreshToken: _refreshToken, ...body } = authResponse;
    return body;
  }

  private setRefreshCookie(response: Response, refreshToken: string) {
    response.cookie(refreshCookieName, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/auth',
      maxAge: Number(process.env.REFRESH_TOKEN_MAX_AGE_MS ?? 604800000),
    });
  }

  private clearRefreshCookie(response: Response) {
    response.clearCookie(refreshCookieName, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/auth',
    });
  }
}
