import { Global, Module } from '@nestjs/common';
import { HcmStore } from './hcm-store';
import { FailureModeService } from './failure-mode.service';

@Global()
@Module({
  providers: [HcmStore, FailureModeService],
  exports: [HcmStore, FailureModeService],
})
export class SharedModule {}
