import { ConfigService } from '@nestjs/config';
import { AesGcmService } from './aes-gcm.service';
import { randomBytes } from 'crypto';

function buildSvc(): AesGcmService {
  const key = randomBytes(32).toString('base64');
  const cfg = new ConfigService({ AES_KEY: key });
  return new AesGcmService(cfg);
}

describe('AesGcmService', () => {
  it('SSN round-trip', () => {
    const svc = buildSvc();
    const ssn = '123456789';
    const ct = svc.encrypt(ssn);
    expect(ct).not.toBe(ssn);
    expect(svc.decrypt(ct)).toBe(ssn);
  });

  it('different IV per encryption', () => {
    const svc = buildSvc();
    expect(svc.encrypt('abc')).not.toBe(svc.encrypt('abc'));
  });
});
