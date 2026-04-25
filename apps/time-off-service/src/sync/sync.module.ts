import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HcmSyncLog } from './hcm-sync-log.entity';
import { SyncLogService } from './sync-log.service';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { BalancesModule } from '../balances/balances.module';
import { TimeOffRequestsModule } from '../time-off-requests/time-off-requests.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([HcmSyncLog]),
    BalancesModule,
    forwardRef(() => TimeOffRequestsModule),
  ],
  providers: [SyncLogService, SyncService],
  controllers: [SyncController],
  exports: [SyncLogService, SyncService],
})
export class SyncModule {}
