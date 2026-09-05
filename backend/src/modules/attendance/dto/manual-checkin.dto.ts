import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ManualCheckInDto {
  @ApiProperty({ description: 'Member to check in/out — found via GET /members?search=name/mobile/code' })
  @IsUUID()
  memberId: string;
}