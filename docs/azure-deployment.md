# Deploying to Azure

How LinkForge ships to production: two containers on Azure App Service,
images built and published by GitHub Actions, no infrastructure the repo
doesn't already know how to build.

## Architecture

```
GitHub Actions (on CI success, main)
        │
        ├─ build+push ─▶ ghcr.io/<owner>/linkforge-backend
        └─ build+push ─▶ ghcr.io/<owner>/linkforge-frontend
                │                        │
                ▼                        ▼
     Azure App Service (Linux,   Azure App Service (Linux,
     Web App for Containers)     Web App for Containers)
     linkforge-api                linkforge-web
                │
                ▼
     Neon Postgres · Upstash Redis   (already external — unchanged)
```

Two single-container Web Apps, not one multi-container deployment. Azure's
multi-container (Docker Compose) support on App Service is legacy and
doesn't scale per-service; two plain Web Apps for Containers is the
supported, production path and matches how the images are already built
(`Dockerfile`, `frontend/Dockerfile`).

Postgres and Redis are **not** deployed to Azure — this repo already points
at managed Neon/Upstash instances in production, so `docker-compose.yml`'s
`postgres`/`redis` services stay exactly what they've always been: local-dev
only.

## One-time setup

Run once, from a machine with the Azure CLI (`az`) logged in
(`az login`) and the GitHub CLI (`gh`) authenticated. Replace
`<subscription-id>`, `<tenant-id>`, resource names, and region as needed —
the names below are examples used consistently through this doc.

### 0. Prerequisites (first Azure App Service in this subscription)

```bash
az login
az account list --output table          # if you have more than one subscription
az account set --subscription <subscription-id>

# First-time-only per subscription: App Service won't provision until this
# resource provider is registered. A no-op (fast) if it already is —
# fresh subscriptions (Azure for Students included) sometimes haven't.
az provider register --namespace Microsoft.Web
az provider show --namespace Microsoft.Web --query registrationState
# wait until this prints "Registered" before continuing
```

### 1. Resource group, plan, and the two Web Apps

**Plan tier: B1, not the Free F1 tier.** This isn't a cost-optimization
choice — F1 (and the Shared/D1 tier) cannot run custom Docker containers at
all on Linux App Service; "Web App for Containers" requires **Basic tier or
higher**, full stop. Even setting that aside, F1 caps compute at ~60
minutes/day and has no "Always On" support, so it would sleep an API that
needs to answer redirects at any time. B1 is the cheapest tier that
actually supports this deployment model, and an Azure for Students grant
comfortably covers a single low-traffic B1 plan (check current pricing for
your region in the Azure pricing calculator — costs do change).

```bash
az group create -n linkforge-rg -l eastus

az appservice plan create -n linkforge-plan -g linkforge-rg \
  --is-linux --sku B1

az webapp create -n linkforge-api -g linkforge-rg -p linkforge-plan \
  --deployment-container-image-name ghcr.io/<owner>/linkforge-backend:latest

az webapp create -n linkforge-web -g linkforge-rg -p linkforge-plan \
  --deployment-container-image-name ghcr.io/<owner>/linkforge-frontend:latest
```

`<owner>` in the image name is your GitHub username/org **lowercased** —
GHCR (like every OCI registry) rejects uppercase in image names. The
deploy workflow handles this automatically (it lowercases
`github.repository_owner` before building any image reference), but when
typing these `az` commands by hand, lowercase it yourself.

This gives you two fixed URLs: `https://linkforge-api.azurewebsites.net` and
`https://linkforge-web.azurewebsites.net` (or your own custom domains,
configured separately in Azure).

### 2. App settings (backend)

Every variable `src/config/env.ts` reads, as production values — same
names as `.env.example`, real values instead of local-dev ones.
`WEBSITES_PORT` is Azure-specific: it tells the platform which port the
container listens on (the app itself still just reads `PORT`/defaults to
3000, same as anywhere else).

```bash
az webapp config appsettings set -n linkforge-api -g linkforge-rg --settings \
  WEBSITES_PORT=3000 \
  NODE_ENV=production \
  DATABASE_URL="<neon connection string>" \
  REDIS_URL="<upstash connection string>" \
  JWT_SECRET="<generate fresh: openssl rand -hex 32>" \
  PUBLIC_BASE_URL="https://linkforge-api.azurewebsites.net" \
  FRONTEND_ORIGIN="https://linkforge-web.azurewebsites.net" \
  ANALYTICS_ENABLED=true
```

Never reuse credentials that have appeared anywhere outside Azure's secret
storage (chat, a shared doc, a screenshot) — treat any such value as
already compromised and issue a fresh one.

### 3. App settings (frontend)

