import { join } from "node:path";
import type { Scene } from "./scene.ts";

export { HEIGHTS, keys, type Scene, type Step, WIDTHS } from "./scene.ts";

export interface SceneFile {
  file: string;
  scenes: Scene[];
}

const isScenes = (value: unknown): value is Scene[] =>
  Array.isArray(value) && value.every((s) => typeof s === "object" && s !== null && "name" in s);

async function loadSceneFiles(): Promise<SceneFile[]> {
  const dir = join(import.meta.dir, "scenes");
  const files = (await Array.fromAsync(new Bun.Glob("*.ts").scan({ cwd: dir })))
    .filter((file) => !file.endsWith(".test.ts"))
    .sort();
  const loaded: SceneFile[] = [];
  for (const file of files) {
    const { scenes } = await import(join(dir, file));
    if (!isScenes(scenes)) throw new Error(`scenes/${file} exports no \`scenes\` array`);
    loaded.push({ file, scenes });
  }
  return loaded;
}

export const sceneFiles = await loadSceneFiles();

export const scenes: Scene[] = sceneFiles.flatMap((f) => f.scenes);
