import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsOptional, MaxLength, IsNumber, Min, Max, IsInt,
} from 'class-validator';

export class CreateBranchDto {
  @ApiProperty({ example: 'Jaunpur Branch' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pincode?: string;

  @ApiPropertyOptional({ example: 25.7359 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 82.6863 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({
    description: 'Geofence radius in meters. Omit/null to disable geofence for this branch.',
    example: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(2000)
  geofenceRadiusMeters?: number;
}
