import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Location } from './location.entity';
import { DomainErrors } from '../common/domain-errors';

@Injectable()
export class LocationsService {
  constructor(
    @InjectRepository(Location) private readonly repo: Repository<Location>,
  ) {}

  list(): Promise<Location[]> {
    return this.repo.find();
  }

  exists(locationId: string): Promise<boolean> {
    return this.repo
      .findOne({ where: { locationId }, select: ['locationId'] })
      .then((x) => !!x);
  }

  async findOrFail(locationId: string): Promise<Location> {
    const l = await this.repo.findOne({ where: { locationId } });
    if (!l) throw DomainErrors.unknownLocation(locationId);
    return l;
  }

  async upsert(l: Location): Promise<Location> {
    const existing = await this.repo.findOne({ where: { locationId: l.locationId } });
    if (existing) {
      existing.name = l.name;
      existing.country = l.country;
      return this.repo.save(existing);
    }
    return this.repo.save(this.repo.create(l));
  }
}
