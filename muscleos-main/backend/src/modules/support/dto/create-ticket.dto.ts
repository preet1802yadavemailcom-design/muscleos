import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, IsOptional, IsIn } from 'class-validator';

export class CreateSupportTicketDto {
  @ApiProperty({ example: 'QR code not scanning at reception' })
  @IsString()
  @MinLength(4)
  title: string;

  @ApiProperty({ example: 'The check-in kiosk shows a black screen when I try to scan.' })
  @IsString()
  @MinLength(10)
  description: string;

  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'MEDIUM' })
  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  priority?: string;
}
