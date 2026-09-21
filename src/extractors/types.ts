import type { FileSnapshot, Segment } from '../core/contracts.js';

export type ExtractionDiagnostic = {
  code: string;
  line?: number;
};

export type ExtractionResult = {
  segments: Segment[];
  suppressedSegments: number;
  diagnostics: ExtractionDiagnostic[];
  notices: string[];
};

export type ExtractInput = {
  source: string;
  snapshot: FileSnapshot;
  glossary: readonly string[];
};
