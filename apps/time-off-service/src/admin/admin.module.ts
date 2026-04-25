import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { OutboxModule } from '../outbox/outbox.module';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [OutboxModule, SyncModule],
  controllers: [AdminController],
})
export class AdminModule {}
