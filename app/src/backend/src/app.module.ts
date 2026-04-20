import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { AuthClientModule } from './common/auth-client.module';
import { UsersModule } from './modules/users/users.module';
import { HealthController } from './modules/health/health.controller';
import { SystemKeyRpcGuard } from './common/rpc-transport';

@Module({
  imports: [DatabaseModule, AuthClientModule, UsersModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: SystemKeyRpcGuard }],
})
export class AppModule {}
