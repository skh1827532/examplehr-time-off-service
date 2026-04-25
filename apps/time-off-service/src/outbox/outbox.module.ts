import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxService } from './outbox.service';
import { OutboxWorker } from './outbox.worker';
import { TimeOffRequestsModule } from '../time-off-requests/time-off-requests.module';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEvent]),
    forwardRef(() => TimeOffRequestsModule),
    forwardRef(() => SyncModule),
  ],
  providers: [OutboxService, OutboxWorker],
  exports: [OutboxService, OutboxWorker],
})
export class OutboxModule {}
