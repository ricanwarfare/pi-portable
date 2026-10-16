# Security policy

Pi and its PowerShell (Windows) or Bash (Linux) tool run with the launching account's permissions. This project provides no sandbox, forensic write blocker, or guarantee of zero host artifacts. Use it only on systems you are authorized to investigate.

Cloud requests can include prompts, file contents, and tool output. Use an approved provider. Credentials and session files are sensitive and are not encrypted by the launcher.

## Report a vulnerability

Use this repository's **Security → Report a vulnerability** feature for private reporting. Include the affected release, a reproduction using synthetic data, impact, and proposed mitigation. Never include real credentials or case evidence.

If private reporting is unavailable, open an issue requesting a private channel without exploit details or sensitive data.

## Scope

The latest 0.3.x release is the current maintenance target. Report launcher extraction, integrity, environment, credential setup, and packaging issues here. Pi vulnerabilities should also follow [upstream's security policy](https://github.com/earendil-works/pi/security/policy).

Checksums detect changes to expected files; they do not protect execution on a host controlled by a privileged attacker. Public binaries are currently unsigned.
