import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  Query,
} from '@nestjs/common';
import { BalancesService } from './balances.service';

@Controller('employees/:employeeId/balances')
export class BalancesController {
  constructor(private readonly svc: BalancesService) {}

  @Get()
  list(@Param('employeeId') employeeId: string) {
    return this.svc.listForEmployee(employeeId);
  }

  @Get(':locationId')
  async getOne(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @Query('refresh', new DefaultValuePipe(false), ParseBoolPipe) refresh: boolean,
  ) {
    if (refresh) {
      return this.svc.refreshFromHcm(employeeId, locationId);
    }
    return this.svc.getOrFail(employeeId, locationId);
  }
}
