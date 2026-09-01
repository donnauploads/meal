import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SwitchProvider, SwitchRequest, SwitchResult } from './switch.provider.interface';

@Injectable()
export class AtomicStubProvider implements SwitchProvider {
  private readonly logger = new Logger(AtomicStubProvider.name);
  private readonly requests = new Map<string, SwitchResult & { req: SwitchRequest }>();

  async start(req: SwitchRequest): Promise<SwitchResult> {
    const requestId = `atomic_stub_${randomUUID()}`;
    const result: SwitchResult = { requestId, status: 'pending' };
    this.requests.set(requestId, { ...result, req });
    this.logger.log(`Atomic stub switch started ${requestId} for user=${req.userId} employer=${req.employerName}`);
    return result;
  }

  async status(requestId: string): Promise<SwitchResult> {
    const r = this.requests.get(requestId);
    if (!r) return { requestId, status: 'failed', message: 'unknown request' };
    return { requestId: r.requestId, status: r.status, message: r.message };
  }

  // Test/admin helper — flips an in-memory entry to completed.
  markCompleted(requestId: string): SwitchResult | null {
    const r = this.requests.get(requestId);
    if (!r) return null;
    r.status = 'completed';
    this.requests.set(requestId, r);
    return { requestId, status: 'completed' };
  }
}
