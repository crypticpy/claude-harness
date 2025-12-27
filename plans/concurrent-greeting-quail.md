# Plan: SpacetimeDB Integration for Auto-Claude

## Status: Phase 3 COMPLETED ✅

**Phase 1 (COMPLETED)**:
- ✅ Created `spacetime/` module (config, sats_json, types, client, telemetry)
- ✅ Integrated dual-write in task_logger/logger.py
- ✅ Added session lifecycle hooks to agents/coder.py
- ✅ Added subtask sync to tools/subtask.py
- ✅ Fixed database name to `auto-claude-db` (separate from Forge)

**Phase 2 (COMPLETED)**: READ capabilities for orchestrator intelligence
- ✅ Added SQL query methods to `spacetime/client.py`
- ✅ Created `agents/tools_pkg/tools/spacetime_query.py` with 5 MCP tools
- ✅ Exported tools in `agents/tools_pkg/tools/__init__.py`
- ✅ Registered tools in `agents/tools_pkg/registry.py`
- ✅ Added tool constants to `agents/tools_pkg/models.py`
- ✅ Added permissions to `agents/tools_pkg/permissions.py`
- ✅ Enhanced `services/recovery.py` with SpacetimeDB integration

**Phase 3 (COMPLETED)**: Electron UI Integration
- ✅ Created shared TypeScript types (`src/shared/types/spacetimedb.ts`)
- ✅ Created IPC channel constants (`src/shared/constants/spacetimedb.ts`)
- ✅ Created SpacetimeDB HTTP client (`src/main/integrations/spacetimedb/client.ts`)
- ✅ Created WebSocket subscription manager (`src/main/integrations/spacetimedb/subscription.ts`)
- ✅ Created Zustand store (`src/renderer/stores/spacetimedb-store.ts`)
- ✅ Created IPC handlers (`src/main/ipc-handlers/spacetimedb-handlers.ts`)
- ✅ Created preload API (`src/preload/api/modules/spacetimedb-api.ts`)
- ✅ Registered handlers in IPC index (`src/main/ipc-handlers/index.ts`)
- ✅ File-watcher.ts serves as reliable fallback (no changes needed)

---

## Review: MCP Tool Registration Flow (Verified ✅)

### Complete Tool Registration Chain

```
1. spacetime_query.py          → Creates 5 @tool-decorated functions
        ↓
2. tools/__init__.py           → Exports create_spacetime_query_tools
        ↓
3. registry.py                 → create_all_tools() includes SpacetimeDB tools
        ↓
4. tools_pkg/__init__.py       → Exports create_auto_claude_mcp_server
        ↓
5. auto_claude_tools.py (shim) → Forwards to tools_pkg
        ↓
6. core/client.py              → Creates MCP server, adds to mcp_servers dict
        ↓
7. ClaudeSDKClient             → Receives allowed_tools + mcp_servers
```

### Files Verified

| File | Status | Notes |
|------|--------|-------|
| `spacetime/config.py` | ✅ | `is_spacetime_enabled()` works correctly |
| `spacetime/__init__.py` | ✅ | Exports `SpacetimeClient`, `is_spacetime_enabled` |
| `tools/spacetime_query.py` | ✅ | 5 tools with proper @tool decorators |
| `tools/__init__.py` | ✅ | Exports `create_spacetime_query_tools` |
| `registry.py` | ✅ | Calls `create_spacetime_query_tools()` |
| `permissions.py` | ✅ | Includes TOOL_QUERY_* constants per agent type |
| `models.py` | ✅ | Defines all 5 TOOL_QUERY_* constants |
| `core/client.py` | ✅ | Creates MCP server, passes to ClaudeSDKClient |

### Conditional Tool Availability

SpacetimeDB tools are **conditionally included** based on:

```python
# In spacetime_query.py:create_spacetime_query_tools()
if not SDK_TOOLS_AVAILABLE:      # claude_agent_sdk not installed
    return []
if not SPACETIME_AVAILABLE:      # spacetime module import failed
    return []
if not is_spacetime_enabled():   # SPACETIMEDB_ENABLED=false
    return []
```

**Default behavior**: SpacetimeDB is **enabled by default** (`config.py` line 54).
To disable: Set `SPACETIMEDB_ENABLED=false`

### Permission Matrix (Verified)

| Agent Type | SpacetimeDB Tools |
|------------|-------------------|
| **planner** | query_spec_summary, query_subtask_history, query_active_agents |
| **coder** | query_subtask_history, query_active_agents |
| **qa_reviewer** | query_spec_summary |
| **qa_fixer** | query_subtask_history |

---

## Overview

