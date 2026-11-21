import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { PNG } from "pngjs";

export const MAX_GIF_BYTES = 5 * 1024 * 1024;

export interface Frame {
  png: Buffer;
  at: number;
}

interface Attempt {
  maxWidth: number;
  fps: number;
}

const ATTEMPTS: Attempt[] = [
  { maxWidth: 800, fps: 8 },
  { maxWidth: 640, fps: 6 },
  { maxWidth: 480, fps: 4 },
  { maxWidth: 360, fps: 3 },
];

function downscale(src: PNG, maxWidth: number): { data: Uint8Array; width: number; height: number } {
  const factor = Math.max(1, Math.ceil(src.width / maxWidth));
  if (factor === 1) return { data: new Uint8Array(src.data), width: src.width, height: src.height };
  const width = Math.floor(src.width / factor);
  const height = Math.floor(src.height / factor);
  const out = new Uint8Array(width * height * 4);
  const area = factor * factor;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sums = [0, 0, 0, 0];
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * src.width;
        for (let dx = 0; dx < factor; dx++) {
          const i = (row + x * factor + dx) * 4;
          for (let c = 0; c < 4; c++) sums[c] += src.data[i + c];
        }
      }
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(sums[c] / area);
    }
  }
  return { data: out, width, height };
}

export function sampleFrames(frames: Frame[], fps: number): { frame: Frame; delay: number }[] {
  if (frames.length === 0) return [];
  const step = 1000 / fps;
  const picked: Frame[] = [];
  let next = frames[0].at;
  for (const f of frames) {
    if (f.at >= next) {
      picked.push(f);
      next = f.at + step;
    }
  }
  return picked.map((frame, i) => {
    const end = picked[i + 1]?.at ?? frame.at + step * 4;
    return { frame, delay: Math.max(20, Math.round(end - frame.at)) };
  });
}

function sharedPalette(images: Uint8Array[]): ReturnType<typeof quantize> {
  const picks = Math.min(images.length, 8);
  const chunks: Uint8Array[] = [];
  for (let k = 0; k < picks; k++) {
    const img = images[Math.floor((k * (images.length - 1)) / Math.max(1, picks - 1))];
    const pixels = img.length / 4;
    const out = new Uint8Array(Math.ceil(pixels / 4) * 4);
    for (let p = 0, o = 0; p < pixels; p += 4, o += 4) out.set(img.subarray(p * 4, p * 4 + 4), o);
    chunks.push(out);
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  return quantize(all, 256);
}

function encodeOnce(frames: Frame[], attempt: Attempt): Uint8Array {
  const gif = GIFEncoder();
  const picked = sampleFrames(frames, attempt.fps);
  const images = picked.map(({ frame }) => downscale(PNG.sync.read(frame.png), attempt.maxWidth));
  const palette = sharedPalette(images.map((i) => i.data));
  images.forEach((img, i) => {
    gif.writeFrame(applyPalette(img.data, palette), img.width, img.height, { palette, delay: picked[i].delay });
  });
  gif.finish();
  return gif.bytes();
}

export async function framesToGif(frames: Frame[], out: string): Promise<number> {
  if (frames.length === 0) throw new Error("no frames were captured for the GIF");
  for (const attempt of ATTEMPTS) {
    const bytes = encodeOnce(frames, attempt);
    if (bytes.byteLength <= MAX_GIF_BYTES) {
      await Bun.write(out, bytes);
      return bytes.byteLength;
    }
  }
  throw new Error(`GIF stays over ${MAX_GIF_BYTES} bytes even at the smallest size`);
}
