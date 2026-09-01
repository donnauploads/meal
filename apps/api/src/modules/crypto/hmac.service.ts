import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

@Injectable()
export class HmacService {
  private readonly logger = new Logger(HmacService.name);
  private readonly ssnPepper: Buffer;

  constructor(config: ConfigService) {
    const pepper = config.get<string>('SSN_PEPPER') ?? '';
    if (!pepper) this.logger.warn('SSN_PEPPER not set; ssnHash will use an empty pepper.');
    this.ssnPepper = Buffer.from(pepper, 'utf8');
  }

  ssnHash(plain: string): string {
    const normalized = plain.replace(/\D/g, '');
    return createHmac('sha256', this.ssnPepper).update(normalized).digest('hex');
  }
}
