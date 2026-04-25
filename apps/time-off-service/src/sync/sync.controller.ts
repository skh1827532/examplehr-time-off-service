import { Body, Controller, Post } from '@nestjs/common';
import { SyncService } from './sync.service';
import { HcmBalanceUpdateDto, HcmBatchSyncDto } from './dto';

@Controller()
export class SyncController {
  constructor(private readonly svc: SyncService) {}

  @Post('webhooks/hcm/balance-updated')
  webhook(@Body() body: HcmBalanceUpdateDto) {
    return this.svc.applyWebhook(body);
  }

  @Post('sync/hcm/batch')
  batch(@Body() body: HcmBatchSyncDto) {
    return this.svc.applyBatch(body);
  }
}
