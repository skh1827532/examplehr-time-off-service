import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class SubmitTransactionDto {
  @IsString()
  employeeId!: string;

  @IsString()
  locationId!: string;

  @IsNumber()
  @Min(0.01)
  days!: number;

  @IsIn(['DEBIT', 'CREDIT'])
  type!: 'DEBIT' | 'CREDIT';

  @IsOptional()
  @IsString()
  reason?: string;
}
