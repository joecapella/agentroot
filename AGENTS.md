# AgentRoot — Agent Guide

> This file is written for AI coding agents. It assumes you know nothing about the project. Read it before making changes.

## Project Overview

AgentRoot is a local-first, open-source AI coding assistant — a self-hosted alternative to Claude Code. It runs entirely on the user's machine by default (Ollama), with optional cloud model support via bring-your-own-key (BYOK).

The project has two halves:

1. **Next.js UI + Node backend** — Chat interface, conversation memory, tool execution, ReAct loop, and multi-provider model routing.
2. **Python hosted agents** — `CofounderAgent` (LangGraph-based strategic partner with persona routing) and `CalculatorAgent` (simple math tool), packaged as Docker containers for Microsoft Foundry.

The intended user is Joseph (single-user, local-only in v1). All data ownership checks resolve to the constant `SERVER_USER_ID = "joseph"`.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript 5.7 |
| Styling | Plain CSS (`app/globals.css`), inline styles object (`app/components/styles.ts`) |
| Backend | Next.js API routes (Node runtime), Express-like handlers |
| ORM / DB | Prisma 6 + SQLite (`prisma/dev.db`) |
| Test runner | Node.js built-in test runner (`node:test`) via `tsx` |
| Coverage | `c8` (lcov + text-summary) |
| Lint | ESLint 9 + `eslint-config-next` (flat config in `eslint.config.mjs`) |
| Type check | `next typegen && tsc --noEmit` |
| Python agents | Python 3.11, LangGraph, LangChain, `azure-ai-agentserver-langgraph` |
| Deployment | Azure Developer CLI (`azd`), Bicep infra, Azure AI Foundry hosted agents |
| Local LLMs | Ollama (browser calls `127.0.0.1:11434` directly) |

---

## Project Structure

```
agent-config/           # Canonical persona prompts (*.prompt.md)
                        # Edited via Settings UI; baked into containers at build time

app/
  api/                  # Next.js App Router API routes
    chat/               # POST /api/chat (SSE stream) + finalize
    conversations/      # CRUD for chat threads
    tools/              # open_url, create_todo, execute
    settings/           # Prompt file read/write
    ...                 # approvals, facts, files/search, plans, profile, projects, etc.
  components/           # React UI components (ChatInput, MessageThread, SettingsPanel, etc.)
  lib/                  # Client-side utilities
    apiClient.ts        # Thin fetch wrapper
    hooks.ts            # React hooks (useSendMessage, useConversations, etc.)
    ollamaClient.ts     # Browser-side Ollama chat client
    sse.ts              # SSE parsing helper
    types.ts            # Shared client/UI types
  page.tsx              # Main shell — composes all panels
  layout.tsx            # Root layout
  globals.css           # Global styles

infra/                  # Bicep templates for Azure deployment
  main.bicep
  main.parameters.json

prisma/
  schema.prisma         # SQLite schema (Conversations, Messages, Tasks, Facts, etc.)
  migrations/           # Prisma migration files
  dev.db                # Local development database
  test.db               # Test database

scripts/                # Ad-hoc test scripts (image generation probes, etc.)

src/
  CalculatorAgent/      # Simple math agent container (Dockerfile, main.py, agent.yaml)
  CofounderAgent/       # Strategic partner agent container
    main.py             # LangGraph state machine + persona routing
    model_routing.py    # Logical model → deployment mapping (Python side)
    prompts/            # Baked snapshot of agent-config/ (copied at build)
    tests/              # Python unit tests
  foundryClient.ts      # Hosted-agent client (Responses protocol, DefaultAzureCredential)
  modelRouting.ts       # TypeScript twin of model_routing.py — MUST stay in sync
  memory.ts             # Memory layer (facts, profiles, workspaces)
  prisma.ts             # Shared PrismaClient singleton (warn/error logs only)
  server/
    auth.ts             # Local-only auth shim (constant user)
    errors.ts           # sanitizedError(), runRoute() wrappers
    agentLoop.ts        # ReAct loop engine (tool execution, approval gating)
    llmRouter.ts        # Unified dispatch to Foundry / OpenAI / Anthropic
    directProviders.ts  # Direct OpenAI, Anthropic, Gemini invokers
    fsTools.ts          # read_file, write_file, search_replace, rollback
    shellTools.ts       # run_command with command policy
    webTools.ts         # fetch_url
    codeSearch.ts       # grep, find_files
    gitTools.ts         # git_status, git_diff, git_log, etc.
    factExtractor.ts    # [MEMORY_FACT] extraction and redaction
    secretsPolicy.ts    # Secret redaction in model output
    toolsSchema.ts      # Tool schema converters (Responses vs Chat Completions)
    personaPrompts.ts   # Hot-loaded persona prompt composer
    ...                 # analytics, calendar, cicd, loopSafety, tokenTracker, etc.

tests/
  api.test.ts           # API integration/regression tests (auth, ownership, tools)
  chat.test.ts          # Chat route tests
  chatFinalize.test.ts  # Finalize endpoint tests
  filesSearch.test.ts   # File search tests
  unit.test.ts          # Pure unit tests (foundryClient, modelRouting, no DB/network)
  components/           # React component tests
  unit/                 # Additional unit tests

tools/
  openapi.yaml          # OpenAPI 3.1 spec for the v1 tool surface

azure.yaml              # azd manifest (declares CalculatorAgent + CofounderAgent services)
next.config.mjs         # Next.js config (typedRoutes, outputFileTracing excludes)
package.json            # npm scripts and dependencies
```

