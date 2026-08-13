import { Public } from '@common/decorators/public.decorator';
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';

@ApiTags('App')
@Controller()
export class AppController {
  @Public()
  @Get()
  @ApiExcludeEndpoint()
  root() {
    return {
      name: 'MuscleOS API',
      status: 'ok',
      docs: '/api/docs',
      health: '/health',
      timestamp: new Date().toISOString(),
    };
  }
}
