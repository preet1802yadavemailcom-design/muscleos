import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LinkMemberDto {
  @ApiProperty({ example: 'MEM-0001' })
  @IsString()
  @MinLength(3)
  memberCode: string;

  @ApiProperty({ example: '9876543210' })
  @IsString()
  @MinLength(6)
  mobile: string;
}
