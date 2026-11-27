# Security Policy

Conveyor runs on your own machine or server and drives printers on your network, so how it is deployed is part of its security surface: a fresh install answers on `127.0.0.1` only, and [Network exposure](docs/self-hosting.md#network-exposure) covers publishing it further. This page says which versions get fixes, how to report a problem privately, and what is in scope.

## Supported versions

Releases are paused. `v0.1.4` is the newest tag and the version behind `:latest`, and no release has been cut since; security fixes land on `main` only, with no backport to the tags already published.

| Version | Supported |
| --- | --- |
| `main` | Yes. Fixes land here |
| `v0.1.4`, earlier `v0.1.x` tags, and `:latest` | No. Not patched while releases are paused |

Test against `main`, and say what you tested: `git rev-parse --short HEAD` in a clone, or the `sha-<short>` tag of the image you ran. This table goes back to "latest minor release only" when releases resume.

## Reporting a vulnerability

Please do not report a suspected vulnerability in a public issue, discussion or pull request.

Use GitHub's private vulnerability reporting for this repository:

https://github.com/OnlyOneByte/Conveyor/security/advisories/new

The report stays private between you and the maintainer, so a fix can be prepared before the details are public. If that page is unavailable to you, hold the report rather than posting it publicly: there is no other private channel.

A report that can be acted on includes:

- the commit or image tag you tested;
- how it is deployed: local, on a LAN, or behind a reverse proxy;
- the input or request that triggers the issue;
- what an attacker gains;
- the smallest reproduction you have.

## What to expect

Acknowledgement within about a week, then a first assessment of whether the report is in scope. You will hear when the assessment changes and when a fix ships. Advisories credit the reporter unless you ask to stay anonymous.

## In scope

Conveyor's own code and its documented defaults, including an install exposed on purpose the way [Network exposure](docs/self-hosting.md#network-exposure) describes:

- authentication and session handling in the API and the web app, from the login and its per-client rate limit to `CONVEYOR_AUTH_SECRET` and the session cookie;
- how the server reads, exports and serves files from disk;
- secrets in job parameters, logs and history, and the printer secrets kept under `CONVEYOR_SECRETS_KEY`;
- the addresses the API and worker send requests to on your behalf, meaning printer transport addresses, and the guard in [Printer addresses](docs/self-hosting.md#printer-addresses) that refuses link-local, cloud metadata and unresolvable addresses;
- the defaults in `docker-compose.yml`, the `Caddyfile` and the documented setup.

## Out of scope

- an install exposed with `CONVEYOR_AUTH=disabled`, or published beyond the host without the checklist in [Network exposure](docs/self-hosting.md#network-exposure): authentication on, a strong `CONVEYOR_PASSWORD`, `CONVEYOR_DOMAIN` set;
- bugs in third-party images, packages or printer firmware that Conveyor only passes data to, which belong upstream;
- findings that need an already-compromised host, a shell on the machine, or physical access;
- a report that is only scanner output with no described impact.
