import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsString } from 'class-validator';
import { LocationsService } from './locations.service';

class UpsertLocationDto {
  @IsString()
  locationId!: string;

  @IsString()
  name!: string;

  @IsString()
  country!: string;
}

@Controller('locations')
export class LocationsController {
  constructor(private readonly svc: LocationsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(':locationId')
  get(@Param('locationId') locationId: string) {
    return this.svc.findOrFail(locationId);
  }

  @Post()
  upsert(@Body() body: UpsertLocationDto) {
    return this.svc.upsert(body as never);
  }
}
