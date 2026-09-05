import { CurrentUser, CurrentUserPayload } from '@common/decorators/current-user.decorator';
import { GymId } from '@common/decorators/gym-id.decorator';
import { AllocateMonthsDto } from './dto/allocate-months.dto';
import { Public } from '@common/decorators/public.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  Headers,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { UserRole, PaymentGateway, PaymentMethod } from '@prisma/client';
import { Request, Response } from 'express';

import { CreatePaymentDto } from './dto/create-payment.dto';
import { QueryPaymentDto } from './dto/query-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { VerifyRazorpayPaymentDto } from './dto/verify-payment.dto';
import { RazorpayGateway } from './gateways/razorpay.gateway';
import { StripeGateway } from './gateways/stripe.gateway';
import { PaymentsService } from './payments.service';
import { LoggerService } from '@shared/services/logger.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly service: PaymentsService,
    private readonly razorpay: RazorpayGateway,
    private readonly stripe: StripeGateway,
    private readonly logger: LoggerService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
  @ApiBearerAuth('access-token')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN, UserRole.RECEPTIONIST, UserRole.TRAINER)
  @ApiOperation({ summary: 'List payments (filterable, paginated)' })
  async findAll(@GymId() gymId: string, @Query() query: QueryPaymentDto) {
    return this.service.findAll(gymId, query);
  }

  @Get('summary')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
  @ApiBearerAuth('access-token')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Revenue summary for a date range' })
  async summary(@GymId() gymId: string, @Query('fromDate') fromDate?: string, @Query('toDate') toDate?: string) {
    return this.service.summary(gymId, fromDate, toDate);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: "Get the logged-in member's own payment history (paginated)" })
  async findMine(
    @GymId() gymId: string,
    @CurrentUser('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findMine(gymId, userId, Number(page) || 1, Number(limit) || 20);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get a payment by id — staff see any payment in the gym; members only their own' })
  async findOne(@Param('id') id: string, @GymId() gymId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.findOne(id, gymId, user);
  }

  @Get(':id/receipt')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Download the PDF receipt/invoice for a payment' })
  async downloadReceipt(@Param('id') id: string, @GymId() gymId: string, @CurrentUser() user: CurrentUserPayload, @Res() res: Response) {
    const buffer = await this.service.downloadReceipt(id, gymId, user);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename=receipt-${id}.pdf` });
    res.send(buffer);
  }

  @Post('me/pay')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
  @ApiBearerAuth('access-token')
  @Roles(UserRole.MEMBER)
  @ApiOperation({ summary: 'Member self-pay for one of their own memberships — amount is derived server-side, never trusted from the client' })
  async payForMyMembership(
    @GymId() gymId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: { membershipId: string; gateway: PaymentGateway; method: PaymentMethod },
  ) {
    return this.service.initiateSelfPay(gymId, userId, dto.membershipId, dto.gateway, dto.method);
  }

  @Get('me/payable-months')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
  @ApiBearerAuth('access-token')
  @Roles(UserRole.MEMBER)
  @ApiOperation({ summary: "List the logged-in member's payable/pending months for one of their own memberships" })
  async getPayableMonths(@GymId() gymId: string, @CurrentUser('userId') userId: string, @Query('membershipId') membershipId: string) {
    return this.service.getPayableMonths(gymId, userId, membershipId);
  }

  /* ---------------- Direct-to-owner UPI (no gateway needed) ---------------- */

  @Post('upi/link')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: "Get the gym owner's UPI deep-link + QR code for a given amount" })
  async getUpiLink(@GymId() gymId: string, @CurrentUser('userId') userId: string, @Body() dto: { membershipId: string; monthStarts: string[]; note?: string }) {
    return this.service.buildUpiPaymentLink(gymId, userId, dto.membershipId, dto.monthStarts, dto.note || 'Gym membership payment');
  }

  @Post('me/upi-claim')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
  @ApiBearerAuth('access-token')
  @Roles(UserRole.MEMBER)
  @ApiOperation({ summary: "Member reports they've paid via UPI directly to the owner — creates a pending claim for staff to verify" })
  async submitUpiClaim(
    @GymId() gymId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: { membershipId: string; monthStarts: string[]; utrReference: string },
  ) {
    return this.service.submitUpiClaim(gymId, userId, dto.membershipId, dto.monthStarts, dto.utrReference);
  }

  @Get('upi/pending')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
  @ApiBearerAuth('access-token')
  @Roles(UserRole.GYM_OWNER, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: 'List UPI payment claims awaiting owner/staff verification' })
  async listPendingUpi(@GymId() gymId: string) {
    return this.service.listPendingUpiClaims(gymId);
  }

  @Post('upi/:id/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
  @ApiBearerAuth('access-token')
  @Roles(UserRole.GYM_OWNER, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: 'Confirm a UPI claim after checking it actually landed in the bank/UPI app' })
  async confirmUpi(@Param('id') id: string, @GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.confirmUpiClaim(id, gymId, userId);
  }

  @Post('upi/:id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
  @ApiBearerAuth('access-token')
  @Roles(UserRole.GYM_OWNER, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: "Reject a UPI claim that doesn't check out" })
  async rejectUpi(@Param('id') id: string, @GymId() gymId: string, @CurrentUser('userId') userId: string, @Body('reason') reason?: string) {
    return this.service.rejectUpiClaim(id, gymId, userId, reason);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
  @ApiBearerAuth('access-token')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: 'Initiate a payment (cash is completed instantly, online creates a gateway order)' })
  async initiate(@Body() dto: CreatePaymentDto, @GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.initiate(dto, gymId, userId);
  }

  @Post('razorpay/verify')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Verify Razorpay checkout signature and finalize the payment' })
  async verifyRazorpay(@Body() dto: VerifyRazorpayPaymentDto, @GymId() gymId: string) {
    return this.service.verifyRazorpay(dto, gymId);
  }

  @Post(':id/refund')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
  @ApiBearerAuth('access-token')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Refund a completed payment (full or partial)' })
  async refund(
    @Param('id') id: string,
    @Body() dto: RefundPaymentDto,
    @GymId() gymId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.refund(id, gymId, dto, userId);
  }

  // ---- Gateway webhooks: unauthenticated, verified via HMAC signature instead of JWT ----

  @Post('webhooks/razorpay')
  @Public()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async razorpayWebhook(@Req() req: Request, @Headers('x-razorpay-signature') signature: string) {
    // SECURITY: verification MUST run against the exact bytes Razorpay
    // signed. Re-serializing the parsed JSON body (`JSON.stringify(req.body)`)
    // is not guaranteed to byte-match the original (key order, number
    // formatting, whitespace) — using it as a fallback either breaks
    // legitimate webhooks silently or, worse, verifies against a
    // reconstruction that isn't actually what was signed. Fail closed
    // instead: if rawBody wasn't captured, we cannot verify, full stop.
    const raw = (req as any).rawBody?.toString('utf8');
    if (!raw) {
      this.logger.error('Razorpay webhook received with no rawBody captured — check main.ts rawBody:true and body-parser config', undefined, 'PaymentsController');
      return { received: false };
    }
    if (!this.razorpay.verifyWebhookSignature(raw, signature)) {
      return { received: false };
    }
    const event = req.body;
    const entity = event?.payload?.payment?.entity;
    // Razorpay doesn't guarantee a top-level unique event id on every
    // payload shape, but `${event}:${payment.id}` is unique per real
    // occurrence (a given payment only transitions captured/failed once
    // each) and is what we can rely on across all their webhook versions.
    const eventId = entity ? `${event.event}:${entity.id}` : `${event.event}:${JSON.stringify(event.payload)}`;
    const isNew = await this.service.recordWebhookEventOnce('razorpay', eventId, event.event, event);
    if (!isNew) return { received: true }; // already processed — ack without reprocessing

    if (event.event === 'payment.captured' && entity) {
      await this.service.markCompletedFromWebhook(entity.order_id, entity.id, event);
    } else if (event.event === 'payment.failed' && entity) {
      await this.service.markFailedFromWebhook(entity.order_id, event);
    }
    return { received: true };
  }

  @Post('webhooks/stripe')
  @Public()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async stripeWebhook(@Req() req: Request, @Headers('stripe-signature') signature: string) {
    const raw = (req as any).rawBody?.toString('utf8');
    if (!raw) {
      this.logger.error('Stripe webhook received with no rawBody captured — check main.ts rawBody:true and body-parser config', undefined, 'PaymentsController');
      return { received: false };
    }
    if (!this.stripe.verifyWebhookSignature(raw, signature)) {
      return { received: false };
    }
    const event = req.body;
    // Stripe always includes a globally-unique `id` (evt_...) on every event.
    const isNew = await this.service.recordWebhookEventOnce('stripe', event.id, event.type, event);
    if (!isNew) return { received: true };

    const intent = event?.data?.object;
    if (event.type === 'payment_intent.succeeded' && intent) {
      await this.service.markCompletedFromWebhook(intent.id, intent.id, event);
    } else if (event.type === 'payment_intent.payment_failed' && intent) {
      await this.service.markFailedFromWebhook(intent.id, event);
    }
    return { received: true };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('GYM_OWNER', 'RECEPTIONIST')
  @Post('manual-with-months')
  async recordManualWithMonths(
    @GymId() gymId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: AllocateMonthsDto,
  ) {
    return this.service.recordManualPaymentWithMonths(gymId, user.userId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('GYM_OWNER', 'RECEPTIONIST')
  @Post(':id/verify-manual')
  async verifyManual(
    @GymId() gymId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body('approve') approve: boolean,
  ) {
    return this.service.verifyManualPayment(gymId, id, user.userId, approve);
  }
}