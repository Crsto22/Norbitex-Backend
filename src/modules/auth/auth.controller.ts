import { Body, Controller, Get, Patch, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { rateLimits } from '../../common/rate-limits';
import { AuthService } from './auth.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { ChangeMyPasswordDto } from './dto/change-my-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { ValidateResetTokenDto } from './dto/validate-reset-token.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import type { JwtPayload } from './types/jwt-payload.type';

const refreshCookieName = 'refresh_token';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @Throttle(rateLimits.auth)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('verify-email')
  @Throttle(rateLimits.auth)
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.me(user);
  }
  @Patch('me')
  updateMe(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateMeDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.withRefreshCookie(
      response,
      this.authService.updateMe(user, dto),
    );
  }
  @Patch('me/password')
  changeMyPassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangeMyPasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.withRefreshCookie(
      response,
      this.authService.changeMyPassword(user, dto),
    );
  }
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

  @Public()
  @Post('login')
  @Throttle(rateLimits.auth)
  login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.withRefreshCookie(
      response,
      this.authService.login(dto, request.ip),
    );
  }

  @Public()
  @Post('forgot-password')
  @Throttle(rateLimits.auth)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  @Throttle(rateLimits.auth)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Public()
  @Post('validate-reset-token')
  @Throttle(rateLimits.auth)
  validateResetToken(@Body() dto: ValidateResetTokenDto) {
    return this.authService.validateResetToken(dto);
  }

  @Public()
  @Post('refresh')
  @Throttle(rateLimits.auth)
  refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.[refreshCookieName] as
      | string
      | undefined;
    return this.withRefreshCookie(
      response,
      this.authService.refresh(refreshToken),
    );
  }

  @Public()
  @Post('logout')
  @Throttle(rateLimits.auth)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.[refreshCookieName] as
      | string
      | undefined;
    await this.authService.logout(refreshToken);
    this.clearRefreshCookie(response);
    return { message: 'Sesion cerrada correctamente' };
  }

  private async withRefreshCookie(
    response: Response,
    authResponsePromise: ReturnType<AuthService['login']>,
  ) {
    const authResponse = await authResponsePromise;
    if (authResponse.refreshToken) {
      this.setRefreshCookie(response, authResponse.refreshToken);
    }

    const { refreshToken, ...body } = authResponse;
    void refreshToken;
    return body;
  }

  private setRefreshCookie(response: Response, refreshToken: string) {
    const useSecureCookie = this.useSecureRefreshCookie();

    response.cookie(refreshCookieName, refreshToken, {
      httpOnly: true,
      secure: useSecureCookie,
      sameSite: useSecureCookie ? 'none' : 'lax',
      path: '/auth',
      maxAge: Number(
        this.configService.get<string>('REFRESH_TOKEN_MAX_AGE_MS') ?? 604800000,
      ),
    });
  }

  private clearRefreshCookie(response: Response) {
    const useSecureCookie = this.useSecureRefreshCookie();

    response.clearCookie(refreshCookieName, {
      httpOnly: true,
      secure: useSecureCookie,
      sameSite: useSecureCookie ? 'none' : 'lax',
      path: '/auth',
    });
  }

  private useSecureRefreshCookie() {
    return (
      this.configService.get<string>('NODE_ENV') === 'production' ||
      this.configService.get<string>('FRONTEND_URL')?.startsWith('https://') ||
      this.configService.get<string>('CORS_ORIGINS')?.includes('https://')
    );
  }
}
