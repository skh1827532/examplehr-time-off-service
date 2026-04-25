import request from 'supertest';
import { createHarness, Harness } from '../test-harness';
import { EmployeesService } from '../../apps/time-off-service/src/employees/employees.service';
import { LocationsService } from '../../apps/time-off-service/src/locations/locations.service';

describe('Employees & Locations services', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
  });

  afterEach(() => h.close());

  it('upserts and lists employees via REST', async () => {
    await request(h.timeOff.getHttpServer())
      .post('/employees')
      .send({ employeeId: 'E1', name: 'Alice', defaultLocationId: 'LOC' })
      .expect(201);
    const list = await request(h.timeOff.getHttpServer()).get('/employees').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe('Alice');
  });

  it('updates an existing employee on second upsert', async () => {
    await request(h.timeOff.getHttpServer())
      .post('/employees')
      .send({ employeeId: 'E1', name: 'Alice' });
    await request(h.timeOff.getHttpServer())
      .post('/employees')
      .send({ employeeId: 'E1', name: 'Alice Renamed' });
    const single = await request(h.timeOff.getHttpServer()).get('/employees/E1').expect(200);
    expect(single.body.name).toBe('Alice Renamed');
  });

  it('returns 404 for unknown employee', async () => {
    const res = await request(h.timeOff.getHttpServer()).get('/employees/GHOST');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('UNKNOWN_EMPLOYEE');
  });

  it('upserts and lists locations via REST', async () => {
    await request(h.timeOff.getHttpServer())
      .post('/locations')
      .send({ locationId: 'L1', name: 'NYC', country: 'US' })
      .expect(201);
    const list = await request(h.timeOff.getHttpServer()).get('/locations').expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('LocationsService.exists returns false for unknown', async () => {
    const svc = h.timeOff.get(LocationsService);
    expect(await svc.exists('GHOST')).toBe(false);
  });

  it('EmployeesService.list returns all', async () => {
    const svc = h.timeOff.get(EmployeesService);
    await svc.upsert({ employeeId: 'E1', name: 'A', defaultLocationId: null });
    await svc.upsert({ employeeId: 'E2', name: 'B', defaultLocationId: null });
    expect(await svc.list()).toHaveLength(2);
  });
});
