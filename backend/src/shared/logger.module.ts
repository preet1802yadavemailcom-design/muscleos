import { Module, Global } from '@nestjs/common';

import { AuditService } from './services/audit.service';
import { EncryptionService } from './services/encryption.service';
import { ExportService } from './services/export.service';
import { LoggerService } from './services/logger.service';

@Global()
@Module({
  providers: [LoggerService, EncryptionService, AuditService, ExportService],
  exports: [LoggerService, EncryptionService, AuditService, ExportService],
})
export class LoggerModule {}
