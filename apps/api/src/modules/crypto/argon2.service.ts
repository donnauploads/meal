import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class Argon2Service {
  private readonly opts: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  };

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.opts);
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain, this.opts);
  }
}
