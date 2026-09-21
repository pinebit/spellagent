import { vi } from 'vitest';
// Default tests are offline and credential-free.
vi.stubGlobal('fetch', () => { throw new Error('Network access is forbidden in default tests'); });
