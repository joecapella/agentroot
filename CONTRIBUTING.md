# 🤝 Contributing to AgentRoot

> **Thank you for investing your time in AgentRoot.**
>
> Whether you're fixing a typo, adding a new persona, or building an entire agent — every contribution moves us closer to the open-source standard for private AI development.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Environment](#development-environment)
- [Project Structure](#project-structure)
- [How to Contribute](#how-to-contribute)
  - [Reporting Bugs](#-reporting-bugs)
  - [Suggesting Features](#-suggesting-features)
  - [Pull Requests](#-pull-requests)
- [Coding Standards](#coding-standards)
- [Adding a Persona](#adding-a-persona)
- [Adding a Tool](#adding-a-tool)
- [Adding an API Route](#adding-an-api-route)
- [Testing Guide](#testing-guide)
- [Release Process](#release-process)
- [Getting Help](#getting-help)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code. **Be friendly, be respectful, assume good intent.**

---

## Getting Started

### Prerequisites

| Tool | Version | Purpose |
|:---|:---|:---|
| Node.js | 18.x or 20.x | Backend & frontend runtime |
| npm | 9+ | Package management |
| Python | 3.11 | Agent containers |
| Ollama | latest | Local LLM inference |
| Git | 2.30+ | Version control |

### Quick Setup

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/agentroot.git
cd agentroot

# 2. Install dependencies
npm install

# 3. Set up the database
npm run db:migrate
npm run db:generate

# 4. Start the dev server
npm run dev

# 5. Open http://127.0.0.1:3000
```

> [!TIP]
> Use `npm run dev:lan` if you want to access AgentRoot from another device on your network.

---

## Development Environment

### Recommended VS Code Extensions

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "Prisma.prisma",
    "bradlc.vscode-tailwindcss",
    "ms-python.python",
    "ms-python.black-formatter"
  ]
}
```

### Environment Variables

Copy `.env.example` to `.env` and fill in any values you need:

```bash
cp .env.example .env
```

For pure local development, you often don't need to set anything — AgentRoot defaults to SQLite and Ollama.

---

## Project Structure

```
agentroot/
├── app/                    # Next.js App Router
│   ├── api/               # API route handlers
│   ├── components/        # React UI components
│   ├── lib/               # Client utilities (hooks, types, api client)
│   └── settings/          # Full settings page
├── src/
│   ├── server/            # Business logic
│   │   ├── agentLoop.ts   # ReAct loop engine
│   │   ├── llmRouter.ts   # Unified LLM dispatch
│   │   ├── fsTools.ts     # Filesystem tools
│   │   ├── shellTools.ts  # Shell command tools
│   │   └── ...
│   ├── CofounderAgent/    # Python LangGraph agent
│   ├── CalculatorAgent/   # Python math agent
│   ├── modelRouting.ts    # Logical → deployment mapping
│   └── memory.ts          # Facts, profiles, workspaces
├── agent-config/          # Editable persona prompts
├── prisma/                # Schema, migrations, SQLite DB
├── tests/                 # Test suites
│   ├── api.test.ts        # API integration tests
│   ├── unit.test.ts       # Pure unit tests
│   └── unit/              # Additional unit tests
├── infra/                 # Bicep templates
└── docs/                  # Documentation
```

---

## How to Contribute

### 🐛 Reporting Bugs

Before opening a bug report:
1. Search [existing issues](https://github.com/joecapella/agentroot/issues) to avoid duplicates
2. Try the latest `main` branch — your bug may already be fixed

When reporting, use the [Bug Report template](https://github.com/joecapella/agentroot/issues/new?template=bug_report.yml) and include:
- Clear description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, browser)
- Relevant logs or error messages

### 💡 Suggesting Features

We love feature ideas! Use the [Feature Request template](https://github.com/joecapella/agentroot/issues/new?template=feature_request.yml) and tell us:
- What problem does this solve?
- How should it work?
- Are there alternatives you've considered?

> [!NOTE]
> Not every feature will be accepted, and that's okay. We prioritize local-first, privacy-respecting features that align with AgentRoot's core mission.

### 🔀 Pull Requests

#### Before You Start

1. **Open an issue first** for major changes — let's discuss the design
2. **Claim the issue** by commenting "I'd like to work on this"
3. **Fork and branch** from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

#### While Developing

- Keep changes focused and atomic
- Add tests for new behavior
- Update documentation if you change user-facing behavior
- Follow the coding standards below

#### Before Submitting

Run the full quality gate:

```bash
npm test
npm run lint
npm run typecheck
```

For Python agent changes:
```bash
black --check src/
pylint src/CofounderAgent src/CalculatorAgent --disable=all --enable=E,F
```

#### PR Description

Use the [Pull Request template](.github/pull_request_template.md). A good PR includes:
- What changed and why
- Screenshots/GIFs for UI changes
- Link to the issue it closes (`Closes #123`)
- Manual testing steps

---

## Coding Standards

### TypeScript

- **Strict mode** is enabled. No `any` without a comment explaining why.
- Use `@/*` path alias for project-relative imports (`@/src/prisma`, `@/app/lib/types`)
- Named exports preferred; default exports for page/layout components only
- JSDoc for public functions
- Inline comments for security decisions and date-stamped notes (`Bug-7`, `2026-05-12`)

### React / Next.js

- App Router convention: `route.ts` for API handlers, `page.tsx` for pages
- Inline `style={}` props referencing style objects — no CSS-in-JS runtime
- Dark theme CSS variables from `globals.css`

### Python

- **Black** formatter
- Requirements pinned explicitly
- `azure-ai-agentserver-core==1.0.0b3` and `starlette<1.0` are critical

### Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new tool for calendar events
fix: prevent path traversal in write_file
docs: update README with settings page screenshot
refactor: extract shared approval logic
test: add coverage for tool-policies API
chore: update dependencies
```

---

## Adding a Persona

Personas are the easiest way to contribute — no code required!

1. Create a new file in `agent-config/`: `my-persona.prompt.md`
2. Write the system prompt. Include:
   - Role definition
   - Communication style
   - Domain expertise
   - Any constraints or preferences
3. Add it to the ALLOWED_FILES list in `app/api/settings/route.ts`
4. Add it to the UI dropdown in `app/components/settings/PersonasSection.tsx`
5. Test it by selecting it in the chat persona dropdown

> [!TIP]
> Look at `agent-config/code-assistant.prompt.md` for a well-structured example.

---

## Adding a Tool

Tools extend what AgentRoot can do. Here's the full flow:

### 1. Implement the Tool Logic

Add your tool to the appropriate server file:

```typescript
// src/server/myTools.ts
export function myNewTool(args: { param: string }): { result: string } {
  // Implementation here
  return { result: "done" };
}
```

### 2. Add to the Execute Route

Register it in `app/api/tools/execute/route.ts`:

```typescript
case "my_new_tool": {
  result = myNewTool({ param: params.param });
  break;
}
```

### 3. Add to Tool Policies

Register it in `app/api/tool-policies/route.ts` so users can control permissions:

```typescript
{ toolName: "my_new_tool", category: "MyCategory", description: "What it does" }
```

### 4. Add to Local Ollama Tools (Optional)

If local models should use it, add to `app/lib/hooks.ts` in `LOCAL_TOOL_DEFS`.

### 5. Add Approval Gating (if destructive)

If the tool modifies files, runs commands, or makes external changes:
- Add it to `DESTRUCTIVE_TOOLS` in `src/server/agentLoop.ts`
- The ReAct loop will automatically create approval requests

### 6. Add Tests

Add tests in `tests/api.test.ts` for the execute route, and unit tests if applicable.

---

## Adding an API Route

1. Create `app/api/my-route/route.ts`
2. Export HTTP method handlers (`GET`, `POST`, `PATCH`, `DELETE`)
3. Call `requireAuth(req)` and apply ownership checks
4. Return 404 (not 403) for non-owner rows
5. Add tests in `tests/api.test.ts`

> [!IMPORTANT]
> Helper functions must live in a sibling file (e.g., `_helpers.ts`) — Next.js App Router `route.ts` can only export HTTP handlers and Next-recognized constants.

---

## Testing Guide

### Test Philosophy

- **API tests** (`tests/api.test.ts`) spin up real Prisma against `test.db`
- **Unit tests** (`tests/unit.test.ts`) are pure — no DB, no network
- **Component tests** (`tests/components/`) test React components in isolation

### Running Tests

```bash
# All tests
npm test

# Specific file
node --import tsx --test tests/api.test.ts

# With coverage
npm run test:coverage

# Watch mode (manual)
npx tsx --watch --test tests/unit.test.ts
```

### Writing Tests

Use Node.js built-in `node:test` and `node:assert`:

```typescript
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

describe("my feature", () => {
  it("does the thing", () => {
    assert.equal(myFunction(), "expected");
  });
});
```

### Test Isolation

- API tests run `prisma migrate deploy` in a `before` hook
- Unit tests patch `process.env` before importing modules that read env vars
- Never let unit tests reach real Azure SDK — intercept `globalThis.fetch`

---

## Release Process

1. **Version bump** in `package.json`
2. **Update CHANGELOG** with conventional commit summaries
3. **Tag the release**: `git tag v0.x.x`
4. **Push tags**: `git push origin v0.x.x`
5. **GitHub Release** is auto-created from the tag

---

## Getting Help

- 💬 [GitHub Discussions](https://github.com/joecapella/agentroot/discussions) — questions, ideas, show-and-tell
- 🐛 [GitHub Issues](https://github.com/joecapella/agentroot/issues) — bugs and feature requests
- 📧 For security concerns, email the maintainers directly

---

**Thank you for helping build the future of private AI. Every star, issue, and PR matters.**

⭐ [Star AgentRoot](https://github.com/joecapella/agentroot) · 🍴 [Fork it](https://github.com/joecapella/agentroot/fork) · 🐛 [Open an Issue](https://github.com/joecapella/agentroot/issues/new)
