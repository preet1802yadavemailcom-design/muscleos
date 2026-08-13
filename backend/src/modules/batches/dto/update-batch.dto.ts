import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsBoolean } from 'class-validator';

import { CreateBatchDto } from './create-batch.dto';

export class UpdateBatchDto extends PartialType(CreateBatchDto) {
  @ApiPropertyOptional({ description: 'Archive/unarchive the batch' })
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}
