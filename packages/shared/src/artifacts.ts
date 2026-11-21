export interface Artifact {
  path: string;
  format: string;
  meta?: Record<string, unknown>;
}

export type ModelArtifact = Artifact;

export type GcodeArtifact = Artifact;