---

## Build, Dev & Test Commands

```bash
# Development server (localhost only)
npm run dev              # next dev -H 127.0.0.1
npm run dev:lan          # next dev -H 0.0.0.0

# Production build
npm run build            # next build

# Database
npm run db:migrate       # prisma migrate dev
npm run db:studio        # prisma studio
npm run db:generate      # prisma generate

# Quality gates
npm run typecheck        # next typegen && tsc --noEmit
npm run lint             # eslint .

# Tests
npm test                 # node --import tsx --test --test-concurrency=1
npm run test:coverage    # c8 coverage report
```

**CI gates** (from `.github/workflows/ci.yml`):
- `npm run lint` + `tsc --noEmit` on Node 18.x and 20.x
- `npm test -- --coverage` on Node 18.x and 20.x (with `DATABASE_URL=file:./test.db`)
- `npm run build` on Node 20.x (`SKIP_ENV_VALIDATION=true`)
- Python lint (`black --check`, `pylint --disable=all --enable=E,F`) on Python 3.10 and 3.11

---

## Code Style Guidelines

- **TypeScript**: strict mode enabled. Target ES2022. Module resolution `"bundler"`.
- **Imports**: Use `@/*` path alias for project-relative imports (e.g., `@/src/prisma`).
- **File naming**: API routes use Next.js App Router convention (`route.ts`). Server utilities use `camelCase.ts`. React components use `PascalCase.tsx`.
- **Exports**: Named exports preferred; default exports for page/layout components.
- **Python**: Black formatter. Requirements pinned explicitly (notably `azure-ai-agentserver-core==1.0.0b3` and `starlette<1.0`).
- **Comments**: JSDoc for public functions. Inline comments for security decisions, bug fixes, and date-stamped notes (e.g., `Bug-7`, `2026-05-12`).
- **Logging**: Never enable Prisma query logging. `src/prisma.ts` logs only `warn`/`error`. Never log API keys, tokens, or request bodies containing secrets.

---

## Testing Instructions

Tests use Node.js native test runner (`node:test`) imported via `tsx`. No Jest, no Vitest.

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage
```

Test isolation rules:
- `tests/api.test.ts` spins up a real Prisma client against `test.db`. It runs `prisma migrate deploy` in a `before` hook.
- `tests/unit.test.ts` is pure unit — no DB, no network. It patches `process.env` before importing modules that read env vars at load time.
- Never let unit tests reach the real Azure SDK. Intercept `globalThis.fetch` or use the `__setTestToken` hook in `foundryClient.ts`.
- ESM modules loaded by `tsx` do NOT respond to `require.cache` patching.

---

## Security & Privacy Model

**Local-first by design** (v1):
- Single user (Joseph). No login, no sessions, no bearer tokens, no CSRF headers.
- API routes still call `requireAuth(req)` so a future hosted mode can reintroduce real auth behind the same names. Today it returns the constant local principal.
- Ownership checks return **404** (not 403) for rows not belonging to `SERVER_USER_ID` to prevent enumeration leaks.

**Error handling**:
- Clients see only `{ error: <stable_code>, requestId?: <uuid> }`.
- Full detail (stack, upstream body, paths) is logged server-side only under the request id.

**Tool safety**:
- Two-step approval for destructive tools (`write_file`, `run_command`, `open_url`, etc.).
- Path traversal protection: all filesystem tools use `validatePath()` with `realpathSync`-based `isInsideRoot` checks.
- Shell metachar blocking in `commandPolicy.ts` (`;`, `&&`, `||`, backticks, `$()`, subshells).
- Secret redaction BEFORE persisting assistant messages to the database.

**BYOK keys**:
- Arrive in-memory per request, never persisted, never logged, never echoed to the client.
- Bounded to 256 chars each. Validated by provider APIs.

---

## Deployment & Infrastructure

**Azure AI Foundry (hosted agents)**:
- Deployed via `azd up` using `azure.yaml`.
- Two services: `CalculatorAgent` and `CofounderAgent`, both `host: azure.ai.agent`.
- Bicep infra lives in `infra/`.
- The Foundry project is `plimsoll-resource`.
- Token audience for Foundry: `https://ai.azure.com/.default`.
- Token audience for Azure OpenAI image generation: `https://cognitiveservices.azure.com/.default`.

