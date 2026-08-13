import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PlanCodigo } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PdfConcurrencyService } from '../../common/pdf/pdf-concurrency.service';
import { rateLimits } from '../../common/rate-limits';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { UpdatePlanPricingDto } from '../plans/dto/update-plan-pricing.dto';
import { UpdatePlanLimitsDto } from '../plans/dto/update-plan-limits.dto';
import { UpdateOveragePricingDto } from '../plans/dto/update-overage-pricing.dto';
import { PlansService } from '../plans/plans.service';
import { FindPlatformAuditQueryDto } from './dto/find-platform-audit-query.dto';
import { FindPlatformCompaniesQueryDto } from './dto/find-platform-companies-query.dto';
import {
  CancelSubscriptionSaleDto,
  CreateSubscriptionSaleDto,
  FindSubscriptionSalesQueryDto,
} from './dto/platform-subscription-sales.dto';
import {
  CreatePlatformUserDto,
  FindPlatformUsersQueryDto,
  UpdatePlatformUserStatusDto,
} from './dto/platform-admin-users.dto';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformSubscriptionsService } from './platform-subscriptions.service';
import { PlatformOveragesService } from './platform-overages.service';
import { PlatformDashboardQueryDto } from './dto/platform-dashboard.dto';
import {
  CloseOverageDto,
  FindOveragesQueryDto,
  PayOverageDto,
  UpdateCompanyExtraLimitsDto,
} from './dto/platform-overages.dto';
import {
  CloseAffiliateSettlementDto,
  FindAffiliateCommissionsQueryDto,
  FindAffiliateCompaniesQueryDto,
  FindAffiliatesQueryDto,
  PayAffiliateSettlementDto,
  SaveAffiliateDto,
  ValidateAffiliateCodeQueryDto,
} from './dto/platform-affiliates.dto';
import { PlatformAffiliatesService } from './platform-affiliates.service';

