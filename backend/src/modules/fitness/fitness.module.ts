import { Module } from '@nestjs/common';

import { FitnessController } from './fitness.controller';
import { FitnessService } from './fitness.service';

@Module({
  controllers: [FitnessController],
  providers: [FitnessService],
  exports: [FitnessService],
})
export class FitnessModule {}