Integrate Auto-Claude (Python) with SpacetimeDB using Forge's existing schema, enabling:
- Real-time UI updates via WebSocket subscriptions
- Cross-session querying via SQL
- **Orchestrator intelligence for failure recovery**

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SPACETIMEDB SERVER                               │
│                    (Shared between Forge & Auto-Claude)             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  forge-db WASM Module                                        │    │
│  │  8 Tables: sessions, messages, tool_executions, subtasks,    │    │
│  │           commits, errors, discoveries, recovery_attempts    │    │
│  │  11 Reducers: start_session, record_message, etc.            │    │
│  └─────────────────────────────────────────────────────────────┘    │
└────────────────────┬────────────────────────┬───────────────────────┘
                     │                        │
            HTTP (Reducers)           WebSocket (Subscribe)
                     │                        │
      ┌──────────────┴──────────────┐        │
      │                             │        │
      v                             v        v
┌─────────────────┐          ┌─────────────────────┐
│ AUTO-CLAUDE     │          │ ELECTRON UI         │
│ Python Backend  │          │ (auto-claude-ui)    │
│                 │          │                     │
│ spacetime/      │          │ spacetime/client.ts │
│   client.py     │          │ WebSocket + HTTP    │
│   telemetry.py  │          │                     │
└─────────────────┘          └─────────────────────┘
```

## Design Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Storage strategy | **Dual-write** (files + SpacetimeDB) | Files remain reliable fallback |
| Python SDK | **HTTP API** (not SDK) | SDK is unmaintained; HTTP is stable |
| Server lifecycle | **External** (manual or via Forge) | Share same database instance |
| UI real-time | **WebSocket** subscription | Instant updates, file watchers as fallback |

---

## Implementation Phases

### Phase 1: Python SpacetimeDB Module

Create new module: `auto-claude/spacetime/`

| File | Purpose |
|------|---------|
| `__init__.py` | Module exports |
| `config.py` | SpacetimeConfig dataclass, env var loading |
| `sats_json.py` | SATS-JSON encoding (Option<T> → {"0":v}/{"1":[]}) |
| `types.py` | Python dataclasses for 8 tables |
| `client.py` | HTTP client with reducer methods |
| `telemetry.py` | Fire-and-forget telemetry wrapper |

**Key Classes:**

```python
# config.py
@dataclass
class SpacetimeConfig:
    host: str = "http://localhost:3000"
    database: str = "forge-db"
    enabled: bool = True
    auth_token: str | None = None

# client.py
class SpacetimeClient:
    async def call_reducer(self, name: str, args: tuple) -> bool
    async def query(self, sql: str) -> list[dict]
    async def start_session(...) -> bool
    async def record_message(...) -> bool
    async def record_tool_execution(...) -> bool
    async def update_subtask_status(...) -> bool

# telemetry.py
class SpacetimeTelemetry:
    """Fire-and-forget: never blocks agent execution"""
    async def record_phase_start(phase: str)
    async def record_tool_execution(...)
    async def record_subtask_progress(...)
```

### Phase 2: Backend Integration

**Modify existing files:**

| File | Changes |
|------|---------|
| `task_logger/logger.py` | Add dual-write to SpacetimeDB on each log entry |
| `agents/coder.py` | Call start_session/update_status at lifecycle points |
| `core/progress.py` | Update SpacetimeDB after plan JSON updates |

**TaskLogger Integration Pattern:**

```python
class TaskLogger:
    def __init__(self, spec_dir: Path, ...):
        # Existing init...
        self._spacetime = self._init_spacetime()

    def tool_end(self, tool_name: str, success: bool, ...):
        # Existing file write...
        self._add_entry(entry)

        # NEW: SpacetimeDB dual-write
        if self._spacetime:
            asyncio.create_task(self._spacetime.record_tool_execution(...))
```

### Phase 3: Electron UI Integration

Create new files in `auto-claude-ui/`:

| File | Purpose |
|------|---------|
| `src/shared/spacetime-types.ts` | TypeScript interfaces matching schema |
| `src/main/spacetime/client.ts` | HTTP + WebSocket client |
| `src/main/spacetime/subscription.ts` | WebSocket subscription manager |
| `src/renderer/stores/spacetime-store.ts` | Zustand store for SpacetimeDB state |

**Modify existing:**

| File | Changes |
|------|---------|
| `src/renderer/stores/task-store.ts` | Subscribe to SpacetimeDB for real-time |
| `src/main/services/file-watcher.ts` | Keep as fallback when WS disconnected |

### Phase 4: Environment & Config

**New environment variables:**

```bash
SPACETIMEDB_HOST=http://localhost:3000
SPACETIMEDB_DATABASE=forge-db
SPACETIMEDB_ENABLED=true
SPACETIMEDB_AUTH_TOKEN=  # Optional
```

---

## Files to Create

```
auto-claude/spacetime/
├── __init__.py
├── config.py          (~50 lines)
├── sats_json.py       (~30 lines)
├── types.py           (~150 lines - 8 dataclasses)
├── client.py          (~200 lines)
└── telemetry.py       (~150 lines)