@UseGuards(PlatformAdminGuard)
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(
    private readonly platformAdminService: PlatformAdminService,
    private readonly platformSubscriptionsService: PlatformSubscriptionsService,
    private readonly plansService: PlansService,
    private readonly platformOveragesService: PlatformOveragesService,
    private readonly platformAffiliatesService: PlatformAffiliatesService,
    private readonly pdfConcurrency: PdfConcurrencyService,
  ) {}

  @Get('affiliates')
  findAffiliates(@Query() query: FindAffiliatesQueryDto) {
    return this.platformAffiliatesService.findAll(query);
  }

  @Post('affiliates')
  createAffiliate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SaveAffiliateDto,
  ) {
    return this.platformAffiliatesService.create(user, dto);
  }

  @Get('affiliates/companies')
  findAffiliateCompanies(@Query() query: FindAffiliateCompaniesQueryDto) {
    return this.platformAffiliatesService.findCompanies(query);
  }

  @Get('affiliates/commissions')
  findAffiliateCommissions(@Query() query: FindAffiliateCommissionsQueryDto) {
    return this.platformAffiliatesService.findCommissions(query);
  }

  @Get('affiliates/settlements')
  findAffiliateSettlements(@Query() query: FindAffiliateCommissionsQueryDto) {
    return this.platformAffiliatesService.findSettlements(query);
  }

  @Get('affiliates/validate')
  validateAffiliateCode(@Query() query: ValidateAffiliateCodeQueryDto) {
    return this.platformAffiliatesService.validateCode(query);
  }

  @Post('affiliates/settlements/close')
  closeAffiliateSettlement(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CloseAffiliateSettlementDto,
  ) {
    return this.platformAffiliatesService.closeSettlement(user, dto);
  }

  @Post('affiliates/settlements/:id/pay')
  payAffiliateSettlement(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: PayAffiliateSettlementDto,
  ) {
    return this.platformAffiliatesService.paySettlement(user, id, dto);
  }

  @Get('affiliates/settlements/:id/pdf')
  @Throttle(rateLimits.pdf)
  async downloadAffiliateSettlement(
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const file = await this.pdfConcurrency.run(() =>
      this.platformAffiliatesService.generateSettlementPdf(id),
    );
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );
    response.send(file.buffer);
  }

  @Get('affiliates/:id')
  findAffiliate(@Param('id') id: string) {
    return this.platformAffiliatesService.findOne(id);
  }

  @Patch('affiliates/:id')
  updateAffiliate(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SaveAffiliateDto,
  ) {
    return this.platformAffiliatesService.update(user, id, dto);
  }

  @Get('dashboard')
  @Throttle(rateLimits.dashboard)
  getDashboard(@Query() query: PlatformDashboardQueryDto) {
    return this.platformAdminService.getDashboard(new Date(), query.dateFilter);
  }

  @Get('companies')
  findCompanies(@Query() query: FindPlatformCompaniesQueryDto) {
    return this.platformAdminService.findCompanies(query);
  }

  @Get('companies/usage')
  findCompanyUsage(@Query() query: FindPlatformCompaniesQueryDto) {
    return this.platformAdminService.findCompanyUsage(query);
  }

  @Get('companies/:id')
  findCompany(@Param('id') id: string) {
    return this.platformAdminService.findCompany(id);
  }

  @Get('companies/:id/limits')
  getCompanyLimits(@Param('id') id: string) {
    return this.platformOveragesService.getCompanyLimits(id);
  }

  @Patch('companies/:id/limits')
  updateCompanyLimits(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCompanyExtraLimitsDto,
  ) {
    return this.platformOveragesService.updateCompanyLimits(user, id, dto);
  }

  @Get('users')
  findUsers(@Query() query: FindPlatformUsersQueryDto) {
    return this.platformAdminService.findUsers(query);
  }

  @Post('users')
  createUser(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePlatformUserDto,
  ) {
    return this.platformAdminService.createUser(user, dto);
  }

  @Patch('users/:id/status')
  updateUserStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePlatformUserStatusDto,
  ) {
    return this.platformAdminService.updateUserStatus(user, id, dto);
  }

  @Get('plans/pricing')
  findPlanPricing() {
    return this.plansService.getAdminPricingCatalog();
  }

  @Patch('plans/:code/pricing')
  updatePlanPricing(
    @CurrentUser() user: JwtPayload,
    @Param('code', new ParseEnumPipe(PlanCodigo)) code: PlanCodigo,
    @Body() dto: UpdatePlanPricingDto,
  ) {
    return this.plansService.updatePricing(user, code, dto);
  }

  @Patch('plans/:code/limits')
  updatePlanLimits(
    @CurrentUser() user: JwtPayload,
    @Param('code', new ParseEnumPipe(PlanCodigo)) code: PlanCodigo,
    @Body() dto: UpdatePlanLimitsDto,
  ) {
    return this.plansService.updateLimits(user, code, dto);
  }

  @Get('plans/overage-pricing')
  getOveragePricing() {
    return this.plansService.getOveragePricing();
  }

  @Patch('plans/overage-pricing')
  updateOveragePricing(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateOveragePricingDto,
  ) {
    return this.plansService.updateOveragePricing(user, dto);
  }

  @Get('subscriptions/overages')
  findOverages(@Query() query: FindOveragesQueryDto) {
    return this.platformOveragesService.findOverages(query);
  }

  @Post('subscriptions/overages/close')
  closeOverage(@CurrentUser() user: JwtPayload, @Body() dto: CloseOverageDto) {
    return this.platformOveragesService.close(user, dto);
  }

  @Post('subscriptions/overages/:id/pay')
  payOverage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: PayOverageDto,
  ) {
    return this.platformOveragesService.pay(user, id, dto);
  }

  @Get('subscriptions/sales')
  findSubscriptionSales(@Query() query: FindSubscriptionSalesQueryDto) {
    return this.platformSubscriptionsService.findSales(query);
  }

  @Post('subscriptions/sales')
  createSubscriptionSale(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSubscriptionSaleDto,
  ) {
    return this.platformSubscriptionsService.createSale(user, dto);
  }

  @Post('subscriptions/sales/:id/cancel')
  cancelSubscriptionSale(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CancelSubscriptionSaleDto,
  ) {
    return this.platformSubscriptionsService.cancelSale(user, id, dto);
  }

  @Get('audit/plan-changes')
  findPlanChanges(@Query() query: FindPlatformAuditQueryDto) {
    return this.platformAdminService.findPlanChanges(query);
  }

  @Get('audit/activity')
  findActivity(@Query() query: FindPlatformAuditQueryDto) {
    return this.platformAdminService.findActivity(query);
  }
}
