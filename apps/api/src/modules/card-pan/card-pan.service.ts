import { Injectable } from '@nestjs/common';
import { AesGcmService } from '../crypto/aes-gcm.service';

// In Stage 7 we use the local AES-GCM key as the "DEK" and a fixed key id.
// Stage 11 swaps this for a real KMS envelope-encryption flow without changing the consumer.
@Injectable()
export class CardPanService {
  private readonly keyId = 'local-aes-v1';

  constructor(private readonly aes: AesGcmService) {}

  encrypt(plaintext: string): { ciphertext: Buffer; keyId: string } {
    return { ciphertext: Buffer.from(this.aes.encrypt(plaintext), 'base64'), keyId: this.keyId };
  }

  decrypt(ciphertext: Buffer, _keyId: string): string {
    return this.aes.decrypt(Buffer.from(ciphertext).toString('base64'));
  }
}