The frontend reads no runtime environment variables —
`NEXT_PUBLIC_API_URL` is inlined into the JS bundle at **build** time (see
`frontend/Dockerfile`), supplied by the GitHub Actions workflow, not by
Azure. Only the port needs setting here:

```bash
az webapp config appsettings set -n linkforge-web -g linkforge-rg --settings \
  WEBSITES_PORT=3001
```

### 4. GHCR package visibility

Azure needs to pull both images on every deploy. Making the GHCR packages
public removes the need for any registry credential on the Azure side —
appropriate here since the repo is already public/MIT-licensed and the
images carry no secrets (those are injected as App Settings above, never
baked into a layer).

Once each image has been pushed at least once (first workflow run):
GitHub → your profile → **Packages** → `linkforge-backend` /
`linkforge-frontend` → **Package settings** → **Change visibility** →
**Public**.

If you'd rather keep them private instead, Azure needs a durable pull
credential:

```bash
az webapp config container set -n linkforge-api -g linkforge-rg \
  --docker-registry-server-url https://ghcr.io \
  --docker-registry-server-user <github-username> \
  --docker-registry-server-password <PAT with read:packages>
# repeat for linkforge-web
```

### 5. GitHub → Azure authentication (OIDC, no stored secret)

The workflow authenticates via federated identity — GitHub mints a
short-lived OIDC token per run; Azure trusts it directly. No client secret
is ever generated or stored.

```bash
az ad app create --display-name linkforge-gha-deploy
# note the appId from the output as <app-id>

az ad sp create --id <app-id>

az ad app federated-credential create --id <app-id> --parameters '{
  "name": "linkforge-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:<owner>/linkforge:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'

az role assignment create --assignee <app-id> --role Contributor \
  --scope /subscriptions/<subscription-id>/resourceGroups/linkforge-rg
```

The federated credential's `subject` is scoped to `ref:refs/heads/main` —
only workflow runs triggered from `main` can assume this identity, not
every branch or PR.

### 6. GitHub repository secrets and variables

**Settings → Secrets and variables → Actions**

| Name | Kind | Value |
|---|---|---|
| `AZURE_CLIENT_ID` | Secret | the `<app-id>` from step 5 |
| `AZURE_TENANT_ID` | Secret | `az account show --query tenantId -o tsv` |
| `AZURE_SUBSCRIPTION_ID` | Secret | `az account show --query id -o tsv` |
| `AZURE_BACKEND_APP_NAME` | Variable | `linkforge-api` |
| `AZURE_FRONTEND_APP_NAME` | Variable | `linkforge-web` |
| `NEXT_PUBLIC_API_URL` | Variable | `https://linkforge-api.azurewebsites.net/api/v1` |

None of these three secrets are themselves long-lived credentials capable
of acting outside GitHub Actions — the federated-credential trust is what
grants access, scoped to this repo and this branch.

### 7. GitHub Environment (production)

Both `deploy-backend` and `deploy-frontend` target a GitHub Environment
named `production` (`environment: production` in `deploy.yml`). GitHub
auto-creates it on the first run that references it, with no protection
rules, so nothing breaks if you skip this step. Optionally, for an extra
safety gate before anything touches the live app:

**Settings → Environments → New environment → `production`** → add
yourself as a **required reviewer**. Every deploy then pauses for manual
approval before running — worth it once real users depend on this.

## Ongoing deploys

`.github/workflows/deploy.yml` runs automatically whenever the `CI`
workflow succeeds on `main`: builds both images, pushes them to GHCR
tagged `latest` and with the commit SHA, points each Azure Web App at its
SHA-tagged image (never `:latest` — an explicit, immutable tag per deploy
is auditable and avoids relying on Azure's polling for a moving tag), then
polls that app's own health endpoint until it responds before the job is
considered successful. `workflow_dispatch` is available for a manual
re-run with no new commit (e.g. after changing an App Setting).

Only one deploy runs at a time (`concurrency: group: azure-deploy,
cancel-in-progress: true`) — if a second commit lands while the first
commit's deploy is still running, the first run is cancelled outright
rather than left to potentially finish *after* the second and overwrite it
with an older image.

Database migrations run inside the backend container's `CMD` on every
boot (`prisma migrate deploy && node dist/server.js`, already in
`Dockerfile`) — a documented no-op when the schema is already current, and
safe under concurrent boots since `migrate deploy` takes its own advisory
lock. No separate migration step needed in the deploy workflow.

If a deploy job fails at the "Verify ... is healthy" step, the image was
pushed and pointed at successfully but the app never came up — check
`az webapp log tail -n <app-name> -g linkforge-rg` for the actual boot
error (commonly a missing/wrong App Setting, or the database being
unreachable).
