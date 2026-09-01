import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform, Type } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ZodSchema } from 'zod';

type Schema = ZodSchema | Type<unknown>;

function isZodSchema(s: Schema): s is ZodSchema {
  return typeof (s as ZodSchema).safeParse === 'function';
}

@Injectable()
export class ZodOrClassValidatorPipe implements PipeTransform {
  constructor(private readonly schema?: Schema) {}

  async transform(value: unknown, metadata: ArgumentMetadata) {
    const schema = this.schema ?? (metadata.metatype as Type<unknown> | undefined);
    if (!schema) return value;

    if (isZodSchema(schema)) {
      const result = schema.safeParse(value);
      if (!result.success) {
        throw new BadRequestException({ message: 'Validation failed', issues: result.error.issues });
      }
      return result.data;
    }

    if (typeof schema === 'function' && schema !== Object && schema !== String && schema !== Number && schema !== Boolean && schema !== Array) {
      const instance = plainToInstance(schema as Type<unknown>, value);
      const errors = await validate(instance as object, { whitelist: true, forbidNonWhitelisted: true });
      if (errors.length) {
        throw new BadRequestException({ message: 'Validation failed', errors });
      }
      return instance;
    }

    return value;
  }
}
