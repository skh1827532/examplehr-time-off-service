import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { OutboxService } from '../outbox/outbox.service';
import { OutboxWorker } from '../outbox/outbox.worker';
import { SyncLogService } from '../sync/sync-log.service';
import { SyncService } from '../sync/sync.service';
import { HcmClient } from '../hcm/hcm.client';
import { DomainErrors } from '../common/domain-errors';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly outbox: OutboxService,
    private readonly worker: OutboxWorker,
    private readonly syncLog: SyncLogService,
    private readonly sync: SyncService,
    private readonly hcm: HcmClient,
  ) {}

  @Get('sync-log')
  syncLogs(@Query('kind') kind?: string, @Query('result') result?: string) {
    return this.syncLog.list({
      kind: kind as never,
      result: result as never,
    });
  }

  @Get('outbox')
  outboxList(@Query('status') status?: string) {
    return this.outbox.list(status);
  }

  @Post('outbox/:id/replay')
  @HttpCode(HttpStatus.OK)
  async replay(@Param('id') id: string) {
    const ev = await this.outbox.forceReplay(id);
    if (!ev) throw DomainErrors.notFound(`outbox event ${id}`);
    return ev;
  }

  @Post('outbox/drain')
  @HttpCode(HttpStatus.OK)
  drain() {
    return this.worker.drain();
  }

  @Post('sync/full-pull')
  @HttpCode(HttpStatus.OK)
  async fullPull() {
    const res = await this.hcm.getBatch();
    if (res.status !== 'OK') {
      throw DomainErrors.hcmUnavailable(res.status === 'UNAVAILABLE' ? res.cause : 'no batch');
    }
    return this.sync.applyBatch(res.data);
  }
}
