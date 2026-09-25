# Security Policy

## Reporting a vulnerability

**Please report security issues privately. Do not open a public issue, a public pull
request, or a public discussion for a vulnerability.**

Use the hosting platform's private reporting channel for this repository:

- On GitHub: **Security → Report a vulnerability** on this repository. This opens a
  private advisory that only the maintainers can see.
- If private reporting is not enabled on this repository, contact the repository owner
  directly through the platform's private messaging rather than through a public
  channel.

> **Maintainer note:** Forgeboard does not yet publish a maintainer security contact
> address, and private vulnerability reporting may not be enabled on this repository
> yet. Enable it and add a monitored address here before announcing the project
> publicly. Until then, a direct message to the repository owner is the private
> channel.

## What to include

The more of the following you can provide, the faster it can be triaged:

- The Forgeboard version (shown in the application) and your operating system.
- What the vulnerability allows, and what an attacker would need in order to exploit it.
- Reproduction steps, a minimal proof of concept, or logs with secrets removed.
- The impact you believe it has: for example credential disclosure, reading another
  user's data, or remote code execution through prompt content.

Please do not include real API keys, real provider traffic, or personal data in a
report. A fake key and a local endpoint are enough to demonstrate a credential-handling
issue.

## What to expect

- An acknowledgement that the report was received, and an honest assessment of severity.
- A discussion of the fix, and credit in the release notes if you want it.
- Because this is a volunteer-maintained project with no published response-time
  commitment, a fix may take time. Reports that reveal a credential leak, an unsafe
  deserialization, or remote code execution are treated as urgent; anything else is
  scheduled normally.

Please give maintainers reasonable time to publish a fix before disclosing publicly.

## Supported versions

Forgeboard is pre-1.0 and has no long-term-support branches yet.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| < 0.1 | No |

## Security model, in brief

Understanding the design helps you decide whether something is a vulnerability or
intended behavior. The full description is in the [README](README.md#security-model).

- **No accounts, no backend, no telemetry.** There is no server-side attack surface.
- **Local data.** Workspaces, prompts, settings, and run history are written to a
  versioned JSON file in the Electron `userData` directory on the user's device.
- **Credentials.** Saved API keys live in a separate file encrypted with the operating
  system's secure storage (Electron `safeStorage`). If that is unavailable, a credential
  is held in memory for the current session only. The renderer receives
  `hasCredential: boolean` and never a credential value.
- **Redaction.** Known credential values are stripped from error text, history, and
  exports before they leave the main process.
- **Renderer isolation.** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, a fixed allowlist of IPC channels validated with Zod, denied
  permission requests, blocked navigation and new windows, and a Content Security Policy
  that only allows same-origin resources.
- **Outbound requests are user-initiated.** A provider request happens only when the
  user runs a prompt, and only to the connection they selected. Only `http:` and `https:`
  URLs without embedded credentials are accepted. Responses are rendered as text, never
  as HTML.
- **Prompt content is never executed** as a shell command, and there is no plugin
  loader or command runner.

## Out of scope

These are not vulnerabilities in Forgeboard:

- A provider you configured returning unexpected content, or leaking your prompt to its
  own operator. Review the endpoint before you trust it with a prompt.
- Your operating system being compromised, or a local attacker who already has your user
  account and can read the `userData` directory directly.
- Losing data by deleting the `userData` folder. Backups are a recovery aid, not an
  archival system.
- Unsigned installers triggering operating-system warnings. The packaging configuration
  in this repository does not sign or notarize anything; that is a distribution concern,
  not an exploitable defect.
