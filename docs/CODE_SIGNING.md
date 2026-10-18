# Windows code signing

No signing account or certificate is included. The default artifact is unsigned and the manifest explicitly reports `signature.status: unsigned`. SHA256 files verify bytes and do not authenticate a publisher. Signing cannot guarantee SmartScreen reputation or override WDAC, AppLocker, antivirus or enterprise rules for the launcher or its extracted Pi/search utilities.

The optional GitHub Actions signing job reuses pi-response's Azure Artifact Signing flow with OIDC and a protected `code-signing` environment. Configure repository variable `WINDOWS_SIGNING_MODE=azure`, then these variables:

- AZURE_CLIENT_ID
- AZURE_TENANT_ID
- AZURE_SUBSCRIPTION_ID
- AZURE_SIGNING_ENDPOINT (HTTPS under `.codesigning.azure.net`)
- AZURE_SIGNING_ACCOUNT
- AZURE_SIGNING_PROFILE
- WINDOWS_SIGNING_SUBJECT (exact expected certificate subject)

Provision the Azure identity, federated GitHub environment trust, signing account/profile permissions, and protected environment approval requirements in your own tenant. No credentials are requested or provisioned by the application. The release job fails closed if configured signing fails; it never silently publishes an unsigned artifact in Azure mode.

`scripts/finalize-windows-release.ps1` validates the executable, source commit, clean-source flag, embedded Authenticode signature, exact publisher, trusted timestamp and Windows SDK SignTool verification. It then regenerates the SHA256 and build manifest for the final signed bytes. Run on PowerShell 7 with the Windows SDK installed for signed-release verification. Signing the outer launcher does not sign upstream bundled executables; their hashes and vendor signatures remain as supplied. IT may need separate policy allowances for extracted child tools.

For another enterprise signing service, sign the tested executable externally and run the same finalizer with `-Mode Signed -ExpectedSubject 'CN=Your Publisher' -ExpectedCommit COMMIT`. Update the workflow to supply that artifact and enforce the same final verification before publishing. Never distribute a signing private key with the source, EXE, or portable state.
