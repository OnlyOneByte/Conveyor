import type { Scene } from "./scenes.ts";

export const signedOutScenes: Scene[] = [
  {
    name: "sign-in",
    route: "/",
    ready: "h1 >> text=Sign in",
    signedOut: true,
  },
  {
    name: "sign-in-wrong",
    route: "/",
    ready: "h1 >> text=Sign in",
    signedOut: true,
    steps: [
      { type: "#password", text: "not the password" },
      { click: "button:has-text('Sign in')" },
      { waitFor: "text=That password didn't work" },
    ],
  },
  {
    name: "not-found",
    route: "/no-such-page",
    ready: "text=Page not found",
  },
];
