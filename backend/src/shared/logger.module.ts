import { Module, Global } from '@nestjs/common';

import { AccessScopeService } from './services/access-scope.service';
import { AuditService } from './services/audit.service';
import { EncryptionService } from './services/encryption.service';
import { ExportService } from './services/export.service';
import { LoggerService } from './services/logger.service';
import { FirebaseAdminService } from './services/firebase-admin.service';
import { SequenceService } from './services/sequence.service';

@Global()
@Module({
  providers: [LoggerService, EncryptionService, AuditService, ExportService, FirebaseAdminService, SequenceService, AccessScopeService],
  exports: [LoggerService, EncryptionService, AuditService, ExportService, FirebaseAdminService, SequenceService, AccessScopeService],
})
export class LoggerModule {}
