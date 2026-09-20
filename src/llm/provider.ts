import type { BatchRequest } from '../core/contracts.js';

/** Transport output is untrusted. Phase 2 must validate it before creating findings. */
export interface ProviderResponse {
  text: string;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  schemaValid: boolean;
}
export interface ProposalProvider {
  propose(request: BatchRequest, signal?: AbortSignal): Promise<ProviderResponse>;
}
export class FakeProvider implements ProposalProvider {
  readonly requests: BatchRequest[] = [];
  constructor(private readonly responses: (ProviderResponse | Error)[]) {}
  async propose(request: BatchRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    signal?.throwIfAborted();
    this.requests.push(structuredClone(request));
    const result = this.responses.shift();
    if (!result) throw new Error('Fake provider responses exhausted');
    if (result instanceof Error) throw result;
    return result;
  }
}
