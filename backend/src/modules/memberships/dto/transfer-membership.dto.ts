import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class TransferMembershipDto {
  @ApiProperty({ description: 'Member id to transfer this membership to' })
  @IsUUID()
  toMemberId: string;
}
