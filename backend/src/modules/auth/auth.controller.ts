import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Public } from '@common/decorators/public.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TwoFactorSetupGuard } from '@common/guards/two-factor-setup.guard';
import { Controller, Post, Body, HttpCode, HttpStatus, Ip, Headers, UseGuards, Get, Delete, Param, Req, Res } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';

import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { StepUpService } from './step-up.service';
import { LoginDto, RegisterDto, RefreshTokenDto, ForgotPasswordDto, ResetPasswordDto, VerifyEmailDto, ChangePasswordDto } from './dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactor: TwoFactorService,
    private readonly stepUp: StepUpService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Start Google login — redirects to Google\'s consent screen' })
  async googleLogin() {
    // Guard handles the redirect to Google; nothing to do here.
  }

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google login callback — issues tokens and redirects to the frontend' })
  async googleCallback(@Req() req: Request, @Res() res: Response, @Ip() ip: string, @Headers('user-agent') deviceInfo: string) {
    const user = req.user as any;
    const session = await this.authService.issueSessionForOAuthUser(user, ip, deviceInfo);
    const frontendUrl = this.config.get('app.frontendUrl', 'http://localhost:5173');
    // Tokens are passed via URL fragment (not query) so they never hit server
    // logs; the frontend route at /auth/callback reads window.location.hash.
    // `profileIncomplete` tells the frontend to send brand-new members to a
    // "join a gym" step instead of a dashboard that has no data to show yet.
    const incompleteFlag = user.profileIncomplete ? '&profileIncomplete=1' : '';
    res.redirect(`${frontendUrl}/auth/callback#accessToken=${session.accessToken}&refreshToken=${session.refreshToken}${incompleteFlag}`);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto, @Ip() ip: string, @Headers('user-agent') deviceInfo: string) {
    return this.authService.login(dto, ip, deviceInfo);
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register new user' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email using OTP sent at registration' })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Public()
  @Post('resend-otp')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend email verification OTP' })
  async resendOtp(@Body('email') email: string) {
    return this.authService.sendVerificationOtp(email);
  }

  @Post('verify-whatsapp')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify WhatsApp OTP — activates the account (final step for members; step two for gym owners after email)' })
  async verifyWhatsapp(@Body('userId') userId: string, @Body('otp') otp: string) {
    return this.authService.verifyWhatsappOtp(userId, otp);
  }

  @Post('resend-whatsapp-otp')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend the WhatsApp verification code' })
  async resendWhatsappOtp(@Body('userId') userId: string) {
    return this.authService.sendWhatsappVerificationOtp(userId);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout user' })
  async logout(
    @CurrentUser('userId') userId: string,
    @Body('refreshToken') token?: string,
    @Body('sessionId') sessionId?: string,
  ) {
    return this.authService.logout(userId, token, sessionId);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: "Change the logged-in user's own password" })
  async changePassword(@CurrentUser('userId') userId: string, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(userId, dto.currentPassword, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Get('sessions')
  @ApiOperation({ summary: 'List active devices/sessions for the current user' })
  async sessions(@CurrentUser('userId') userId: string) {
    return this.authService.listSessions(userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Revoke a specific device/session' })
  async revokeSession(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.authService.revokeSession(userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke all other devices/sessions (keep current one)' })
  async revokeOthers(@CurrentUser('userId') userId: string, @Body('currentSessionId') currentSessionId?: string) {
    return this.authService.revokeAllOtherSessions(userId, currentSessionId);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset OTP' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with OTP' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async me(@CurrentUser() user: any) {
    return { user };
  }

  // ---------- Two-factor authentication ----------

  @Public()
  @Post('2fa/verify-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete login for an account with 2FA enabled (or required, e.g. Super Admin)' })
  async verifyLoginTwoFactor(
    @Body('pendingToken') pendingToken: string,
    @Body('code') code: string,
    @Ip() ip: string,
    @Headers('user-agent') deviceInfo: string,
  ) {
    return this.authService.completeTwoFactorLogin(pendingToken, code, ip, deviceInfo);
  }

  @UseGuards(TwoFactorSetupGuard)
  @ApiBearerAuth('access-token')
  @Post('2fa/setup/begin')
  @ApiOperation({ summary: 'Start 2FA setup — returns a QR code to scan in an authenticator app' })
  async beginTwoFactorSetup(@CurrentUser() user: any) {
    return this.twoFactor.beginSetup(user.userId, user.email);
  }

  @UseGuards(TwoFactorSetupGuard)
  @ApiBearerAuth('access-token')
  @Post('2fa/setup/confirm')
  @ApiOperation({ summary: 'Confirm 2FA setup with a code from the authenticator app; returns one-time recovery codes' })
  async confirmTwoFactorSetup(@CurrentUser('userId') userId: string, @Body('code') code: string) {
    return this.twoFactor.confirmSetup(userId, code);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Post('2fa/disable')
  @ApiOperation({ summary: 'Disable 2FA (requires current password; not permitted for Super Admin accounts)' })
  async disableTwoFactor(@CurrentUser('userId') userId: string, @Body('password') password: string) {
    const verified = await this.authService.verifyPassword(userId, password);
    return this.twoFactor.disable(userId, verified);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Post('2fa/recovery-codes/regenerate')
  @ApiOperation({ summary: 'Invalidate old recovery codes and issue a fresh set' })
  async regenerateRecoveryCodes(@CurrentUser('userId') userId: string) {
    return this.twoFactor.regenerateRecoveryCodes(userId);
  }

  // ---------- Step-up re-authentication (for sensitive/destructive actions) ----------

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Post('step-up/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-verify password (+2FA if enabled) to get a short-lived token for a sensitive action' })
  async stepUpVerify(
    @CurrentUser('userId') userId: string,
    @Body('password') password: string,
    @Body('code') code?: string,
  ) {
    return this.stepUp.verify(userId, password, code);
  }
}
