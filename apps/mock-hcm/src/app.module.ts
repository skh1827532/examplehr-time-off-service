import { Module } from '@nestjs/common';
import { SharedModule } from './common/shared.module';
import { BalancesModule } from './balances/balances.module';
import { TransactionsModule } from './transactions/transactions.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [SharedModule, BalancesModule, TransactionsModule, AdminModule],
})
export class AppModule {}
