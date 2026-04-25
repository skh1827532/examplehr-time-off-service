import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { TimeOffRequestsService } from './time-off-requests.service';
import {
  ApproveTimeOffRequestDto,
  CancelTimeOffRequestDto,
  CreateTimeOffRequestDto,
  ListTimeOffRequestsQueryDto,
  RejectTimeOffRequestDto,
} from './dto';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';

@Controller('time-off-requests')
@UseInterceptors(IdempotencyInterceptor)
export class TimeOffRequestsController {
  constructor(private readonly svc: TimeOffRequestsService) {}

  @Post()
  create(@Body() body: CreateTimeOffRequestDto) {
    return this.svc.create(body);
  }

  @Get()
  list(@Query() q: ListTimeOffRequestsQueryDto) {
    return this.svc.list(q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() body: ApproveTimeOffRequestDto) {
    return this.svc.approve(id, body);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() body: RejectTimeOffRequestDto) {
    return this.svc.reject(id, body);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() body: CancelTimeOffRequestDto) {
    return this.svc.cancel(id, body);
  }
}
