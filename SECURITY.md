# Security Policy

Conveyor runs on your own machine or server and drives printers on your network, so how it is deployed is part of its security surface. This page says which versions get fixes, how to report a problem privately, and what is in scope.

## Supported versions

Security fixes land on `main` and ship in the next patch release of the current minor version. Older minor versions are not patched, so upgrade before reporting and say which version you tested.

| Version | Supported |
| --- | --- |
| Latest minor release | Yes |
| Older minor releases | No |

## Reporting a vulnerability

Please do not report a suspected vulnerability in a public issue, discussion or pull request.

Use GitHub's private vulnerability reporting for this repository:

https://github.com/OnlyOneByte/Conveyor/security/advisories/new

The report stays private between you and the maintainer, and a fix can be prepared and released before the details are public. Private reporting has to be switched on in the repository settings before that page accepts a report; if it is not available to you, open a public issue that contains no technical detail and ask for a private channel. Do not put reproduction steps, payloads or affected URLs in the public issue.

A report that can be acted on includes:

- the Conveyor version or commit;
- how it is deployed (local, LAN, behind a reverse proxy);
- the input or request that triggers the issue;
- what an attacker gains;
- the smallest reproduction you have.

## What to expect

Acknowledgement within about a week, then a first assessment of whether the report is in scope. You will hear when the assessment changes and when a fix ships. Advisories credit the reporter unless you ask to stay anonymous.

## In scope

Conveyor's own code and its documented defaults:

- authentication and session handling in the API and the web app;
- how the server reads, exports and serves files from disk;
- secrets in job parameters, logs and history;
- server-side requests Conveyor makes on your behalf, including scraper and transport URLs;
- the defaults in `docker-compose.yml`, the `Caddyfile` and the documented setup.

## Out of scope

- a deployment deliberately exposed to the internet; Conveyor expects a trusted network, and `docs/self-hosting.md` says what that assumes;
- bugs in third-party images, packages or printer firmware that Conveyor only passes data to, which belong upstream;
- findings that need an already-compromised host, a shell on the machine, or physical access;
- a report that is only scanner output with no described impact.
