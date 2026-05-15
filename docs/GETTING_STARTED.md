# 🚀 Getting Started with AgentRoot

> **New to AgentRoot?** You're 90 seconds away from your first local AI coworker conversation.

---

## Prerequisites

Before you begin, ensure you have:

| Requirement | Version | Check Command |
|:---|:---|:---|
| Node.js | 18.x or 20.x | `node --version` |
| npm | 9+ | `npm --version` |
| Git | 2.30+ | `git --version` |
| Ollama | Latest | `ollama --version` |

> [!TIP]
> Don't have Ollama yet? Install it with one command:
> ```bash
> curl -fsSL https://ollama.com/install.sh | sh
> ```

---

## Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/joecapella/agentroot.git
cd agentroot
```

### Step 2: Install Dependencies

```bash
npm install
```

This installs all Node.js packages including Next.js, Prisma, React, and dev tools.

### Step 3: Set Up the Database

```bash
npm run db:migrate
npm run db:generate
```

This creates a local SQLite database (`prisma/dev.db`) and generates the Prisma client types.

### Step 4: Pull a Local Model

```bash
# Best balance of speed and quality for most laptops
ollama pull qwen2.5-coder:7b

# Or for more power (requires ~10 GB VRAM / RAM)
ollama pull qwen2.5-coder:14b
```

See the [Local LLM Guide](#local-llm-guide) below for more options.

### Step 5: Start AgentRoot

```bash
npm run dev
```

Open your browser to **http://127.0.0.1:3000**

> [!NOTE]
> The dev server binds to `127.0.0.1` by default for security. Use `npm run dev:lan` to bind to `0.0.0.0` if you need LAN access.

---

## Your First Conversation

1. **Type a message** in the chat input
2. **Select a persona** from the dropdown (try "Code Assistant" for coding tasks)
3. **Hit Enter** — AgentRoot routes to your local Ollama model automatically
4. **Watch it work** — The agent thinks, calls tools if needed, and responds

---

## Local LLM Guide

### Recommended Models

| Model | Parameters | Size | Best For | Min RAM |
|:---|:---|:---|:---|:---|
| `qwen2.5-coder:7b` | 7B | 4.7 GB | General coding, fast responses | 8 GB |
| `qwen2.5-coder:14b` | 14B | 9 GB | Deep code review, architecture | 16 GB |
| `deepseek-coder-v2:16b` | 16B | 9 GB | Complex reasoning, math | 16 GB |
| `llama3.2:3b` | 3B | 2 GB | Lightweight, fast prototyping | 4 GB |
| `phi4` | 14B | 9 GB | General tasks, conversation | 16 GB |
| `codellama:34b` | 34B | 19 GB | Large codebase analysis | 32 GB |
| `llama3.1:70b` | 70B | 40 GB | Maximum quality (desktop GPU) | 48 GB |

### Checking Model Compatibility

AgentRoot uses Ollama's OpenAI-compatible `/v1/chat/completions` endpoint. Any model Ollama can serve works with AgentRoot.

```bash
# List installed models
ollama list

# Check if a model supports tool calling
# (Most modern coding models do: qwen2.5-coder, llama3.1, etc.)
```

### Using Hugging Face Models

Ollama can pull GGUF models directly from Hugging Face:

```bash
ollama pull hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF
```

After pulling, it appears in **Settings → Local Agent → Default model**.

---

## Configuration

### Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Required? | Description |
|:---|:---|:---|
| `DATABASE_URL` | No | Defaults to `file:./dev.db` |
| `REPO_ROOT` | No | Path for file autocomplete and repo tools |
| `AZURE_AI_PROJECT_ENDPOINT` | Only for cloud | Azure Foundry project URL |
| `COFOUNDER_AGENT_NAME` | Only for cloud | Hosted agent name |

### Settings Page

Navigate to **Settings** (⚙️ icon in sidebar or `/settings`) to configure:

- **Identity** — Who you are, what the agent should remember
- **API Keys** — BYOK for cloud providers
- **Local Agent** — Ollama URL, default model, local freedom mode
- **Models & Routing** — Override which model handles each task
- **Personas** — Edit system prompts
- **Tools & Permissions** — Granular tool access control
- **Defaults** — Default reasoning, tools mode, persona

---

## Troubleshooting

### Ollama Not Reachable

```bash
# Check if Ollama is running
ollama list

# If not, start it
ollama serve

# Check the URL in Settings → Local Agent
# Default: http://127.0.0.1:11434
```

### Database Errors

```bash
# Reset the database (WARNING: deletes all data)
rm prisma/dev.db
npm run db:migrate
```

### Port Already in Use

```bash
# Find what's using port 3000
lsof -i :3000

# Or start on a different port
PORT=3001 npm run dev
```

### Model Responses Are Slow

- Use a smaller model (`:7b` instead of `:14b`)
- Ensure Ollama is using GPU acceleration: `ollama ps` shows GPU usage
- Close other applications to free up RAM

---

## Next Steps

- 📖 Read the [Architecture Guide](ARCHITECTURE.md) to understand how AgentRoot works
- 🎭 Learn to [create custom personas](PERSONAS.md)
- 🔧 Explore the [available tools](TOOLS.md)
- 🌐 Set up [cloud model support](DEPLOYMENT.md#byok-cloud-keys)
- 🤝 [Contribute](../CONTRIBUTING.md) to the project
