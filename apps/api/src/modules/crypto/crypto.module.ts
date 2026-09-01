import { Global, Module } from '@nestjs/common';
import { Argon2Service } from './argon2.service';
import { JwtCryptoService } from './jwt.service';
import { AesGcmService } from './aes-gcm.service';
import { HmacService } from './hmac.service';

@Global()
@Module({
  providers: [Argon2Service, JwtCryptoService, AesGcmService, HmacService],
  exports: [Argon2Service, JwtCryptoService, AesGcmService, HmacService],
})
export class CryptoModule {}
