# Implementation Plan: Complete SpacetimeDB & FalkorDB/Graphiti Integration

Created: 2025-12-21
Status: APPROVED

## Architectural Decisions (Confirmed)

1. **Bundle SpacetimeDB** - Embed as Tauri sidecar, auto-start on app launch, zero-config for users
2. **Direct FalkorDB** - Use direct Cypher queries for all MemoryStore ops; MCP is optional for semantic/embedding features
3. **Tool Tiering** - Orchestrator gets diagnostic/healing tools; Agents get memory + codebase navigation tools

## Summary

This plan completes the SpacetimeDB and FalkorDB/Graphiti database integrations with no shortcuts or TODOs. We will implement: (1) Full SpacetimeDB SDK connection and reducer calls in forge-db-client, (2) FalkorDB graph operations via a new GraphitiMemoryStore, (3) Graphiti MCP client for external access, and (4) Native Rust tools for agent direct access to both databases. The dual-access pattern ensures agents can use either MCP or native tool calls.

Reminder: I should always leverage sub-agents, setting them to the OPUS model and working in parallel whenever possible, to save my context and be more efficient. 

## Scope

### In Scope
- SpacetimeDB SDK connection implementation (WebSocket subscriptions, HTTP reducer calls)
- All 12 reducer call implementations in forge-db-client
- New `GraphitiMemoryStore` implementing `MemoryStore` trait
- FalkorDB Cypher query generation for graph operations
- Graphiti MCP client in Rust
- Memory backend switching logic in MemoryManager
- 6 new database tools for agents:
  - `QueryMemory` - Search memory store
  - `SaveDiscovery` - Save a learned pattern/discovery
  - `GetSessionHistory` - Retrieve session context
  - `QueryAgentSessions` - Query SpacetimeDB sessions
  - `GetToolExecutions` - Get tool execution history
  - `UpdateSubtaskStatus` - Update subtask progress
- Integration tests for both databases
- Frontend updates for full Graphiti status display

### Out of Scope
- Changes to forge-db WASM module (already complete)
- Vector embeddings/semantic search (future enhancement)
- SpacetimeDB Maincloud deployment (local self-hosted only)
- Agent autonomous loop implementation (separate initiative)

## Prerequisites

