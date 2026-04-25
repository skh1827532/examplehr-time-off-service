import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TimeOffRequestStatus } from './time-off-request.entity';

export class CreateTimeOffRequestDto {
  @IsString()
  employeeId!: string;

  @IsString()
  locationId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsNumber()
  @Min(0.5)
  @Max(365)
  days!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ApproveTimeOffRequestDto {
  @IsString()
  managerId!: string;
}

export class RejectTimeOffRequestDto {
  @IsString()
  managerId!: string;

  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class CancelTimeOffRequestDto {
  @IsString()
  actorId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListTimeOffRequestsQueryDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsEnum([
    'PENDING_APPROVAL',
    'APPROVED',
    'HCM_CONFIRMED',
    'HCM_REJECTED',
    'REJECTED',
    'CANCELLED',
  ])
  status?: TimeOffRequestStatus;
}
