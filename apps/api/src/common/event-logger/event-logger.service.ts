import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

export interface RecordedEvent {
  at: string;
  event: string;
  payload: unknown;
}

@Injectable()
export class EventLoggerService implements OnModuleInit {
  private readonly logger = new Logger('Events');
  private readonly buffer: RecordedEvent[] = [];
  private readonly maxBuffer = 250;

  constructor(private readonly emitter: EventEmitter2) {}

  onModuleInit() {
    this.emitter.onAny((event, ...args) => {
      this.record(String(Array.isArray(event) ? event.join('.') : event), args.length <= 1 ? args[0] : args);
    });
  }

  // Belt-and-suspenders: also listen via @OnEvent in case `onAny` is disabled somewhere.
  @OnEvent('**', { async: false, promisify: false })
  onAnyDecorator(payload: unknown) {
    // No-op — kept so wildcard listener is registered at DI time. onAny above is the source of truth.
    void payload;
  }

  recent(limit = 50): RecordedEvent[] {
    return this.buffer.slice(-Math.min(limit, this.maxBuffer)).reverse();
  }

  private record(event: string, payload: unknown) {
    const entry: RecordedEvent = { at: new Date().toISOString(), event, payload };
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBuffer) this.buffer.splice(0, this.buffer.length - this.maxBuffer);
    this.logger.log(`${event} ${safeStringify(payload)}`);
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'bigint') return v.toString();
      if (v instanceof Date) return v.toISOString();
      if (Buffer.isBuffer(v)) return `<Buffer ${v.length}>`;
      return v;
    });
  } catch {
    return '[unserializable]';
  }
}
