import { afterAll, beforeAll } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { PNG } from "pngjs";

export function solid(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgb[0];
    png.data[i + 1] = rgb[1];
    png.data[i + 2] = rgb[2];
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

export function browserPages() {
  let browser: Browser | undefined;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });
  return async <T>(run: (page: Page) => Promise<T>): Promise<T> => {
    if (!browser) throw new Error("browserPages: call it at the top of a test file");
    const context = await browser.newContext({ viewport: { width: 400, height: 300 } });
    try {
      return await run(await context.newPage());
    } finally {
      await context.close();
    }
  };
}
