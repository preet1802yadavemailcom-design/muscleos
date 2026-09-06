import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class TransferMembershipDto {
  @ApiProperty({ description: 'Target Member UUID or Member Code to transfer this membership to' })
  @IsString()
  @IsNotEmpty()
  toMemberId: string;
}

