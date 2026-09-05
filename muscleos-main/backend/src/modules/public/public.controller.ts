import { Public } from '@common/decorators/public.decorator';
import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

import { SubmitEnquiryDto } from './dto/enquiry.dto';
import { PublicService } from './public.service';

@ApiTags('Public')
@Controller('public/gym')
export class PublicController {
  constructor(private readonly service: PublicService) {}

  @Get(':slug')
  @Public()
  @ApiOperation({ summary: 'Public gym landing page data (SEO profile, trainers, batches)' })
  async getProfile(@Param('slug') slug: string) {
    return this.service.getGymProfile(slug);
  }

  @Post(':slug/enquiry')
  @Public()
  @ApiOperation({ summary: 'Submit a membership enquiry / lead capture form' })
  async submitEnquiry(@Param('slug') slug: string, @Body() dto: SubmitEnquiryDto) {
    return this.service.submitEnquiry(slug, dto);
  }
}
