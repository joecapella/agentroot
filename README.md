# 🤖 AgentRoot

> **The open-source local Claude Code.**  
> Run any Ollama model, any Hugging Face model, or bring your own cloud keys.  
> Fully private • Multi-agent • Infinite personas • Built for developers who want control.

<p align="center">
  <a href="https://github.com/joecapella/agentroot/stargazers"><img src="https://img.shields.io/github/stars/joecapella/agentroot?style=social" alt="Stars"></a>
  <a href="https://github.com/joecapella/agentroot/network/members"><img src="https://img.shields.io/github/forks/joecapella/agentroot?style=social" alt="Forks"></a>
  <a href="https://github.com/joecapella/agentroot/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/joecapella/agentroot/ci.yml?style=flat-square&logo=github" alt="CI"></a>
  <a href="https://github.com/joecapella/agentroot/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="MIT License"></a>
  <a href="https://github.com/joecapella/agentroot/issues"><img src="https://img.shields.io/github/issues/joecapella/agentroot?style=flat-square" alt="Issues"></a>
  <img src="https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js" alt="Next.js">
  <img src="https://img.shields.io/badge/Python-3.11-blue?style=flat-square&logo=python" alt="Python">
  <img src="https://img.shields.io/badge/Ollama-supported-green?style=flat-square&logo=ollama" alt="Ollama">
</p>

<p align="center">
  <b>The first truly local, fully open-source Claude Code alternative.</b><br>
  <i>Claude Code was the beginning. AgentRoot is what comes next — on your machine, your models, your rules.</i>
</p>

---

## 🔥 Why AgentRoot Wins for Local-First Developers

| Feature                    | Claude Code / Cursor       | Aider / Devin             | **AgentRoot (Local Mode)**                  |
|---------------------------|----------------------------|---------------------------|---------------------------------------------|
| **True Local LLMs**       | ❌ Cloud only              | Limited                   | ✅ Ollama + Hugging Face + any OpenAI-compatible |
| **Privacy**               | Cloud-only                 | Local but limited         | ✅ 100% local by default, zero telemetry     |
| **Model Freedom**         | Locked to Anthropic        | Limited                   | ✅ Any model you can run locally or via API  |
| **Multi-Agent**           | Single model               | Single agent              | ✅ Cofounder + Calculator + your own agents  |
| **Persona System**        | Basic                      | None                      | ✅ 5 built-in + infinite custom personas     |
| **Tool Safety**           | Ask every time             | Risky                     | ✅ Two-step approval + full rollback         |
| **Memory Layer**          | Session only               | Git only                  | ✅ Persistent facts, projects, rollback      |
| **Fully Open Source**     | ❌                         | ✅                        | ✅ MIT licensed + welcoming community        |

**This is the real deal.**  
A complete, production-grade, local-first AI coding platform you can fork today.

## ✨ Killer Local-First Features

- 🦙 **Ollama Native** — Run `llama3`, `codellama`, `deepseek-coder`, `qwen2.5-coder` etc. with zero config
- 🤗 **Hugging Face Support** — Drop in any GGUF model or use the HF Hub directly
- 🎭 **Infinite Personas** — Code Assistant, Architect, Debugger, Security Reviewer, and you create new ones in minutes
- 🧠 **CofounderAgent** — LangGraph-powered strategic partner that remembers your whole project
- 🛡️ **Safe-by-Default Tools** — Only safe actions enabled until you explicitly approve
- 📦 **Pluggable Everything** — Add new agents, tools, or even new frontends
- ⚡ **Next.js 15 + Prisma** — Blazing fast local UI with persistent memory

## 🚀 Get Started in 90 Seconds (100% Local)

```bash
# 1. Clone & install
git clone https://github.com/joecapella/agentroot.git && cd agentroot
npm install

# 2. Install Ollama (if you don't have it)
curl -fsSL https://ollama.com/install.sh | sh

# 3. Pull your favorite coding model
ollama pull qwen2.5-coder:14b     # or llama3.1, deepseek-coder, etc.

# 4. Start AgentRoot
npm run dev

# 5. Open http://127.0.0.1:3000
```

**No API keys. No signups. No data leaving your laptop.**

Want to use cloud models later? Just drop in your OpenAI/Anthropic/Azure keys in Settings — BYOK is fully supported.

