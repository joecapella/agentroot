# CofounderAgent

Personal cofounder assistant built on Microsoft Foundry hosted agents
(`CofounderAgent` in project `plimsoll`) with a Next.js 15 chat UI, Prisma
persistence, and a minimal low-risk tool surface.

## Security model — read this first

This is a **single-user local application**. It is not designed for
multi-user, public, or LAN deployment.

- **Auth boundary**: local-only mode intentionally has no login/session/CSRF
  ceremony. Routes still call `requireAuth()` so ownership is centralized and
  a hosted mode can reintroduce real auth behind the same interface.
- **Network boundary**: `npm run dev` and `npm start` bind to `127.0.0.1`
  only. To expose on the LAN intentionally, use `npm run dev:lan` (you should
  not, unless you understand what that means).
- **Identity**: the server hardcodes `SERVER_USER_ID = "joseph"` and derives
  the owner of every conversation/task/message from the authenticated
  principal. The API never accepts `userId` from clients.
- **Tools**: only `open_url` (two-step approval) and `create_todo` are wired.
  `run_command`, host-OS `screenshot`, and `write_file` outside the repo are
  intentionally not implemented.

If you copy this repo to any environment that is not your own laptop, you
must rethink the auth model first.

## Required env vars

| Var | Required | Notes |
|---|---|---|
| `AZURE_AI_PROJECT_ENDPOINT` | yes | Auto-set by `azd env get-values`. |
| `COFOUNDER_AGENT_NAME` | yes | Default `CofounderAgent`. |
| `DATABASE_URL` | yes | Defaults to `file:./dev.db`. |

## First run

```bash
npm install
npx prisma migrate dev --name init_chat_schema     # only first time
npm run dev
# open http://127.0.0.1:3000
```

## Project layout

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

## API contract

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

## Repository

This repository is prepared for publishing on GitHub. It includes a permissive
MIT license and contribution guidelines to make it easy for others to review
and contribute. After publishing the repository, the `main` branch will be
used as the default protected branch for releases and CI.

- Repository name: `agentroot`
- Visibility: public

For contribution instructions and the code of conduct, see [CONTRIBUTING](CONTRIBUTING.md)
and [CODE_OF_CONDUCT](CODE_OF_CONDUCT.md).
