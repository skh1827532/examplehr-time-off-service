import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeOffRequest } from './time-off-request.entity';
import { TimeOffRequestsService } from './time-off-requests.service';
import { TimeOffRequestsController } from './time-off-requests.controller';
import { BalancesModule } from '../balances/balances.module';
import { LocationsModule } from '../locations/locations.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeOffRequest]),
    BalancesModule,
    LocationsModule,
    forwardRef(() => OutboxModule),
  ],
  providers: [TimeOffRequestsService],
  controllers: [TimeOffRequestsController],
  exports: [TimeOffRequestsService],
})
export class TimeOffRequestsModule {}
