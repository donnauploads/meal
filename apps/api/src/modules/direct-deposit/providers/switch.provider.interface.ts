export interface SwitchRequest {
  userId: string;
  employerName: string;
  employerDomain?: string;
  routingNumber: string;
  accountNumber: string;
}

export interface SwitchResult {
  requestId: string;
  status: 'pending' | 'completed' | 'failed';
  message?: string;
}

export interface SwitchProvider {
  start(req: SwitchRequest): Promise<SwitchResult>;
  status(requestId: string): Promise<SwitchResult>;
}

export const SWITCH_PROVIDER = Symbol('SWITCH_PROVIDER');
