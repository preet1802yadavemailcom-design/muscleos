import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';

import { SupportTicketsService } from './support.service';
import { CreateSupportTicketDto } from './dto/create-ticket.dto';

/** Self-service support tickets for members, owners, trainers, and
 *  reception — previously tickets could only be viewed/updated from the
 *  super-admin side with no way for an actual user to open one. */
@ApiTags('Support Tickets')
@ApiBearerAuth('access-token')
@Controller('support-tickets')
@UseGuards(JwtAuthGuard)
export class SupportTicketsController {
  constructor(private readonly service: SupportTicketsService) {}

  @Post()
  @ApiOperation({ summary: 'Raise a support ticket for your gym' })
  async create(@CurrentUser('userId') userId: string, @Body() dto: CreateSupportTicketDto) {
    return this.service.create(userId, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: 'List the tickets you have raised' })
  async listMine(@CurrentUser('userId') userId: string) {
    return this.service.listMine(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of your own tickets by id' })
  async getOne(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.service.getOne(userId, id);
  }
}
