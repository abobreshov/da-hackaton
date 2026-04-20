import { Global, Module } from '@nestjs/common';
import { RpcProxyService } from './rpc-proxy.service';

/**
 * Global module — exposes a single {@link RpcProxyService} to every feature
 * module in the BFF. The service is stateless, so one instance per process is
 * fine and the `@Global()` marker saves each consumer from re-importing.
 */
@Global()
@Module({
  providers: [RpcProxyService],
  exports: [RpcProxyService],
})
export class RpcProxyModule {}
