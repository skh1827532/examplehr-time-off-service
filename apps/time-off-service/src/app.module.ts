import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { Employee } from './employees/employee.entity';
import { Location } from './locations/location.entity';
import { Balance } from './balances/balance.entity';
import { TimeOffRequest } from './time-off-requests/time-off-request.entity';
import { OutboxEvent } from './outbox/outbox-event.entity';
import { HcmSyncLog } from './sync/hcm-sync-log.entity';
import { IdempotencyKey } from './common/idempotency-key.entity';

import { EmployeesModule } from './employees/employees.module';
import { LocationsModule } from './locations/locations.module';
import { BalancesModule } from './balances/balances.module';
import { TimeOffRequestsModule } from './time-off-requests/time-off-requests.module';
import { HcmModule } from './hcm/hcm.module';
import { OutboxModule } from './outbox/outbox.module';
import { SyncModule } from './sync/sync.module';
import { AdminModule } from './admin/admin.module';
import { CommonModule } from './common/common.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'better-sqlite3' as const,
        database: process.env.DATABASE_PATH ?? ':memory:',
        entities: [
          Employee,
          Location,
          Balance,
          TimeOffRequest,
          OutboxEvent,
          HcmSyncLog,
          IdempotencyKey,
        ],
        synchronize: true,
        logging: false,
      }),
    }),
    ScheduleModule.forRoot(),
    CommonModule,
    EmployeesModule,
    LocationsModule,
    BalancesModule,
    TimeOffRequestsModule,
    HcmModule,
    OutboxModule,
    SyncModule,
    AdminModule,
  ],
})
export class AppModule {}
