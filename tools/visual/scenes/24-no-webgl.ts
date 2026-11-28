import type { Scene } from "../scene.ts";

const NOTE = "text=The 3D preview needs WebGL, which this browser has turned off.";

export const scenes: Scene[] = [
  {
    name: "make-no-webgl",
    route: "/",
    ready: "header",
    widths: [1440, 390],
    fullPage: false,
    steps: [
      { noWebgl: true },
      { waitFor: "h1 >> text=What are we making?" },
      { waitFor: NOTE },
      { absent: "canvas" },
      { absent: "text=Error 500" },
      { click: "role=tab[name='Upload STL']" },
      { waitFor: "text=Which file?" },
      { click: "role=tab[name='Gridfinity Bin']" },
      { waitFor: "text=How big?" },
      { waitFor: "main button[type=submit] >> text=Print" },
      { waitFor: NOTE },
      { wait: 400 },
    ],
  },
];