## 🦙 Local LLM Setup Guide

### Recommended Models (Tested & Fast)

| Model                    | Size   | Best For                     | Command                          |
|--------------------------|--------|------------------------------|----------------------------------|
| `qwen2.5-coder:14b`      | 14B    | Best overall coding          | `ollama pull qwen2.5-coder:14b`  |
| `deepseek-coder-v2:16b`  | 16B    | Complex reasoning            | `ollama pull deepseek-coder-v2`  |
| `codellama:34b`          | 34B    | Large codebases              | `ollama pull codellama:34b`      |
| `llama3.1:70b`           | 70B    | Best quality (needs GPU)     | `ollama pull llama3.1:70b`       |
| `phi3:medium`            | 14B    | Lightweight & fast           | `ollama pull phi3:medium`        |

### Using Hugging Face Models

```bash
# Download any GGUF model from Hugging Face
ollama pull hf.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF

# Or use the Hugging Face Hub directly in Settings
```

### Switching Models

Just change the model name in **Settings → Model** and AgentRoot will instantly use it. No restart needed.

---



---

## Table of Contents

- [Security Model](#security-model--read-this-first)
- [Getting Started](#getting-started)
- [Architecture](#architecture)
- [API Reference](#api-contract)
- [Development](#development)
- [Contributing](#contributing)

## 🛡️ Security & Privacy (Local-First by Design)

AgentRoot is **intentionally single-user and local-only** in v1.

- No cloud accounts, no telemetry, no data exfiltration
- All API calls go directly from your machine using **your keys**
- Tool execution is heavily gated (two-step approval + rollback)
- Perfect for sensitive codebases, startups, and paranoid engineers

> **Want a hosted multi-user version?** Open an issue — the architecture is ready.

## Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────┐
│  Next.js 15 Frontend (App Router)               │
│  ├─ /app: React components, API routes          │
│  └─ /app/components: UI (Chat, Settings, etc.)  │
├─────────────────────────────────────────────────┤
│  Node.js Backend (Express-like API handlers)    │
│  ├─ foundryClient.ts: Agent communication       │
│  ├─ auth.ts: Single-user access control         │
│  └─ /src/server/*: Business logic               │
├─────────────────────────────────────────────────┤
│  Prisma ORM → SQLite (local dev)                │
│  └─ Conversations, Messages, Tasks, Facts       │
├─────────────────────────────────────────────────┤
│  Python Agent (CofounderAgent)                  │
│  └─ LangGraph state machine with persona routing│
└─────────────────────────────────────────────────┘
```

### Project Layout

```
src/CofounderAgent/    # Hosted Foundry agent (Python, LangGraph)
  agent.yaml           # Foundry hosted-agent manifest
  main.py              # LangGraph state machine; [persona:...] routing
  model_routing.py     # Logical→deployment mapping (mirrors src/modelRouting.ts)
  prompts/             # Baked persona prompts (synced from agent-config/)

agent-config/          # Canonical persona prompts (editable via Settings UI)

src/
  foundryClient.ts     # Responses-protocol client (DefaultAzureCredential)
  modelRouting.ts      # TS twin of model_routing.py
  prisma.ts            # Prisma singleton
  server/
    auth.ts            # requireAuth(), requireSameOriginHeader(), SERVER_USER_ID
    errors.ts          # sanitizedError(), runRoute()

app/                   # Next.js App Router
  page.tsx             # Shell — composes the components below
  layout.tsx, globals.css
  components/          # Sidebar / MessageThread / ChatInput / Activity / Settings
  lib/                 # apiClient.ts, hooks.ts, types.ts
  api/                 # Route handlers (local-only; ownership still enforced)
    chat/, conversations/[id]/, tasks/, settings/
    tools/create_todo/, tools/open_url/, tools/open_url/approve/[taskId]/

prisma/schema.prisma   # Conversation / Message / Task
tools/openapi.yaml     # OpenAPI 3.1 spec for the v1 tool surface
azure.yaml             # azd config — declares CalculatorAgent + CofounderAgent
```

## Development

### Running Tests

```bash
npm test                  # Run all tests
npm run test:watch       # Watch mode
npm run lint             # ESLint
```

Tests cover:
- API ownership/auth regressions
- Tool execution and approval flows
- Conversation state management
- Database migrations

### Making Changes

1. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make changes** and run tests:
   ```bash
   npm test
   npm run lint
   ```

3. **Commit with conventional messages** (`feat:`, `fix:`, `chore:`):
   ```bash
   git commit -m "feat: add BYOK API key management"
   ```

4. **Push and open a PR** to `main`:
   ```bash
   git push origin feat/my-feature
   ```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

## API Contract

This is a local-only single-user app. API routes do not require login,
sessions, bearer tokens, or CSRF headers. Server code still derives ownership
from the constant local principal (`SERVER_USER_ID`) and returns 404 for rows
that do not belong to that principal.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/conversations` | Scoped to the authenticated user. |
| POST | `/api/conversations` | Creates a conversation owned by the user. |
| GET | `/api/conversations/[id]` | 404 if not owner. |
| DELETE | `/api/conversations/[id]` | Atomic deleteMany filtered by owner. |
| POST | `/api/chat` | conversationId optional; ownership verified. |
| GET | `/api/tasks` | Scoped via owning conversation. |
| GET | `/api/settings` | Returns whitelisted prompt files only. No `dir`. |
| PUT | `/api/settings` | Whitelisted filename + 200KB cap. |
| POST | `/api/tools/create_todo` | Owner check when conversationId provided. |
| POST | `/api/tools/open_url` | Creates `AWAITING_APPROVAL` task; does NOT open. |
| POST | `/api/tools/open_url/approve/[taskId]` | Approves + spawns `xdg-open`. |

Error responses are always `{ error: <code>, requestId?: <uuid> }`. Look up
the request id in server logs for detail.

## Persona prompts

The `agent-config/*.prompt.md` files are the canonical source. The hosted
agent container has a baked snapshot under `src/CofounderAgent/prompts/`.
Editing prompts via the Settings UI updates `agent-config/`; redeploy with
`azd up` to refresh the snapshot in the container (a `bash -c "cp
agent-config/*.prompt.md src/CofounderAgent/prompts/ && azd up"` workflow).

## Tests

```bash
npm test
```

Auth and ownership tests cover the regressions caught by the Control Agent
reviews:

- Local compatibility endpoints are open no-ops by design.
- `/api/conversations/[id]` returns 404 (not 403) when another user's id is
  requested — no enumeration leak.
- `/api/tools/open_url` never opens a URL on its own — only the approve route
  spawns the host process.

See `tests/api.test.ts`.

---

## 🌍 Join the Movement — Become a Core Contributor

We're building the **open-source standard for private AI development**.

### Ways to Help (All Welcome)

| Role                    | What You Can Do                                      | Impact Level |
|-------------------------|------------------------------------------------------|--------------|
| **Code**                | Add new agents, improve tool safety, fix bugs        | 🔥 High      |
| **Prompt Engineering**  | Create amazing personas in `agent-config/`           | 🔥 High      |
| **Docs & Examples**     | Write tutorials, improve README, create demos        | ⭐ Medium    |
| **Testing & QA**        | Break things, file great issues, improve CI          | ⭐ Medium    |
| **Design & UX**         | Make the Next.js UI even more delightful             | ✨ Fun       |

### Quick Contribution Flow

```bash
git checkout -b feat/my-killer-feature
# ... code ...
npm test && npm run lint
git commit -m "feat: add my killer feature"
git push origin feat/my-killer-feature
# Open PR — we'll review fast
```

**First-time contributors:** Issues labeled `good first issue` are perfect starting points.

### We Reward Contributors

- 🌟 Shoutouts in release notes
- 🏆 "AgentRoot Hero" badge on your profile
- 🚀 Fast-track to maintainer status for consistent contributors

**Ready to ship?** Star the repo, open an issue with your idea, or just send a PR.

---

**Built with ❤️ by developers who believe AI should empower, not lock us in.**

<p align="center">
  <a href="https://github.com/joecapella/agentroot">⭐ Star AgentRoot on GitHub</a> • 
  <a href="https://github.com/joecapella/agentroot/issues/new?template=feature_request.yml">💡 Request a Feature</a> • 
  <a href="https://github.com/joecapella/agentroot/discussions">💬 Join the Discussion</a>
</p>
