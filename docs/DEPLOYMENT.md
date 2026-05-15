# 🚀 Deployment Guide

> AgentRoot is designed to run locally by default, but you can also deploy the Python agents to the cloud. This guide covers all deployment options.

---

## Deployment Options

```mermaid
flowchart LR
    A[AgentRoot] --> B[Local Only]
    A --> C[BYOK Cloud]
    A --> D[Azure AI Foundry]

    B --> B1[SQLite + Ollama]
    C --> C1[Local UI + Cloud LLMs]
    D --> D1[Hosted Python Agents]
```

---

## Option 1: Local Only (Default)

The simplest and most private deployment.

### Stack
- **Frontend:** Next.js 15 on `127.0.0.1:3000`
- **Database:** SQLite (`prisma/dev.db`)
- **LLM:** Ollama on `127.0.0.1:11434`
- **Agents:** None (pure Node.js backend)

### Setup

```bash
git clone https://github.com/joecapella/agentroot.git
cd agentroot
npm install
npm run db:migrate
npm run dev
```

> [!TIP]
> This is the recommended setup for personal use. Zero cloud dependencies, zero data leaving your machine.

---

## Option 2: BYOK Cloud Keys

Keep the local UI and database, but use cloud LLMs for more power.

### Supported Providers

| Provider | Models | Key Format |
|:---|:---|:---|
| **OpenAI** | GPT-4o, GPT-4o-mini, DALL-E | `sk-...` |
| **Anthropic** | Claude 3.5 Sonnet | Direct API key |
| **Gemini** | Gemini 2.0 Flash | Direct API key |
| **Azure OpenAI** | GPT-4, GPT-3.5 | Deployment-specific |

### Setup

1. Go to **Settings → API Keys**
2. Paste your provider key
3. Click **Test** to validate
4. The chat will now route to cloud models when Ollama is not selected

> [!IMPORTANT]
> Keys are stored in browser localStorage only. They are sent per-request and never persisted on the server.

### Model Routing with BYOK

When you provide keys, AgentRoot automatically routes:

```
User has OpenAI key:
  → Chat: GPT-4o (byok-openai-chat)
  → Fast tasks: GPT-4o-mini (byok-openai-mini)
  → Images: DALL-E (byok-openai-image)

User has Anthropic key:
  → Chat: Claude 3.5 Sonnet (byok-anthropic)

User has Gemini key:
  → Chat: Gemini 2.0 Flash (byok-gemini)
```

Override any of this in **Settings → Models & Routing**.

---

## Option 3: Azure AI Foundry (Hosted Agents)

Deploy the Python agents as containers to Azure AI Foundry for enterprise-grade hosting.

### Prerequisites

- Azure subscription
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/)
- Docker

### Architecture

```mermaid
flowchart TB
    subgraph Local["Your Machine"]
        UI["Next.js UI"]
        DB[(SQLite)]
    end

    subgraph Azure["Azure Cloud"]
        Foundry["Azure AI Foundry"]
        Cofounder["CofounderAgent Container"]
        Calculator["CalculatorAgent Container"]
        ACR["Azure Container Registry"]
    end

    UI --> Foundry
    Foundry --> Cofounder
    Foundry --> Calculator
    ACR --> Cofounder
    ACR --> Calculator
```

### Deploy Steps

#### 1. Configure Environment

```bash
# Copy the example env file
cp .env.example .env

# Fill in required values:
# AZURE_AI_PROJECT_ENDPOINT=https://.../
# COFOUNDER_AGENT_NAME=CofounderAgent
```

#### 2. Bake Persona Prompts

```bash
# Sync local prompt edits to the container snapshot
cp agent-config/*.prompt.md src/CofounderAgent/prompts/
```

#### 3. Provision Infrastructure

```bash
azd provision
```

This creates:
- Azure AI Foundry project
- Azure Container Registry
- Managed identity for authentication

#### 4. Build and Push Containers

