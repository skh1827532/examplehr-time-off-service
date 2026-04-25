import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class HcmBalanceUpdateDto {
  @IsString()
  employeeId!: string;

  @IsString()
  locationId!: string;

  @IsNumber()
  @Min(0)
  balanceDays!: number;

  @IsDateString()
  hcmUpdatedAt!: string;

  @IsOptional()
  @IsString()
  source?: string;
}

export class HcmBatchBalanceDto {
  @IsString()
  employeeId!: string;

  @IsString()
  locationId!: string;

  @IsNumber()
  @Min(0)
  balanceDays!: number;

  @IsDateString()
  hcmUpdatedAt!: string;
}

export class HcmBatchSyncDto {
  @IsDateString()
  generatedAt!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HcmBatchBalanceDto)
  balances!: HcmBatchBalanceDto[];
}