**Persona prompt deployment flow**:
1. Canonical prompts live in `agent-config/*.prompt.md`.
2. Edits via Settings UI update `agent-config/` directly.
3. To refresh the deployed agent, copy to the container snapshot and redeploy:
   ```bash
   cp agent-config/*.prompt.md src/CofounderAgent/prompts/ && azd up
   ```

**Local-only frontend**:
- Next.js dev server on `127.0.0.1:3000`.
- Ollama calls go directly from the browser to `127.0.0.1:11434`.

---

## Key Architectural Decisions

1. **Responses protocol, not Assistants API** — `foundryClient.ts` uses a thin `fetch` client against `/endpoint/protocols/openai/responses`. The `@azure/ai-projects` SDK's threads/runs surface does not match hosted agents 1:1.

2. **Container returns tool_calls; Node backend executes them** — The Python agent container is a pure reasoning engine. All approval gating, sandboxing, filesystem access, and audit logging lives in the Node backend (`src/server/agentLoop.ts`).

3. **Model routing mirrored in TS and Python** — `src/modelRouting.ts` and `src/CofounderAgent/model_routing.py` must be kept in sync when adding TaskKinds or logical models.

4. **Ollama-first in browser** — When Ollama is detected, `useSendMessage` streams tokens directly from the browser to `127.0.0.1:11434`, then calls `POST /api/chat/finalize` to persist messages and facts. This path keeps user prompts entirely on the local machine.

5. **SQLite for dev, Postgres for hosted** — The Prisma schema uses SQLite-native patterns (`TEXT` enums with `@default`) that port cleanly to Postgres.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Purpose |
|---|---|
| `AZURE_AI_PROJECT_ENDPOINT` | Foundry project endpoint |
| `COFOUNDER_AGENT_NAME` | Hosted agent name to invoke (`CofounderAgent`) |
| `DATABASE_URL` | Prisma DB path (`file:./dev.db`) |
| `REPO_ROOT` | Local repo root for file autocomplete and repo tools |
| `MODEL_DEPLOYMENT_*` | Override logical→deployment name mappings |
| `GEMINI_ENDPOINT` / `GEMINI_API_KEY` | Direct Gemini OpenAI-compat endpoint |
| `OLLAMA_ENDPOINT` | Local Ollama endpoint (default `http://localhost:11434/v1`) |

Never commit `.env` — it is gitignored.

---

## Conventions Specific to This Codebase

- **Persona enum**: `orchestrator`, `code_assistant`, `brand_designer`, `ops`, `vision`. Selected via `[persona:<name>]` prefix in user messages or UI selector.
- **TaskKind enum**: `deep_planning`, `general_chat`, `fast_brainstorm`, `code_repo`, `code_file`, `brand_strategy`, `copywriting`, `personal_ops`, `vision`, `visual`.
- **Premium-only routing**: No `gpt-4.1` defaults anywhere. Fallback chains in `ROUTES` are the single source of truth.
- **`previousResponseId` hygiene**: Only persist IDs passing `isValidResponseId()` (`caresp_*` or `resp_*`). Never pass bare hex `agent_session_id` back as `previous_response_id`.
- **SSE discipline**: `ReadableStream` controllers MUST be closed in exactly one place — the `finally{}` block. Double-close throws `ERR_INVALID_STATE`.
- **Next.js App Router gotcha**: `route.ts` files can ONLY export HTTP method handlers and Next-recognized constants (`runtime`, `dynamic`). Helper exports must live in a sibling file (e.g., `_helpers.ts`).
- **Tool schema shapes are NOT interchangeable**: Use `toolsForResponses()` vs `toolsForChatCompletions()` from `src/server/toolsSchema.ts`. Never hand-roll.
- **Hot-loaded prompts**: `src/server/personaPrompts.ts` reads `agent-config/*.prompt.md` at runtime (mtime-cached) and concatenates with the memory preamble.

---

## Agent Development Checklist

Before submitting changes:

1. Run `npm test` — all tests must pass.
2. Run `npm run typecheck` — no TypeScript errors.
3. Run `npm run lint` — no ESLint errors.
4. If you changed Python agent code, run `black --check src/` and `pylint src/CofounderAgent src/CalculatorAgent --disable=all --enable=E,F`.
5. If you changed `src/modelRouting.ts`, check whether `src/CofounderAgent/model_routing.py` needs a matching update (and vice versa).
6. If you added a new API route, ensure it calls `requireAuth(req)` and applies ownership checks (404 for non-owner rows).
7. If you added a new tool, ensure it has approval gating if destructive, path validation if filesystem-related, and secret redaction if it outputs user data.
8. If you modified persona prompts, remember the deployed container has a baked snapshot; it needs `cp agent-config/*.prompt.md src/CofounderAgent/prompts/ && azd up` to refresh.
