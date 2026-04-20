import { Body, Controller, Delete, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerLoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { PasswordChangeDto } from './dto/password-change.dto';
import { RefreshDto } from '../admin/dto/refresh.dto';
import { CustomerJwtGuard } from '../shared/customer-jwt.guard';
import type { AccessTokenClaims } from '../shared/jwt.service';
import { parseSub } from '@app/contracts';

@Controller('auth/customer')
export class CustomerAuthController {
  constructor(private readonly service: CustomerAuthService) {}

  @Post('login')
  login(@Body() dto: CustomerLoginDto) {
    return this.service.login(dto);
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.service.register(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.service.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto) {
    await this.service.logout(dto.refreshToken);
  }

  @Post('validate-token')
  validateToken(@Headers('authorization') auth: string) {
    const token = auth?.replace('Bearer ', '');
    return this.service.validateToken(token);
  }

  @Post('password-reset/request')
  @HttpCode(204)
  async passwordResetRequest(@Body() dto: PasswordResetRequestDto) {
    await this.service.passwordResetRequest(dto);
  }

  @Post('password-reset/confirm')
  @HttpCode(204)
  async passwordResetConfirm(@Body() dto: PasswordResetConfirmDto) {
    await this.service.passwordResetConfirm(dto);
  }

  @Post('password-change')
  @HttpCode(204)
  @UseGuards(CustomerJwtGuard)
  async passwordChange(@Body() dto: PasswordChangeDto, @Req() req: { user?: AccessTokenClaims }) {
    if (!req.user?.sub) throw new Error('missing user context');
    const userId = parseSub(req.user.sub).numericId;
    await this.service.passwordChange({ ...dto, userId });
  }

  @Delete('account')
  @HttpCode(204)
  @UseGuards(CustomerJwtGuard)
  async deleteAccount(@Req() req: { user?: AccessTokenClaims }) {
    if (!req.user?.sub) throw new Error('missing user context');
    const userId = parseSub(req.user.sub).numericId;
    await this.service.deleteAccount({ userId });
  }
}