```bash
# CofounderAgent
cd src/CofounderAgent
docker build -t agentroot-cofounder .
docker tag agentroot-cofounder $ACR_LOGIN_SERVER/agentroot-cofounder
docker push $ACR_LOGIN_SERVER/agentroot-cofounder

# CalculatorAgent
cd src/CalculatorAgent
docker build -t agentroot-calculator .
docker tag agentroot-calculator $ACR_LOGIN_SERVER/agentroot-calculator
docker push $ACR_LOGIN_SERVER/agentroot-calculator
```

#### 5. Deploy Agents

```bash
azd deploy
```

#### 6. Configure Local UI

Update `.env`:

```bash
AZURE_AI_PROJECT_ENDPOINT=https://your-project.eastus.api.azureml.ms/
COFOUNDER_AGENT_NAME=CofounderAgent
```

Restart the dev server:

```bash
npm run dev
```

### Full One-Command Deploy

```bash
cp agent-config/*.prompt.md src/CofounderAgent/prompts/ && azd up
```

> [!NOTE]
> `azd up` runs `provision` + `deploy` in sequence. Use it for iterative deployments.

---

## Environment Variables Reference

| Variable | Local Only | BYOK | Foundry |
|:---|:---|:---|:---|
| `DATABASE_URL` | Required | Required | Required |
| `REPO_ROOT` | Recommended | Recommended | Recommended |
| `AZURE_AI_PROJECT_ENDPOINT` | — | — | Required |
| `COFOUNDER_AGENT_NAME` | — | — | Required |
| `OLLAMA_ENDPOINT` | Optional | Optional | Optional |
| `MODEL_DEPLOYMENT_*` | — | Optional | Optional |
| `GEMINI_ENDPOINT` | — | Optional | — |
| `GEMINI_API_KEY` | — | Optional | — |

---

## Database Migration (SQLite → Postgres)

For production deployments, migrate from SQLite to Postgres:

### 1. Update Schema

Edit `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### 2. Run Migration

```bash
npx prisma migrate deploy
```

### 3. Update Environment

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/agentroot
```

> [!WARNING]
> SQLite uses `TEXT` for enums. Postgres supports native enums. Test thoroughly after migration.

---

## Docker Compose (Full Stack)

For a containerized local deployment:

```yaml
# docker-compose.yml
version: "3.8"
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=file:./dev.db
      - REPO_ROOT=/app
    volumes:
      - ./:/app
      - /app/node_modules

  ollama:
    image: ollama/ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama:/root/.ollama

volumes:
  ollama:
```

Run:

```bash
docker-compose up
```

---

## Reverse Proxy / HTTPS

For LAN or remote access, put AgentRoot behind a reverse proxy:

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name agentroot.local;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Caddy

```caddy
agentroot.local {
    reverse_proxy 127.0.0.1:3000
}
```

> [!WARNING]
> Always use HTTPS when exposing AgentRoot beyond localhost. The local auth shim provides no protection against network attackers.

---

## Monitoring & Logs

### Local Logs

```bash
# Next.js logs
npm run dev 2>&1 | tee agentroot.log

# Ollama logs
ollama serve 2>&1 | tee ollama.log
```

### Production Monitoring

For hosted deployments:
- Enable Application Insights in Azure
- Configure log aggregation (Datadog, Grafana, etc.)
- Set up alerting for error rates

---

## Troubleshooting

### "Cannot connect to Foundry endpoint"

```bash
# Verify endpoint
azd env get-values | grep ENDPOINT

# Check agent status
azd show
```

### "Container fails to start"

```bash
# Check logs
azd logs --service CofounderAgent

# Rebuild
cd src/CofounderAgent && docker build --no-cache -t agentroot-cofounder .
```

### "Model not found"

```bash
# List available deployments
az ml online-endpoint list

# Check model routing
npm run dev  # and check server logs for routing decisions
```

---

## Further Reading

- [Architecture Guide](ARCHITECTURE.md) — System design
- [Security Guide](SECURITY.md) — Threat model and hardening
- [Azure AI Foundry Docs](https://learn.microsoft.com/en-us/azure/ai-foundry/)
- [Azure Developer CLI Docs](https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/)
