// Procedural Gridfinity preview geometry (ADR 0002: client-side, sub-ms, faithful
// approximation — NOT the manufacturing-exact STL). Builds a THREE.Group from the
// same params the form edits and the server's generate() consumes.
import * as THREE from "three";

const GRID = 42; // gridfinity unit footprint (mm)
const Z_UNIT = 7; // gridfinity height unit (mm)
const GAP = 0.5; // visual gap between grid cells

export interface GridfinityPreviewParams {
  gridX: number;
  gridY: number;
  heightUnits: number;
  divisionsX: number;
  divisionsY: number;
  scoop: boolean;
  labelTab: boolean;
  magnetHoles: boolean;
  stackingLip: boolean;
}

const DEFAULTS: GridfinityPreviewParams = {
  gridX: 2, gridY: 3, heightUnits: 6,
  divisionsX: 1, divisionsY: 1,
  scoop: false, labelTab: false, magnetHoles: true, stackingLip: true,
};

const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2dd4bf, roughness: 0.6, metalness: 0.05 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x14b8a6, roughness: 0.7, metalness: 0.05 });
const lipMat = new THREE.MeshStandardMaterial({ color: 0x5eead4, roughness: 0.5, metalness: 0.1 });
const tabMat = new THREE.MeshStandardMaterial({ color: 0x99f6e4, roughness: 0.5 });

/** Build a Gridfinity-bin approximation centered at the origin (Y up). */
export function buildGeometry(p: Partial<GridfinityPreviewParams> = {}): THREE.Group {
  const params = { ...DEFAULTS, ...p };
  const g = new THREE.Group();

  const w = params.gridX * GRID - GAP;
  const d = params.gridY * GRID - GAP;
  const h = Math.max(params.heightUnits, 2) * Z_UNIT;
  const wallT = 1.2;
  const baseH = Z_UNIT; // the gridfinity base profile height (approx)

  // Solid base block (the part that holds magnets + locks to a baseplate).
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, baseH, d), bodyMat);
  base.position.y = baseH / 2;
  g.add(base);

  // Outer walls (four thin boxes) rising from the base to the rim.
  const wallH = h - baseH;
  const rimY = baseH + wallH / 2;
  const mkWall = (sw: number, sd: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sw, wallH, sd), wallMat);
    m.position.set(x, rimY, z);
    g.add(m);
  };
  mkWall(w, wallT, 0, d / 2 - wallT / 2);
  mkWall(w, wallT, 0, -d / 2 + wallT / 2);
  mkWall(wallT, d - 2 * wallT, w / 2 - wallT / 2, 0);
  mkWall(wallT, d - 2 * wallT, -w / 2 + wallT / 2, 0);

  // Interior dividers.
  const innerW = w - 2 * wallT;
  const innerD = d - 2 * wallT;
  for (let i = 1; i < params.divisionsX; i++) {
    const x = -innerW / 2 + (innerW / params.divisionsX) * i;
    const m = new THREE.Mesh(new THREE.BoxGeometry(wallT, wallH, innerD), wallMat);
    m.position.set(x, rimY, 0);
    g.add(m);
  }
  for (let j = 1; j < params.divisionsY; j++) {
    const z = -innerD / 2 + (innerD / params.divisionsY) * j;
    const m = new THREE.Mesh(new THREE.BoxGeometry(innerW, wallH, wallT), wallMat);
    m.position.set(0, rimY, z);
    g.add(m);
  }

  // Stacking lip — a slightly inset frame at the top rim.
  if (params.stackingLip) {
    const lipH = 2;
    const lip = new THREE.Mesh(new THREE.BoxGeometry(w, lipH, d), lipMat);
    lip.position.y = h + lipH / 2;
    g.add(lip);
  }

  // Label tab — a small angled shelf along the back-top of the first compartment.
  if (params.labelTab) {
    const tabW = innerW / params.divisionsX - 1;
    const tab = new THREE.Mesh(new THREE.BoxGeometry(tabW, 1.2, 10), tabMat);
    tab.position.set(-innerW / 2 + tabW / 2 + 0.5, h - 1, -innerD / 2 + 6);
    tab.rotation.x = -0.5;
    g.add(tab);
  }

  // Scoop — a quarter-cylinder ramp along the front interior floor.
  if (params.scoop) {
    const r = Math.min(10, innerD / 2);
    const scoopGeo = new THREE.CylinderGeometry(r, r, innerW, 24, 1, false, 0, Math.PI / 2);
    const scoop = new THREE.Mesh(scoopGeo, wallMat);
    scoop.rotation.z = Math.PI / 2;
    scoop.position.set(0, baseH + r, d / 2 - wallT - r);
    g.add(scoop);
  }

  // Magnet holes — visual dimples on the underside corners of each grid cell.
  if (params.magnetHoles) {
    const holeMat = new THREE.MeshStandardMaterial({ color: 0x0e1116, roughness: 1 });
    for (let cx = 0; cx < params.gridX; cx++) {
      for (let cy = 0; cy < params.gridY; cy++) {
        const cellX = -w / 2 + GRID / 2 + cx * GRID;
        const cellZ = -d / 2 + GRID / 2 + cy * GRID;
        for (const [ox, oz] of [[-13, -13], [13, -13], [-13, 13], [13, 13]]) {
          const hole = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 1.5, 12), holeMat);
          hole.position.set(cellX + ox, 0.75, cellZ + oz);
          g.add(hole);
        }
      }
    }
  }

  // Recenter vertically so the model sits nicely in frame.
  g.position.y = -h / 2;
  return g;
}

/** Longest horizontal extent — lets the camera/controls frame any bin size. */
export function boundingRadius(p: Partial<GridfinityPreviewParams> = {}): number {
  const params = { ...DEFAULTS, ...p };
  const w = params.gridX * GRID;
  const d = params.gridY * GRID;
  const h = Math.max(params.heightUnits, 2) * Z_UNIT;
  return Math.sqrt(w * w + d * d + h * h) / 2;
}
