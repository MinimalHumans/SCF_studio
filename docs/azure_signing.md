# Replicating artifact signing in another project

This repo signs the Windows exe/installer using **Azure Trusted Signing**
(formerly "Artifact Signing"/"Azure Code Signing"), authenticated via
GitHub's OIDC federation. No secrets are stored anywhere — just three
non-secret IDs in `.github/workflows/desktop.yml`. This doc explains how to
set the same thing up for another project.

See `.github/workflows/desktop.yml` (the `windows` job) and
`scf-app/src-tauri/tauri.conf.json` for the reference implementation.

## What you already have (one-time Azure setup, done once per account)

The Trusted Signing account `krets-signing` in `eus` (East US) and the app
registration (client ID `cea87653-01f1-4308-9988-8ca28c971a70`) already
exist. For a new project you almost certainly reuse both rather than create
new ones — you only need two new things: a certificate profile for the new
product name, and a federated credential for the new repo.

### 1. Create a new Certificate Profile

In the Azure portal, under the existing `krets-signing` Trusted Signing
account → **Certificate profiles** → **Create**:

- Type: **Public Trust** (same as `scf-public-trust`)
- Give it a name specific to the new app (this name becomes your
  `SIGNING_PROFILE`)
- Submit for identity validation if the account doesn't already have one
  approved (a validated account can usually spin up additional profiles
  without re-validation)

### 2. Add a federated credential to the existing app registration

Azure Portal → **Entra ID** → **App registrations** → the app behind
`cea87653-01f1-4308-9988-8ca28c971a70` → **Certificates & secrets** →
**Federated credentials** → **Add credential**:

- Scenario: **GitHub Actions deploying Azure resources**
- Organization/repo: the new repo
- Entity type: **Branch**, value = the branch that's allowed to sign
  (e.g. `main`)

This produces a trust relationship
(`repo:ORG/NEW-REPO:ref:refs/heads/BRANCH`) — no client secret needed;
GitHub mints a short-lived OIDC token at job time and Azure trusts it
because of this binding.

If you'd rather keep projects fully isolated, create a **separate app
registration** instead and give it the same federated-credential
treatment — then the new project gets its own `AZURE_CLIENT_ID`. Reusing
the app registration is simpler and fine since it's just an identity, not
a secret.

### 3. Grant the signing role

On the `krets-signing` account → **Access control (IAM)** → **Add role
assignment** → role **Trusted Signing Certificate Profile Signer**,
assigned to the app registration's service principal, scoped to the
account (or just the new certificate profile for tighter scoping).

## What to copy into the new project's workflow

Mirror the top of `desktop.yml`:

```yaml
on:
  push:
    branches: [main]   # whichever branch should get signed
permissions:
  contents: write
  id-token: write       # required for OIDC — without this, azure/login fails

env:
  AZURE_CLIENT_ID: cea87653-01f1-4308-9988-8ca28c971a70   # reuse, or your new app's ID
  AZURE_TENANT_ID: dbbfdd81-727c-4a58-a3f5-db66a2d489c1   # same tenant
  AZURE_SUBSCRIPTION_ID: e3fd192a-87a3-4645-aa51-6744c2be6469
  SIGNING_ENDPOINT: https://eus.codesigning.azure.net
  SIGNING_ACCOUNT: krets-signing
  SIGNING_PROFILE: <the new certificate profile name from step 1>
```

Then copy these steps from `desktop.yml` verbatim, adjusting the branch
condition:

1. **`azure/login@v2`** with the three IDs above — exchanges the GitHub
   OIDC token for an Azure session.
2. **`set up signtool`** — installs the `Microsoft.Trusted.Signing.Client`
   NuGet package (the dlib that lets `signtool.exe` talk to the cloud
   signing service), locates the Windows SDK's `signtool.exe`, writes a
   `metadata.json` (endpoint/account/profile), and writes a small
   `sign.ps1` wrapper. The wrapper exists because **Tauri's
   `signCommand` splits on spaces**, so you can't pass
   `signtool.exe sign /v /fd SHA256 ...` directly — point it at a single
   script instead.
3. Wire it into the build by passing `--config` with
   `bundle.windows.signCommand` set to
   `pwsh -NoProfile -File <path-to-sign.ps1> %1`, instead of hardcoding
   `signCommand` in `tauri.conf.json` (keeps it conditional on branch, and
   keeps the script path dynamic).

Then two gotchas worth keeping:

- **Re-sign the portable/unbundled exe separately.** Tauri signs the copy
  it puts in the NSIS installer, then restores the original unpatched exe
  in `target/release/`. If you ship that raw exe too (portable zip,
  auto-updater, etc.), sign it again after the build.
- **Verify** with `Get-AuthenticodeSignature` and fail the job if status
  isn't `Valid` — cheap insurance against a silent signing no-op.

## In `tauri.conf.json`

Nothing signing-specific needs to go here — this repo's
`tauri.conf.json` has no signing config at all. The `signCommand` is
injected at build time via `--config` for exactly one reason: so
unsigned branches/PRs build without touching Azure. If the new project
always signs (e.g. only one branch ever builds), you could instead
hardcode `bundle.windows.signCommand` in `tauri.conf.json` and drop the
`--config` override, but keeping it conditional like here is safer if
you ever want CI to build unsigned PRs.
