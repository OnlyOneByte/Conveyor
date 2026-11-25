import type { Scene, Step } from "../scene.ts";

const refused = (
  name: string,
  file: string,
  text: string,
  says: string,
  first: Step[] = [],
): Scene => ({
  name,
  route: "/",
  ready: "text=How big?",
  steps: [
    ...first,
    { click: "role=tab[name='Upload STL']" },
    { upload: "input[type=file]", name: file, text },
    { waitFor: `[role=alert] >> text=${says}` },
    { wait: 500 },
  ],
});

const fault: Step = {
  fulfill: "**/api/uploads",
  method: "POST",
  status: 500,
  json: { error: "internal error" },
};

export const scenes: Scene[] = [
  refused("make-upload-empty", "empty.stl", "", "Couldn't upload empty.stl: the file is empty"),
  refused("make-upload-not-stl", "notes.stl", "not a model", "the file isn't an STL model"),
  refused(
    "make-upload-fault",
    "bin.stl",
    "solid bin\nfacet\n",
    "Couldn't upload bin.stl. Try again.",
    [fault],
  ),
];
