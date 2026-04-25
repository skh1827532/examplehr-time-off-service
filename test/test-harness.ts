import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { AppModule as TimeOffAppModule } from '../apps/time-off-service/src/app.module';
import { AppModule as MockHcmAppModule } from '../apps/mock-hcm/src/app.module';
import { HttpExceptionFilter } from '../apps/time-off-service/src/common/http-exception.filter';
import { HcmClient } from '../apps/time-off-service/src/hcm/hcm.client';
import { OutboxWorker } from '../apps/time-off-service/src/outbox/outbox.worker';
import { EmployeesService } from '../apps/time-off-service/src/employees/employees.service';
import { LocationsService } from '../apps/time-off-service/src/locations/locations.service';
import { BalancesService } from '../apps/time-off-service/src/balances/balances.service';

export interface Harness {
  timeOff: INestApplication;
  mockHcm: INestApplication;
  timeOffUrl: string;
  mockHcmUrl: string;
  worker: OutboxWorker;
  hcm: HcmClient;
  close: () => Promise<void>;
  seed: {
    employee: (employeeId: string, name?: string, defaultLocationId?: string) => Promise<void>;
    location: (locationId: string, name?: string, country?: string) => Promise<void>;
    /** Seed both HCM and local cache with the same balance. */
    balance: (employeeId: string, locationId: string, days: number) => Promise<void>;
    /** Seed only HCM (so we can test webhook/batch sync). */
    hcmBalance: (employeeId: string, locationId: string, days: number) => Promise<void>;
  };
}

export async function createHarness(): Promise<Harness> {
  // Stop the outbox autostart in tests; tests drain explicitly.
  process.env.OUTBOX_AUTO_START = 'false';
  process.env.NODE_ENV = 'test';

  // Boot Mock HCM on a random port.
  const mockHcmModuleRef = await Test.createTestingModule({
    imports: [MockHcmAppModule],
  }).compile();
  const mockHcm = mockHcmModuleRef.createNestApplication({ logger: false });
  mockHcm.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await mockHcm.listen(0);
  const mockHcmPort = (mockHcm.getHttpServer().address() as AddressInfo).port;
  const mockHcmUrl = `http://127.0.0.1:${mockHcmPort}`;

  process.env.HCM_BASE_URL = mockHcmUrl;
  process.env.HCM_REQUEST_TIMEOUT_MS = '2000';
  process.env.HCM_MAX_RETRIES = '0';
  // Use shared in-memory DB connection — typeorm's better-sqlite3 supports `:memory:`.
  process.env.DATABASE_PATH = ':memory:';

  const timeOffModuleRef = await Test.createTestingModule({
    imports: [TimeOffAppModule],
  }).compile();
  const timeOff = timeOffModuleRef.createNestApplication({ logger: false });
  timeOff.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  timeOff.useGlobalFilters(new HttpExceptionFilter());
  await timeOff.listen(0);
  const timeOffPort = (timeOff.getHttpServer().address() as AddressInfo).port;
  const timeOffUrl = `http://127.0.0.1:${timeOffPort}`;

  const hcm = timeOff.get(HcmClient);
  hcm.configure({ baseUrl: mockHcmUrl, timeoutMs: 2000, maxRetries: 0 });
  hcm.resetCircuit();

  const worker = timeOff.get(OutboxWorker);
  worker.stop();

  const employees = timeOff.get(EmployeesService);
  const locations = timeOff.get(LocationsService);
  const balances = timeOff.get(BalancesService);

  return {
    timeOff,
    mockHcm,
    timeOffUrl,
    mockHcmUrl,
    worker,
    hcm,
    seed: {
      async employee(employeeId, name = `Employee ${employeeId}`, defaultLocationId?) {
        await employees.upsert({
          employeeId,
          name,
          defaultLocationId: defaultLocationId ?? null,
        });
      },
      async location(locationId, name = `Location ${locationId}`, country = 'US') {
        await locations.upsert({ locationId, name, country } as never);
      },
      async balance(employeeId, locationId, days) {
        await fetch(`${mockHcmUrl}/admin/seed/balances`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ balances: [{ employeeId, locationId, balanceDays: days }] }),
        });
        await balances.applyHcmBalance({
          employeeId,
          locationId,
          balanceDays: days,
          hcmUpdatedAt: new Date().toISOString(),
        });
      },
      async hcmBalance(employeeId, locationId, days) {
        await fetch(`${mockHcmUrl}/admin/seed/balances`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ balances: [{ employeeId, locationId, balanceDays: days }] }),
        });
      },
    },
    async close() {
      worker.stop();
      await timeOff.close();
      await mockHcm.close();
    },
  };
}
