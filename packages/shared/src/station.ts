/**
 * Admin binds a printer to a slicer profile once; end users only ever choose a
 * Station. Every slicing/printer detail is preset, hiding all complexity.
 */
export interface Station {
  id: string;
  /** "Garage Klipper — PLA 0.2mm" */
  name: string;
  transportId: string;
  /** a PrinterTarget.id owned by the transport */
  printerId: string;
  slicerId: string;
  /** a ProfileRef.id offered by the slicer */
  profileId: string;
  /** optional allowlist of generator ids permitted on this station */
  allowedGenerators?: string[];
}
