/** An on-disk artifact in the shared /data volume, passed between stages. */
export interface Artifact {
  /** absolute path under /data */
  path: string;
  /** "stl" | "3mf" | "obj" | "gcode" | ... */
  format: string;
  meta?: Record<string, unknown>;
}

/** Generator output / slicer input. */
export type ModelArtifact = Artifact;

/** Slicer output / transport input. */
export type GcodeArtifact = Artifact;
