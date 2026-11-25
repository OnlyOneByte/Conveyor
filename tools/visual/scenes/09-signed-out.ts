import type { Scene } from "../scene.ts";

export const scenes: Scene[] = [
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
    name: "auth-down",
    route: "/",
    ready: "h1 >> text=Can't reach Conveyor",
    authDown: { status: 503 },
    steps: [
      { absent: "nav[aria-label='Main']" },
      { absent: "#belt *" },
      { absent: "text=How big?" },
      { waitFor: "text=Check that it's running, then try again." },
    ],
  },
  {
    name: "auth-error",
    route: "/jobs",
    ready: "h1 >> text=Can't reach Conveyor",
    authDown: { status: 500 },
    steps: [
      { absent: "nav[aria-label='Main']" },
      { absent: "h1 >> text=Jobs" },
      { click: "summary:has-text('Details')" },
      { waitFor: "text=GET /auth/status 500 >> visible=true" },
    ],
  },
  {
    name: "auth-down-retry",
    route: "/",
    ready: "h1 >> text=Can't reach Conveyor",
    authDown: { status: 503, times: 1 },
    steps: [
      { click: "button:has-text('Try again')" },
      { waitFor: "text=How big? >> visible=true" },
      { waitFor: "nav[aria-label='Main']" },
      { absent: "h1 >> text=Can't reach Conveyor" },
      { absent: "text=Still can't reach Conveyor" },
    ],
  },
  {
    name: "not-found",
    route: "/no-such-page",
    ready: "text=Page not found",
  },
];