auto-claude-ui/src/
├── shared/spacetime-types.ts       (~100 lines)
├── main/spacetime/
│   ├── client.ts                   (~150 lines)
│   └── subscription.ts             (~100 lines)
└── renderer/stores/spacetime-store.ts  (~80 lines)
```

## Files to Modify

| File | Lines Changed |
|------|--------------|
| `auto-claude/task_logger/logger.py` | +30 lines |
| `auto-claude/agents/coder.py` | +20 lines |
| `auto-claude/core/progress.py` | +15 lines |
| `auto-claude-ui/src/renderer/stores/task-store.ts` | +40 lines |

---

## Schema Reference (from forge-db)

**8 Tables:**

| Table | Key Fields |
|-------|------------|
| `agent_sessions` | id, project_id, spec_id, status, total_tokens, total_cost |
| `messages` | id, session_id, role, content, tokens_in, tokens_out |
| `tool_executions` | id, session_id, tool_name, input, output, duration_ms |
| `subtasks` | id, spec_id, phase_id, description, status, session_id |
| `commits` | hash, session_id, message, files_changed |
| `errors` | id, session_id, error_type, message, context |
| `discoveries` | id, session_id, discovery_type, title, content |
| `recovery_attempts` | id, subtask_id, attempt_number, success |

**Key Reducers:**

- `start_session(id, project_id, spec_id, agent_type, model)`
- `update_session_status(session_id, status)`
- `record_message(id, session_id, role, content, tokens_in, tokens_out, stop_reason)`
- `record_tool_execution(id, session_id, message_id, tool_name, tool_input, tool_output, success, error, duration_ms)`
- `update_subtask_status(subtask_id, status, session_id)`
- `record_error(id, session_id, subtask_id, error_type, message, context)`
- `record_discovery(id, session_id, project_id, type, title, content, file_paths, relevance)`

---

## Error Handling

All SpacetimeDB operations are **fire-and-forget**:

```python
async def record_something(self, ...):
    try:
        await self._client.call_reducer(...)
    except Exception as e:
        logger.warning(f"SpacetimeDB write failed: {e}")
        # Continue - file-based storage is primary
```

---

## Implementation Order

### Phase 1 (COMPLETED)
1. ✅ **`spacetime/config.py`** - Configuration and env vars
2. ✅ **`spacetime/sats_json.py`** - SATS-JSON encoding utilities
3. ✅ **`spacetime/types.py`** - Python dataclasses for schema
4. ✅ **`spacetime/client.py`** - HTTP client with all reducers
5. ✅ **`spacetime/telemetry.py`** - High-level telemetry wrapper
6. ✅ **`task_logger/logger.py`** - Integrate dual-write
7. ✅ **`agents/coder.py`** - Session lifecycle hooks
8. ✅ **`agents/tools_pkg/tools/subtask.py`** - Subtask sync

### Phase 2 (COMPLETED ✅) - READ Capabilities for Recovery Intelligence

**Goal**: Give orchestrator/recovery manager intelligence to query SpacetimeDB for:
- What previous agents attempted on failed subtasks
- Tool execution history and errors
- Cross-agent coordination context

**Implemented:**

1. ✅ **`spacetime/client.py`** - Added SQL query methods:
   - `query_sessions_by_spec()`, `query_tool_executions()`, `query_errors_by_session()`
   - `query_errors_by_subtask()`, `query_recovery_attempts()`, `query_active_sessions()`
   - `query_subtask_history()`, `query_spec_summary()`

2. ✅ **`agents/tools_pkg/tools/spacetime_query.py`** - 5 MCP tools:
   - `query_subtask_history` - What was tried before?
   - `query_session_errors` - What errors occurred?
   - `query_active_agents` - Who else is working?
   - `query_spec_summary` - Overall spec progress
   - `query_tool_executions` - Tool usage history

3. ✅ **`agents/tools_pkg/tools/__init__.py`** - Exports `create_spacetime_query_tools`
4. ✅ **`agents/tools_pkg/registry.py`** - Registers query tools via `create_all_tools()`
5. ✅ **`agents/tools_pkg/models.py`** - Added TOOL_QUERY_* constants + SPACETIME_QUERY_TOOLS list
6. ✅ **`agents/tools_pkg/permissions.py`** - Added to all agent types with role-based access
7. ✅ **`services/recovery.py`** - Enhanced with SpacetimeDB integration

---

### Phase 2.5 (OPTIONAL) - Minor Improvements

These are optional enhancements identified during review:

| Improvement | File | Priority |
|-------------|------|----------|
| Add SpacetimeDB status to client startup log | `core/client.py` | Low |
| Document SPACETIMEDB_ENABLED in .env.example | `.env.example` | Low |
| Add query_tool_executions to more agent types | `permissions.py` | Low |

**Current Limitation**: If SpacetimeDB server isn't running but is enabled (default),
query tools will fail at runtime with graceful error messages. This is acceptable behavior.

---

## Testing

1. **Unit**: SATS-JSON encoding
2. **Integration**: Mock SpacetimeDB server
3. **E2E**: Run with real SpacetimeDB, verify data
4. **Fallback**: Disable SpacetimeDB, verify files still work

---

## Dependencies

**Python** (add to requirements.txt):
- `httpx` (already present) - async HTTP

**TypeScript** (no new deps):
- Native `fetch` and `WebSocket`
