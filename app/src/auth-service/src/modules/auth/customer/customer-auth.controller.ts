import { Controller, Post, Body, HttpCode, Headers } from '@nestjs/common';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerLoginDto } from './dto/login.dto';
import { RefreshDto } from '../admin/dto/refresh.dto';

@Controller('auth/customer')
export class CustomerAuthController {
  constructor(private readonly service: CustomerAuthService) {}

  @Post('login')
  login(@Body() dto: CustomerLoginDto) {
    return this.service.login(dto);
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
}
