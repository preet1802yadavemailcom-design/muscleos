import { Public } from '@common/decorators/public.decorator';
import { Body, Controller, Headers, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CheckinService } from './checkin.service';
import {
  ScanCheckinDto, IdentifyMemberDto, SendOtpDto, VerifyOtpDto,
  RegisterMemberDto, CheckinActionDto,
} from './dto';

/**
 * Public kiosk check-in flow — no authentication required by design. The gym
 * QR is a static, never-changing code that only identifies the gym; every
 * attendance write is validated server-side (gym active, member status,
 * per-day duplicate prevention, OTP-verified session tokens).
 */
@ApiTags('Public Check-in (Kiosk)')
@Controller('public/checkin')
export class CheckinController {
  constructor(private readonly service: CheckinService) {}

  @Post('scan')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Scan the gym entrance QR → returns gym info + short-lived kiosk token' })
  async scan(@Body() dto: ScanCheckinDto) {
    return this.service.scan(dto);
  }

  @Post('identify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 8, ttl: 60000 } })
  @ApiOperation({ summary: 'Identify a member by mobile → returns profile + photo (for staff to visually confirm) + a session token. No OTP.' })
  async identify(@Body() dto: IdentifyMemberDto, @Headers('x-checkin-session') sessionToken?: string) {
    return this.service.identify(dto, sessionToken);
  }

  /** @deprecated OTP flow removed — update the kiosk app to use /identify only. */
  @Post('otp/send')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '[REMOVED] OTP check-in has been replaced by photo-confirm identification' })
  async sendOtp(@Body() dto: SendOtpDto) {
    return this.service.sendOtp(dto);
  }

  /** @deprecated OTP flow removed — update the kiosk app to use /identify only. */
  @Post('otp/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[REMOVED] OTP check-in has been replaced by photo-confirm identification' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.service.verifyOtp(dto);
  }

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create the member profile (pending-approval membership) and auto check-in' })
  async register(
    @Body() dto: RegisterMemberDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ) {
    return this.service.register(dto, ip, ua);
  }

  @Post('check-in')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Check in for today (rejects duplicates + already-completed days)' })
  async checkIn(@Body() dto: CheckinActionDto) {
    return this.service.checkIn(dto);
  }

  @Post('check-out')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check out today\'s open session' })
  async checkOut(@Body() dto: CheckinActionDto) {
    return this.service.checkOut(dto);
  }
}