1. SpacetimeDB CLI installed: `curl -sSf https://install.spacetimedb.com | sh`
2. SpacetimeDB local instance running: `spacetime start`
3. forge-db module published: `cd crates/forge-db && spacetime publish forge-db --clear-database`
4. Docker running for FalkorDB
5. Redis client crate compatible with FalkorDB (we'll use `fred` crate)

## Implementation Phases

### Phase 1: SpacetimeDB SDK Integration

**Objective**: Replace all TODO stubs in forge-db-client with real SpacetimeDB SDK calls

**Files to Modify**:
- `crates/forge-db-client/Cargo.toml` - Add spacetimedb-sdk dependency
- `crates/forge-db-client/src/connection.rs` - Implement real connection and reducer calls
- `crates/forge-db-client/src/lib.rs` - Export new types if needed
- `crates/forge-db-client/src/types.rs` - Ensure types match SDK expectations

**New Files to Create**:
- `crates/forge-db-client/src/subscription.rs` - WebSocket subscription handling
- `crates/forge-db-client/src/reducers.rs` - Reducer call implementations

**Steps**:

1. **Add SpacetimeDB SDK dependency**:
   ```toml
   [dependencies]
   spacetimedb-sdk = "1.11"
   ```

2. **Implement connection with SDK**:
   - Create `DbConnection` wrapper around SpacetimeDB SDK connection
   - Implement `connect()` to establish WebSocket connection to `ws://localhost:3000/database/subscribe/forge-db`
   - Handle connection lifecycle (reconnection, disconnection events)
   - Start subscription processing task

3. **Implement subscription handling**:
   - Subscribe to all tables (agent_sessions, messages, tool_executions, subtasks, commits, errors, discoveries, recovery_attempts)
   - Process row inserts/updates/deletes from subscription stream
   - Update local `ClientState` HashMap caches
   - Emit `DbEvent` through broadcast channel

4. **Implement all reducer calls**:
   - `start_session()` - HTTP POST to `/database/call/forge-db/start_session`
   - `update_session_status()` - Call `update_session_status` reducer
   - `increment_iteration()` - Call `increment_iteration` reducer
   - `update_session_usage()` - Call `update_session_usage` reducer
   - `record_message()` - Call `record_message` reducer
   - `record_tool_execution()` - Call `record_tool_execution` reducer
   - `create_subtask()` - Call `create_subtask` reducer
   - `update_subtask_status()` - Call `update_subtask_status` reducer
   - `record_commit()` - Call `record_commit` reducer
   - `record_error()` - Call `record_error` reducer
   - `record_recovery_attempt()` - Call `record_recovery_attempt` reducer
   - `record_discovery()` - Call `record_discovery` reducer

5. **Add error handling and retry logic**:
   - Implement exponential backoff for connection failures
   - Handle reducer call failures gracefully
   - Log all operations for debugging

**Verification**:
- [ ] `cargo build --package forge-db-client` compiles
- [ ] `cargo test --package forge-db-client` passes
- [ ] Integration test: connect to local SpacetimeDB, call reducers, verify data persists
- [ ] Subscription test: insert data, verify ClientState updates

---

### Phase 2: FalkorDB GraphitiMemoryStore Implementation

**Objective**: Create a `MemoryStore` implementation that uses FalkorDB for graph-based storage

**Files to Modify**:
- `crates/forge-memory/Cargo.toml` - Add `fred` (Redis client) dependency
- `crates/forge-memory/src/lib.rs` - Export new GraphitiMemoryStore
- `crates/forge-memory/src/manager.rs` - Add backend switching logic

**New Files to Create**:
- `crates/forge-memory/src/graphiti_store.rs` - GraphitiMemoryStore implementation
- `crates/forge-memory/src/cypher.rs` - Cypher query generation helpers

**Steps**:

1. **Add Redis client dependency**:
   ```toml
   [dependencies]
   fred = { version = "9", features = ["subscriber-client"] }
   ```

2. **Create Cypher query generation module** (`cypher.rs`):
   - `create_episode_node(episode: &Episode) -> String` - Generate CREATE query
   - `get_episode_by_id(id: &str) -> String` - MATCH query
   - `search_episodes(query: &str, limit: usize) -> String` - Full-text search query
   - `get_by_spec_id(spec_id: &str, limit: usize) -> String` - Filter by spec
   - `get_by_type(episode_type: &str, limit: usize) -> String` - Filter by type
   - `delete_episode(id: &str) -> String` - DELETE query
   - `clear_spec(spec_id: &str) -> String` - Delete all for spec
   - `count_all() -> String` - Count query

3. **Implement GraphitiMemoryStore** (`graphiti_store.rs`):
   ```rust
   pub struct GraphitiMemoryStore {
       client: fred::clients::RedisClient,
       config: GraphitiConfig,
   }

   impl GraphitiMemoryStore {
       pub async fn new(config: GraphitiConfig) -> MemoryResult<Self>;
       pub async fn connect(&self) -> MemoryResult<()>;
       async fn execute_cypher(&self, query: &str) -> MemoryResult<Value>;
   }

   #[async_trait]
   impl MemoryStore for GraphitiMemoryStore {
       // Implement all 11 trait methods
   }
   ```

4. **Implement all MemoryStore trait methods**:
   - `save_episode()` - Execute CREATE Cypher, create node with all Episode fields
   - `get_episode()` - Execute MATCH by id, parse result to Episode
   - `search()` - Execute full-text search query (FalkorDB supports this)
   - `get_session_history()` - MATCH by spec_id, ORDER BY created_at DESC
   - `get_by_type()` - MATCH by episode_type label
   - `delete_episode()` - DELETE by id
   - `clear_spec()` - DELETE WHERE spec_id = $spec_id
   - `get_all()` - MATCH all with LIMIT
   - `count()` - RETURN count(*)
   - `flush()` - No-op for FalkorDB (auto-persists)
   - `clear_all()` - MATCH (n) DELETE n

5. **Update MemoryManager for backend switching**:
   ```rust
   impl MemoryManager {
       pub async fn new(project_dir: &Path, settings: &ProjectSettings) -> MemoryResult<Self> {
           let store: Arc<dyn MemoryStore> = match settings.memory_backend.as_str() {
               "graphiti" => Arc::new(GraphitiMemoryStore::new(settings.graphiti_config()?).await?),
               _ => Arc::new(FileMemoryStore::new(project_dir)?),
           };
           // ...
       }
   }
   ```

6. **Handle FalkorDB graph schema**:
   - Episode nodes with labels: `:Episode:SessionInsight`, `:Episode:CodebaseDiscovery`, etc.
   - Properties: id, spec_id, project_id, content, summary, created_at, metadata
   - Indexes: CREATE INDEX ON :Episode(id), CREATE INDEX ON :Episode(spec_id)

**Verification**:
- [ ] `cargo build --package forge-memory` compiles
- [ ] `cargo test --package forge-memory` passes
- [ ] Integration test: start FalkorDB container, connect, CRUD episodes
- [ ] Backend switching test: create with "file", create with "graphiti", both work

---

### Phase 3: Graphiti MCP Client (OPTIONAL - Semantic Features Only)

**Objective**: Implement optional MCP protocol client for semantic/embedding features (entity extraction, relations). Direct FalkorDB handles core operations.

**Note**: This phase is OPTIONAL. The GraphitiMemoryStore uses direct Cypher for all core operations. MCP is only needed for advanced semantic features that require LLM-based entity extraction.

**Files to Modify**:
- `crates/forge-memory/Cargo.toml` - Add MCP-related dependencies (feature-gated)

**New Files to Create**:
- `crates/forge-memory/src/mcp_client.rs` - Optional MCP protocol client
- `crates/forge-memory/src/mcp_types.rs` - MCP message types

**Steps**:

1. **Feature-gate MCP dependencies**:
   ```toml
   [features]
   default = []
   mcp = ["reqwest"]

   [dependencies]
   reqwest = { version = "0.12", features = ["json"], optional = true }
   ```

2. **Define MCP message types** (`mcp_types.rs`):
   ```rust
   #[cfg(feature = "mcp")]
   #[derive(Serialize, Deserialize)]
   pub struct McpRequest {
       pub jsonrpc: String,  // "2.0"
       pub id: u64,
       pub method: String,
       pub params: Option<Value>,
   }
   // ... (only compiled with mcp feature)
   ```

3. **Implement optional MCP client** (`mcp_client.rs`):
   - Semantic search with embeddings
   - Entity extraction from text
   - Relation discovery between entities
   - All methods return graceful errors when MCP server unavailable

4. **GraphitiMemoryStore uses MCP only for**:
   - `semantic_search()` - Vector similarity search (optional enhancement)
   - `extract_entities()` - LLM-based entity extraction (optional)
   - Core `MemoryStore` trait uses direct Cypher (required)

**Verification**:
- [ ] `cargo build --package forge-memory` works without mcp feature
- [ ] `cargo build --package forge-memory --features mcp` enables MCP client
- [ ] MCP features gracefully degrade when server unavailable

---

### Phase 4: Native Rust Database Tools (Tiered by Role)

**Objective**: Add tiered database tools - Orchestrator gets diagnostic/healing tools, Agents get memory tools. Both share codebase navigation.

**Tool Tiering Design**:

| Tool | Orchestrator | Agent | Purpose |
|------|--------------|-------|---------|
| QueryMemory | ✓ | ✓ | Search project memory |
| SaveDiscovery | ✓ | ✓ | Record learnings |
| GetSessionHistory | ✓ | ✓ | Previous session context |
| QueryAgentSessions | ✓ | ✗ | Monitor agent status (diagnostic) |
| GetToolExecutions | ✓ | ✗ | Debug agent behavior (diagnostic) |
| UpdateSubtaskStatus | ✓ | ✗ | Manage implementation plan (healing) |
| RecordError | ✓ | ✗ | Error tracking (diagnostic) |
| RecordRecoveryAttempt | ✓ | ✗ | Recovery tracking (healing) |
| Read/Write/Grep/Glob/Bash | ✓ | ✓ | Codebase navigation |

**Files to Modify**:
- `crates/forge-tools/Cargo.toml` - Add forge-db-client and forge-memory dependencies
- `crates/forge-tools/src/claude_tools.rs` - Add new tool definitions and executor methods
- `crates/forge-tools/src/tools.rs` - Add database access to ForgeTools if needed
- `crates/forge-types/src/traits.rs` - Extend AgentTools trait with db methods (optional)

**Steps**:

1. **Add dependencies to forge-tools**:
   ```toml
   [dependencies]
   forge-db-client = { path = "../forge-db-client" }
   forge-memory = { path = "../forge-memory" }
   ```

2. **Define new tool schemas in claude_tools.rs**:

   ```rust
   // Tool 1: QueryMemory
   fn query_memory_tool() -> Tool {
       Tool::new(
           "QueryMemory",
           "Search the project memory for relevant context, discoveries, patterns, and session insights. Use this to recall information from previous sessions.",
           json!({
               "type": "object",
               "properties": {
                   "query": { "type": "string", "description": "Search query" },
                   "limit": { "type": "integer", "description": "Max results (default 10)" },
                   "episode_type": { "type": "string", "enum": ["SessionInsight", "CodebaseDiscovery", "Pattern", "Gotcha", "TaskOutcome", "QaResult"] }
               },
               "required": ["query"]
           }),
       )
   }

   // Tool 2: SaveDiscovery
   fn save_discovery_tool() -> Tool {
       Tool::new(
           "SaveDiscovery",
           "Save a learned pattern, insight, or discovery to project memory for future reference.",
           json!({
               "type": "object",
               "properties": {
                   "discovery_type": { "type": "string", "enum": ["Pattern", "Gotcha", "Insight"] },
                   "content": { "type": "string", "description": "The discovery content" },
                   "summary": { "type": "string", "description": "Brief summary" },
                   "file_paths": { "type": "array", "items": { "type": "string" } }
               },
               "required": ["discovery_type", "content", "summary"]
           }),
       )
   }

   // Tool 3: GetSessionHistory
   fn get_session_history_tool() -> Tool {
       Tool::new(
           "GetSessionHistory",
           "Retrieve context and outcomes from previous agent sessions for the current spec.",
           json!({
               "type": "object",
               "properties": {
                   "spec_id": { "type": "string", "description": "Spec ID to get history for" },
                   "limit": { "type": "integer", "description": "Max sessions (default 5)" }
               },
               "required": ["spec_id"]
           }),
       )
   }

   // Tool 4: QueryAgentSessions
   fn query_agent_sessions_tool() -> Tool {
       Tool::new(
           "QueryAgentSessions",
           "Query agent session data from SpacetimeDB. Get information about running, completed, or stuck sessions.",
           json!({
               "type": "object",
               "properties": {
                   "project_id": { "type": "string", "description": "Filter by project" },
                   "status": { "type": "string", "enum": ["running", "paused", "completed", "error", "stuck"] },
                   "agent_type": { "type": "string", "enum": ["Coder", "Planner", "QaReviewer", "Architect"] }
               }
           }),
       )
   }

   // Tool 5: GetToolExecutions
   fn get_tool_executions_tool() -> Tool {
       Tool::new(
           "GetToolExecutions",
           "Get tool execution history from a session. Useful for debugging and understanding what actions were taken.",
           json!({
               "type": "object",
               "properties": {
                   "session_id": { "type": "string", "description": "Session to query" },
                   "tool_name": { "type": "string", "description": "Filter by tool name" },
                   "limit": { "type": "integer", "description": "Max results (default 50)" }
               },
               "required": ["session_id"]
           }),
       )
   }

   // Tool 6: UpdateSubtaskStatus
   fn update_subtask_status_tool() -> Tool {
       Tool::new(
           "UpdateSubtaskStatus",
           "Update the status of a subtask in the implementation plan.",
           json!({
               "type": "object",
               "properties": {
                   "subtask_id": { "type": "string", "description": "Subtask ID" },
                   "status": { "type": "string", "enum": ["pending", "in_progress", "completed", "stuck", "skipped"] },
                   "notes": { "type": "string", "description": "Optional status notes" }
               },
               "required": ["subtask_id", "status"]
           }),
       )
   }
   ```

3. **Update get_tool_definitions()**:
   ```rust
   pub fn get_tool_definitions() -> Vec<Tool> {
       vec![
           read_tool(),
           write_tool(),
           bash_tool(),
           grep_tool(),
           glob_tool(),
           list_dir_tool(),
           // New database tools
           query_memory_tool(),
           save_discovery_tool(),
           get_session_history_tool(),
           query_agent_sessions_tool(),
           get_tool_executions_tool(),
           update_subtask_status_tool(),
       ]
   }
   ```

4. **Extend ToolExecutor with database clients**:
   ```rust
   pub struct ToolExecutor {
       tools: ForgeTools,
       project_root: std::path::PathBuf,
       db_client: Option<Arc<ForgeDbClient>>,
       memory_manager: Option<Arc<MemoryManager>>,
   }

   impl ToolExecutor {
       pub fn with_databases(
           tools: ForgeTools,
           db_client: Arc<ForgeDbClient>,
           memory_manager: Arc<MemoryManager>,
       ) -> Self;
   }
   ```

5. **Implement execute methods for each new tool**:
   - `execute_query_memory()` - Call memory_manager.search()
   - `execute_save_discovery()` - Create Episode, call memory_manager.save_episode()
   - `execute_get_session_history()` - Call memory_manager.get_session_history()
   - `execute_query_agent_sessions()` - Call db_client.get_project_sessions()
   - `execute_get_tool_executions()` - Call db_client.get_session_tool_executions()
   - `execute_update_subtask_status()` - Call db_client.update_subtask_status()

6. **Add match arms in execute()**:
   ```rust
   match name {
       // ... existing tools ...
       "QueryMemory" => self.execute_query_memory(input).await,
       "SaveDiscovery" => self.execute_save_discovery(input).await,
       "GetSessionHistory" => self.execute_get_session_history(input).await,
       "QueryAgentSessions" => self.execute_query_agent_sessions(input).await,
       "GetToolExecutions" => self.execute_get_tool_executions(input).await,
       "UpdateSubtaskStatus" => self.execute_update_subtask_status(input).await,
       _ => ToolResult::error(format!("Unknown tool: {}", name)),
   }
   ```

**Verification**:
- [ ] `cargo build --package forge-tools` compiles
- [ ] `cargo test --package forge-tools` passes
- [ ] All 6 new tools appear in get_tool_definitions()
- [ ] Integration test: execute each tool, verify results

---

### Phase 5: Tauri Integration, SpacetimeDB Bundling & Frontend Updates

**Objective**: Bundle SpacetimeDB as Tauri sidecar, wire up database clients, update frontend status displays

**Files to Modify**:
- `crates/forge-tauri/Cargo.toml` - Ensure forge-db-client dependency
- `crates/forge-tauri/tauri.conf.json` - Add SpacetimeDB sidecar configuration
- `crates/forge-tauri/src/state.rs` - Add ForgeDbClient to AppState
- `crates/forge-tauri/src/ipc/context.rs` - Use backend-aware MemoryManager
- `crates/forge-tauri/src/ipc/infrastructure.rs` - Add SpacetimeDB status checks + sidecar management
- `ui/src/components/project-settings/MemoryBackendSection.tsx` - Show actual connection status
- `ui/src/hooks/useInfrastructureStatus.ts` - Add SpacetimeDB status

**New Files to Create**:
- `crates/forge-tauri/src/sidecar/mod.rs` - Sidecar process management
- `crates/forge-tauri/src/sidecar/spacetime.rs` - SpacetimeDB sidecar lifecycle

**Steps**:

0. **Bundle SpacetimeDB binary as Tauri sidecar**:

   a. Configure sidecar in `tauri.conf.json`:
   ```json
   {
     "bundle": {
       "externalBin": [
         "binaries/spacetime"
       ]
     }
   }
   ```

   b. Create sidecar management module (`sidecar/spacetime.rs`):
   ```rust
   pub struct SpacetimeSidecar {
       process: Option<Child>,
       port: u16,
       data_dir: PathBuf,
   }

   impl SpacetimeSidecar {
       pub async fn start(app: &AppHandle) -> Result<Self, SidecarError>;
       pub async fn stop(&mut self) -> Result<(), SidecarError>;
       pub async fn ensure_module_published(&self) -> Result<(), SidecarError>;
       pub fn connection_url(&self) -> String;
   }
   ```

   c. Lifecycle:
   - On app start: Start SpacetimeDB sidecar process
   - First run: Auto-publish forge-db module
   - On app exit: Graceful shutdown of sidecar
   - Store data in `~/.forge/spacetimedb/`

1. **Add ForgeDbClient to AppState**:
   ```rust
   pub struct AppState {
       // ... existing fields ...
       db_client: Arc<ForgeDbClient>,
   }

   impl AppState {
       pub fn db_client(&self) -> &Arc<ForgeDbClient> {
           &self.db_client
       }
   }
   ```

2. **Initialize SpacetimeDB connection on app start**:
   ```rust
   // In main.rs or setup
   let db_client = Arc::new(ForgeDbClient::local());
   tokio::spawn(async move {
       if let Err(e) = db_client.connect().await {
           warn!("SpacetimeDB connection failed: {}", e);
       }
   });
   ```

3. **Add SpacetimeDB status IPC handler**:
   ```rust
   #[tauri::command]
   pub async fn infra_get_spacetimedb_status(
       state: State<'_, Arc<AppState>>,
   ) -> IpcResult<SpacetimeDbStatus> {
       Ok(SpacetimeDbStatus {
           connected: state.db_client().is_connected().await,
           url: state.db_client().connection_url(),
           database: "forge-db".to_string(),
       })
   }
   ```

4. **Update frontend infrastructure status hook**:
   - Add `spacetimeDbStatus` field
   - Fetch from new IPC endpoint
   - Display connection status in UI

5. **Update MemoryBackendSection component**:
   - Show "Connected" / "Disconnected" for Graphiti
   - Show episode count when connected
   - Show SpacetimeDB status alongside

**Verification**:
- [ ] App starts and connects to SpacetimeDB
- [ ] Frontend shows accurate SpacetimeDB status
- [ ] Frontend shows accurate Graphiti/FalkorDB status
- [ ] Memory backend switching works from UI

---

### Phase 6: Integration Tests

**Objective**: Comprehensive tests for both database integrations

**New Files to Create**:
- `crates/forge-db-client/tests/integration.rs` - SpacetimeDB integration tests
- `crates/forge-memory/tests/graphiti_integration.rs` - FalkorDB integration tests
- `crates/forge-tools/tests/database_tools_integration.rs` - Tool integration tests

**Steps**:

1. **SpacetimeDB integration tests**:
   ```rust
   #[tokio::test]
   #[ignore] // Requires running SpacetimeDB
   async fn test_full_session_workflow() {
       let client = ForgeDbClient::local();
       client.connect().await.unwrap();

       // Start session
       client.start_session(...).await.unwrap();

       // Record messages
       client.record_message(...).await.unwrap();

       // Record tool executions
       client.record_tool_execution(...).await.unwrap();

       // Verify data via queries
       let sessions = client.get_sessions().await;
       assert!(!sessions.is_empty());
   }
   ```

2. **FalkorDB integration tests**:
   ```rust
   #[tokio::test]
   #[ignore] // Requires running FalkorDB
   async fn test_graphiti_memory_store() {
       let config = GraphitiConfig::local();
       let store = GraphitiMemoryStore::new(config).await.unwrap();

       // Save episode
       let episode = Episode::new_discovery(...);
       store.save_episode(episode.clone()).await.unwrap();

       // Retrieve
       let retrieved = store.get_episode(&episode.id).await.unwrap();
       assert!(retrieved.is_some());

       // Search
       let results = store.search("test query", 10).await.unwrap();
       assert!(!results.is_empty());
   }
   ```

3. **Database tools integration tests**:
   ```rust
   #[tokio::test]
   #[ignore] // Requires both databases
   async fn test_query_memory_tool() {
       let executor = create_test_executor_with_dbs().await;

       let result = executor.execute("QueryMemory", &json!({
           "query": "authentication",
           "limit": 5
       })).await;

       assert!(result.success);
   }
   ```

**Verification**:
- [ ] All integration tests pass with running databases
- [ ] Tests are properly marked with `#[ignore]` for CI
- [ ] Documentation on how to run integration tests

---

## Testing Strategy

### Unit Tests
- Mock-based tests for all new code paths
- Test Cypher query generation
- Test MCP message serialization
- Test tool schema validation

### Integration Tests
- SpacetimeDB full workflow (session → messages → tools → complete)
- FalkorDB CRUD operations
- Backend switching (file → graphiti → file)
- Tool execution with real databases

### Manual Testing
1. Start SpacetimeDB: `spacetime start`
2. Publish module: `spacetime publish forge-db`
3. Start FalkorDB: `docker run -d -p 6379:6379 falkordb/falkordb`
4. Start Forge app
5. Verify:
   - SpacetimeDB status shows "Connected"
   - FalkorDB status shows "Running"
   - Switch memory backend to "graphiti"
   - Use agent tools to query/save data
   - Verify data persists across app restarts

## Rollback Plan

1. **Phase 1 (SpacetimeDB)**: Revert to stub implementation - app still functions
2. **Phase 2 (FalkorDB)**: Remove GraphitiMemoryStore - file backend remains default
3. **Phase 3 (MCP)**: Remove MCP client - direct FalkorDB still works
4. **Phase 4 (Tools)**: Remove new tools from definitions - existing tools unaffected
5. **Phase 5 (Tauri)**: Revert state changes - app starts without db connection

All phases are additive and can be rolled back independently.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| SpacetimeDB SDK incompatibility | Medium | High | Pin to specific SDK version, test thoroughly |
| FalkorDB Cypher dialect differences | Low | Medium | Use only standard Cypher features |
| Connection failures in production | Medium | Medium | Implement reconnection logic, graceful degradation |
| Performance issues with large datasets | Low | Medium | Add pagination, use appropriate indexes |
| MCP protocol changes | Low | Low | Version pin MCP spec, abstract behind interface |
| Tool execution timeouts | Low | Medium | Add configurable timeouts, async execution |

## Resolved Decisions

1. **SpacetimeDB deployment**: ✅ Bundle as Tauri sidecar - zero-config for users, auto-start on app launch

2. **Graphiti MCP vs Direct FalkorDB**: ✅ Direct Cypher for core MemoryStore operations; MCP optional (feature-gated) for semantic/embedding features

3. **Tool availability**: ✅ Tiered approach:
   - **Orchestrator**: All tools (diagnostic, healing, memory, codebase)
   - **Agents**: Memory tools + codebase navigation (leaner toolset)

---

## Implementation Approach

Follow the reminder in the Summary: **Use sub-agents set to Opus model, working in parallel wherever possible**.

Suggested parallel execution groups:
- **Group A** (Phase 1): SpacetimeDB SDK integration
- **Group B** (Phase 2): FalkorDB GraphitiMemoryStore
- **Group C** (Phase 4): Tool definitions (can start once types are defined)

Sequential dependencies:
- Phase 5 (Tauri integration) depends on Phases 1, 2, 4
- Phase 6 (Integration tests) depends on all prior phases

---

**Status: APPROVED - Ready for implementation**
