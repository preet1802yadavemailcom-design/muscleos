import * as crypto from 'crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    const secret = this.configService.get('app.jwtSecret');
    this.key = crypto.scryptSync(secret, 'salt', 32);
  }

  encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(encryptedData: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  generateRandomToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  generateQRCodeData(memberId: string, gymId: string): string {
    const timestamp = Date.now();
    const data = `${gymId}:${memberId}:${timestamp}`;
    return this.encrypt(data);
  }

  decryptQRCodeData(encryptedData: string): { gymId: string; memberId: string; timestamp: number } {
    const decrypted = this.decrypt(encryptedData);
    const [gymId, memberId, timestamp] = decrypted.split(':');
    return { gymId, memberId, timestamp: parseInt(timestamp, 10) };
  }
}
