import { Module } from '@nestjs/common';

import { SupportTicketsController } from './support.controller';
import { SupportTicketsService } from './support.service';

@Module({
  controllers: [SupportTicketsController],
  providers: [SupportTicketsService],
  exports: [SupportTicketsService],
})
export class SupportModule {}
