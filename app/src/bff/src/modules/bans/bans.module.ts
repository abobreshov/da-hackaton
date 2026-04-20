import { Module } from '@nestjs/common';
import { BansController } from './bans.controller';
import { BansService } from './bans.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [BansController],
  providers: [BansService],
})
export class BansModule {}
