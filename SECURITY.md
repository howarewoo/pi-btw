# Security policy

## Reporting a vulnerability

Please report suspected security vulnerabilities privately through
[GitHub's vulnerability reporting form](https://github.com/howarewoo/pi-btw/security/advisories/new).
Do not disclose vulnerabilities, credentials, or sensitive reproduction details in public
issues or pull requests.

Include the affected version, reproduction steps, and potential impact. Remove API keys,
tokens, personal data, and private repository content from logs and examples.

## Supported versions

Security fixes target the latest published release. Please upgrade to the latest release
before reporting a problem, when possible.

## Trust boundaries

The extension itself runs with Pi's operating-system permissions; review its source before
installing. Side conversations send a snapshot of the parent conversation, effective
instructions and their own messages to the parent's current model provider.

Each side conversation registers only the `read`, `grep`, `find`, and `ls` tools, enforced by
an explicit SDK allowlist and a resource loader without extensions, skills, or templates.
This is a capability restriction, not a filesystem sandbox: those tools can read any local
path accessible to Pi, including paths outside the working directory. Only run the extension
in projects you trust, and do not ask side conversations to read secrets.

## Session storage

Thread snapshots and SDK transcripts are saved as hidden versioned entries
(`howarewoo.btw.v1`) in the parent session file. They can contain the same sensitive
conversation and project content as the parent session; protect session files accordingly.
`--no-session` parent sessions keep side conversations in memory only.
