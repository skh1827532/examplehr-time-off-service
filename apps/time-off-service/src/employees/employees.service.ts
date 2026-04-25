import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from './employee.entity';
import { DomainErrors } from '../common/domain-errors';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee) private readonly repo: Repository<Employee>,
  ) {}

  list(): Promise<Employee[]> {
    return this.repo.find();
  }

  async findOrFail(employeeId: string): Promise<Employee> {
    const e = await this.repo.findOne({ where: { employeeId } });
    if (!e) throw DomainErrors.unknownEmployee(employeeId);
    return e;
  }

  async upsert(e: Pick<Employee, 'employeeId' | 'name' | 'defaultLocationId'>): Promise<Employee> {
    const existing = await this.repo.findOne({ where: { employeeId: e.employeeId } });
    if (existing) {
      existing.name = e.name;
      existing.defaultLocationId = e.defaultLocationId ?? null;
      return this.repo.save(existing);
    }
    return this.repo.save(this.repo.create(e));
  }
}
