import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class FreezeMembershipDto {
  @ApiProperty() @IsDateString()
  freezeStart: string;

  @ApiProperty() @IsDateString()
  freezeEnd: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  freezeReason?: string;
}
