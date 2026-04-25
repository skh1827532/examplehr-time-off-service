import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { HcmStore, HcmBalance } from '../common/hcm-store';
import { FailureMode, FailureModeService } from '../common/failure-mode.service';

interface SeedBalanceDto {
  employeeId: string;
  locationId: string;
  balanceDays: number;
  hcmUpdatedAt?: string;
}

interface SetFailureModeDto {
  mode: FailureMode;
  latencyMs?: number;
}

@Controller('admin')
export class AdminController {
  constructor(
    private readonly store: HcmStore,
    private readonly failure: FailureModeService,
  ) {}

  @Post('seed/balances')
  seed(@Body() body: { balances: SeedBalanceDto[] }): { count: number } {
    for (const b of body.balances) {
      this.store.upsertBalance({
        employeeId: b.employeeId,
        locationId: b.locationId,
        balanceDays: b.balanceDays,
        hcmUpdatedAt: b.hcmUpdatedAt ?? new Date().toISOString(),
      });
    }
    return { count: body.balances.length };
  }

  @Post('balances/mutate')
  mutate(@Body() body: SeedBalanceDto): HcmBalance {
    return this.store.upsertBalance({
      employeeId: body.employeeId,
      locationId: body.locationId,
      balanceDays: body.balanceDays,
      hcmUpdatedAt: body.hcmUpdatedAt ?? new Date().toISOString(),
    });
  }

  @Post('failure-mode')
  setFailureMode(@Body() body: SetFailureModeDto): { mode: FailureMode; latencyMs: number } {
    this.failure.setMode(body.mode);
    if (typeof body.latencyMs === 'number') {
      this.failure.setLatencyMs(body.latencyMs);
    }
    return { mode: this.failure.getMode(), latencyMs: this.failure.getLatencyMs() };
  }

  @Get('failure-mode')
  getFailureMode(): { mode: FailureMode; latencyMs: number } {
    return { mode: this.failure.getMode(), latencyMs: this.failure.getLatencyMs() };
  }

  @Delete('reset')
  reset(): { ok: true } {
    this.store.reset();
    this.failure.reset();
    return { ok: true };
  }
}
