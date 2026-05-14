# 🤖 AgentRoot

> **The open-source Claude Code killer.**  
> Your private, extensible AI coworker that lives in your repo.  
> **Bring Your Own Key (BYOK)** • Fully local-first • Multi-agent • Infinite personas.

<p align="center">
  <a href="https://github.com/joecapella/agentroot/stargazers"><img src="https://img.shields.io/github/stars/joecapella/agentroot?style=social" alt="Stars"></a>
  <a href="https://github.com/joecapella/agentroot/network/members"><img src="https://img.shields.io/github/forks/joecapella/agentroot?style=social" alt="Forks"></a>
  <a href="https://github.com/joecapella/agentroot/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/joecapella/agentroot/ci.yml?style=flat-square&logo=github" alt="CI"></a>
  <a href="https://github.com/joecapella/agentroot/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="MIT License"></a>
  <a href="https://github.com/joecapella/agentroot/issues"><img src="https://img.shields.io/github/issues/joecapella/agentroot?style=flat-square" alt="Issues"></a>
  <img src="https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js" alt="Next.js">
  <img src="https://img.shields.io/badge/Python-3.11-blue?style=flat-square&logo=python" alt="Python">
</p>

<p align="center">
  <b>The next-generation AI pair programmer that actually respects your privacy and your stack.</b><br>
  <i>Claude Code was the beginning. AgentRoot is the revolution.</i>
</p>

---

## 🔥 Why AgentRoot?

| Feature                    | Claude Code / Cursor       | Aider / Devin             | **AgentRoot**                          |
|---------------------------|----------------------------|---------------------------|----------------------------------------|
| **Privacy**               | Cloud-only                 | Local but limited         | ✅ Fully local + BYOK (zero data leak) |
| **Extensibility**         | Closed                     | Limited                   | ✅ Pluggable agents, custom personas   |
| **Multi-agent**           | Single model               | Single agent              | ✅ Cofounder + Calculator + your own   |
| **Persona System**        | Basic                      | None                      | ✅ 5 built-in + infinite custom        |
| **Tool Safety**           | Ask every time             | Risky                     | ✅ Two-step approval + rollback        |
| **Memory & Context**      | Session only               | Git only                  | ✅ Persistent facts, projects, memory  |
| **Open Source**           | ❌                         | ✅                        | ✅ Fully open + welcoming community    |

**AgentRoot isn't just another wrapper.**  
It's a full-stack AI development platform you can fork, extend, and run on your laptop today.

## ✨ Killer Features

- 🧠 **CofounderAgent** — Your always-on strategic partner with LangGraph state machines
- 🎭 **Infinite Personas** — Brand Designer, Code Assistant, Ops Agent, Vision Agent, and you can add your own in 2 minutes
- 🔑 **True BYOK** — Your API keys, your models, your cost, your privacy
- 🛡️ **Safe Tools** — Only `open_url` and `create_todo` enabled by default. Everything else requires explicit approval
- 🧩 **Pluggable Architecture** — Drop in new Python agents or TypeScript tools in minutes
- 📊 **Built-in Memory Layer** — Persistent facts, project workspaces, rollback snapshots
- ⚡ **Next.js 15 + Foundry** — Blazing fast UI powered by Microsoft Foundry hosted agents

## 🚀 Get Started in 60 Seconds

```bash
# 1. Clone
git clone https://github.com/joecapella/agentroot.git && cd agentroot

# 2. Install
npm install

# 3. Database
npx prisma migrate dev

# 4. Run
npm run dev

# 5. Open http://127.0.0.1:3000
```

**That's it.** No cloud signup. No data leaving your machine. Just pure AI firepower.

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
