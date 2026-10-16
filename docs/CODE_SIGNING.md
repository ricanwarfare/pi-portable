# Windows code signing

## Current status

Windows releases remain **unsigned** until a signing account is obtained and configured. Version 0.7.0 prepares the integration; it does not claim a trusted signature. No certificate, subscription, or signing identity has been purchased or created by this project.

The launcher is the only file this pipeline signs. Embedded upstream Pi/tools keep their original bytes and attribution. Linux signing is outside this integration.

## Obtain a signing identity

The prepared provider is [Azure Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart). It requires an Azure subscription, identity validation, a signing account, and a **Public Trust** certificate profile. It is a paid service; check current pricing and eligibility before enrolling. Microsoft currently supports individual Public Trust applicants in the US and Canada. Identity validation requires the account owner's participation; repository code cannot complete it.

[SignPath Foundation](https://signpath.org/terms.html) is another option for qualifying open-source projects, subject to acceptance. Its restrictions on security tools, upstream binaries, and project reputation mean eligibility for this distribution must be confirmed. This workflow does not currently integrate SignPath. Self-signed certificates are not a substitute for public trust. See [Microsoft's signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).

## Connect the prepared Azure workflow

After account approval:

1. Create the Public Trust certificate profile and record its exact X.509 subject. This is the expected publisher; no signing key belongs in Git.
2. Create a signing application/service principal, grant **Artifact Signing Certificate Profile Signer** scoped to that profile, and configure [GitHub OIDC federation](https://github.com/Azure/artifact-signing-action#example). Bind the federated identity to `repo:ricanwarfare/pi-response:environment:code-signing`, with audience `api://AzureADTokenExchange`.
3. In GitHub, configure the `code-signing` environment with trusted release reviewers and restrict deployment to intended release tags. Only the tag-only signing job requests an OIDC token; builds and PRs have no signing credentials.
4. Set these **repository-level Actions variables**. They are identifiers/configuration, not private keys or passwords:

| Variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | Signing application's client ID |
| `AZURE_TENANT_ID` | Entra tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `AZURE_SIGNING_ENDPOINT` | HTTPS regional `*.codesigning.azure.net` endpoint |
| `AZURE_SIGNING_ACCOUNT` | Artifact Signing account name |
| `AZURE_SIGNING_PROFILE` | Public Trust certificate profile name |
| `WINDOWS_SIGNING_SUBJECT` | Exact certificate subject, including DN ordering and spacing |
| `WINDOWS_SIGNING_MODE` | `azure` to require signing; set this last |

No long-lived Azure client secret or PFX is used. See the [official action](https://github.com/Azure/artifact-signing-action) for role and federation details. An alternative provider needs its own reviewed adapter; do not relabel its output as Azure signing.

## Release behavior

- Blank or `unsigned` mode publishes explicitly unsigned Windows files.
- `azure` mode requires all platform tests, signing authentication, signing, publisher/timestamp verification, and a signed-launcher smoke test. Failure blocks publication; there is no unsigned fallback.
- Unknown modes fail publication. Missing Azure configuration fails before authentication.
- Only `dist/pi-response.exe` is submitted for signing. The job verifies its original checksum and source commit first.
- The finalizer requires a valid embedded Authenticode signature, the configured publisher subject, a timestamp, and successful Windows SDK SignTool verification. It regenerates the checksum and records signature metadata in the build manifest.
- Release notes state whether the final Windows executable is unsigned or verified signed. Normal build artifacts remain unsigned inputs; the release job selects the separate signed artifact when enabled.

The enabled Azure path requires live end-to-end validation after provisioning. Automated tests currently cover unsigned finalization, tamper detection, and rejection of unsigned files or missing publisher configuration in signed mode. They do not claim to validate a live signing account.

## Verify a downloaded EXE

For a future signed release:

```powershell
$signature = Get-AuthenticodeSignature -LiteralPath .\pi-response.exe
$signature | Select-Object Status, SignatureType,
    @{Name='Publisher'; Expression={$_.SignerCertificate.Subject}}
```

Confirm `Valid`, compare the publisher with that release's notes, and verify the published SHA256. A build manifest is descriptive metadata, not an independently signed attestation. Signing adds publisher verification; it does not guarantee SmartScreen reputation, antivirus acceptance, or safety on a compromised host.
