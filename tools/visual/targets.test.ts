import { expect, test } from "bun:test";
import { browserPages, rejection } from "./fixtures.ts";
import { assertTargets, smallTargets, targetProblem } from "./targets.ts";

const withPage = browserPages();

const page = (css: string, body: string) =>
  `<style>body { margin: 40px; } button, a { display: inline-block; margin: 60px; padding: 0; border: 0; } ${css}</style><nav>${body}</nav>`;

test("a target counts its real hit area, so a pseudo-element that widens it passes", async () => {
  await withPage(async (p) => {
    await p.setContent(
      page(
        ".small { width: 30px; height: 30px; } .wide { position: relative; width: 30px; height: 30px; } .wide::after { content: ''; position: absolute; inset: -7px; }",
        '<button class="small" aria-label="Small">s</button><button class="wide" aria-label="Wide">w</button><a href="#" style="width:44px;height:44px">Big</a>',
      ),
    );
    expect(await smallTargets(p, "nav")).toEqual([
      { name: 'button "Small"', width: 30, height: 30 },
    ]);
  });
});

test("a control whose centre a neighbour's widened area covers fails, naming the neighbour", async () => {
  await withPage(async (p) => {
    await p.setContent(
      `<style>body { margin: 40px; } nav { display: flex; flex-direction: column; } button { padding: 0; border: 0; width: 120px; } .a { position: relative; height: 44px; } .a::after { content: ""; position: absolute; left: 0; right: 0; top: 100%; height: 26px; } .b { height: 20px; }</style><nav><button class="a">Above</button><button class="b">Below</button></nav>`,
    );
    const small = await smallTargets(p, "nav");
    expect(small).toEqual([
      { name: 'button "Below"', width: 0, height: 0, coveredBy: 'button.a "Above"' },
    ]);
    expect(targetProblem("nav", small)).toBe(
      'targets in nav under 44×44 px of hit area: button "Below" covered at its centre by button.a "Above"',
    );
  });
});

test("an input is measured by its label, and targets outside the scope are ignored", async () => {
  await withPage(async (p) => {
    await p.setContent(
      `${page("label { display: inline-flex; min-height: 44px; min-width: 120px; align-items: center; }", '<label><input type="checkbox"> Allow</label>')}<footer><button style="width:10px;height:10px">x</button></footer>`,
    );
    expect(await smallTargets(p, "nav")).toEqual([]);
    expect((await smallTargets(p, "footer")).map((s) => s.name)).toEqual(['button "x"']);
  });
});

test("the problem names each small target and its size, and none is no problem", async () => {
  expect(targetProblem("nav", [])).toBeNull();
  expect(targetProblem("nav", [{ name: 'a "Jobs"', width: 48, height: 18 }])).toBe(
    'targets in nav under 44×44 px of hit area: a "Jobs" 48×18',
  );
  await withPage(async (p) => {
    await p.setContent(page("", '<a href="#" style="width:48px;height:18px">Jobs</a>'));
    expect(await rejection(assertTargets(p, "nav"))).toMatch(/a "Jobs" 4[89]×1[89]$/);
  });
});
