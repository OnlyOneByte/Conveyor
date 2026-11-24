import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const SCOPE = "packages/web/src/";
const TOKENS = "packages/web/src/lib/styles/tokens.css";
const CHECKED = /\.(svelte|ts|js|css|html)$/;
const FUNCTIONS =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(|(?<![.\w-])color\(/gi;
const HEX_NUMBER = /\b0x[0-9a-f]{6}\b/gi;
const NAMES =
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen";
const NAMED = new RegExp(
  `\\b(?:color|background(?:-color)?|border(?:-[a-z]+)*|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|caret-color|accent-color|text-decoration-color)\\s*:\\s*["']?[^;}"']*?\\b(${NAMES.split(" ").join("|")})\\b`,
  "gi",
);

export const DEFERRED_3D = new Set([
  "packages/web/src/lib/previews/gridfinity.ts",
  "packages/web/src/lib/components/MeshScene.svelte",
  "packages/web/src/lib/components/PreviewScene.svelte",
]);

export const isChecked = (path: string) =>
  path.startsWith(SCOPE) && path !== TOKENS && CHECKED.test(path);

function found(line: string, path: string): string[] {
  const hits = [...line.matchAll(FUNCTIONS)].map((m) => m[0]);
  if (!DEFERRED_3D.has(path)) hits.push(...[...line.matchAll(HEX_NUMBER)].map((m) => m[0]));
  return [...hits, ...[...line.matchAll(NAMED)].map((m) => m[1] ?? "")];
}

export function rawColours(path: string, text: string): string[] {
  return text
    .split("\n")
    .flatMap((line, i) => found(line, path).map((hit) => `${path}:${i + 1}: ${hit}`));
}

export function scan(root = ROOT): string[] {
  const listed = Bun.spawnSync(["git", "ls-files", "-z", "--", SCOPE], { cwd: root }).stdout;
  const paths = listed.toString().split("\0").filter(isChecked);
  return paths.flatMap((path) => rawColours(path, readFileSync(join(root, path), "utf8")));
}

if (import.meta.main) {
  const hits = scan();
  for (const line of hits) console.error(line);
  console.log(`raw colours outside ${TOKENS}: ${hits.length}`);
  process.exit(hits.length === 0 ? 0 : 1);
}
