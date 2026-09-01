import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = isHttp ? exception.getResponse() : { message: 'Internal server error' };

    const body =
      typeof payload === 'string'
        ? { statusCode: status, message: payload }
        : { statusCode: status, ...(payload as object) };

    if (status >= 500) {
      // Error.message / .stack are non-enumerable, so logging the raw
      // exception via Logger.error (which JSON-stringifies) drops them
      // and produces a useless "{}". Unwrap into a plain object first.
      const err = exception as Error & { code?: string; cause?: unknown };
      this.logger.error({
        requestId: req.id,
        path: req.url,
        err: {
          name: err?.name,
          message: err?.message,
          code: err?.code,
          cause: err?.cause,
        },
      });
      if (err?.stack) this.logger.error(err.stack);
    }

    res.status(status).json({ ...body, requestId: req.id });
  }
}
