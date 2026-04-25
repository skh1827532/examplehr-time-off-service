import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { EmployeesService } from './employees.service';

class UpsertEmployeeDto {
  @IsString()
  employeeId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  defaultLocationId?: string;
}

@Controller('employees')
export class EmployeesController {
  constructor(private readonly svc: EmployeesService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(':employeeId')
  get(@Param('employeeId') employeeId: string) {
    return this.svc.findOrFail(employeeId);
  }

  @Post()
  upsert(@Body() body: UpsertEmployeeDto) {
    return this.svc.upsert({
      employeeId: body.employeeId,
      name: body.name,
      defaultLocationId: body.defaultLocationId ?? null,
    });
  }
}
