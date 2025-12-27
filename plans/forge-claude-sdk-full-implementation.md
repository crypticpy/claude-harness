# Implementation Plan: Forge Claude Integration - Direct API + Claude Code Max SDK

Created: 2025-12-21
Status: PENDING APPROVAL

## Summary

This plan covers two major components: (1) Solidifying the existing `forge-anthropic` crate for direct Anthropic API access with production-ready features, and (2) Creating a new `forge-claude-sdk` crate that provides complete Claude Code Max integration by internally managing the Claude CLI subprocess, handling OAuth authentication, streaming responses, and executing tools - all without external SDK dependencies.

## Scope

### In Scope
- **Part 1: forge-anthropic Tuneup**
  - Automatic retry logic with exponential backoff
  - Proper rate limit handling with retry-after headers
  - Connection pooling configuration
  - Request/response logging hooks
  - Environment variable fallback for API keys
  - Extended thinking support (thinking blocks)
  - Prompt caching support
  - Better token estimation

- **Part 2: forge-claude-sdk (New Crate)**
  - OAuth token management (detect, store, retrieve)
  - Claude CLI subprocess management (spawn, communicate, terminate)
  - Streaming response parser (text blocks, tool use blocks, tool results)
  - Full tool execution loop (query -> tool_use -> execute -> tool_result -> continue)
  - Hook system (PreToolUse, PostToolUse)
  - MCP server integration support
  - Settings file generation
  - Integration with forge-agent ecosystem

### Out of Scope
- Multi-provider abstraction (OpenAI, Gemini, etc.)
- Computer use/browser automation tools
- Custom MCP server implementations (use existing forge-tools)
- Changes to UI/frontend components (uses existing OAuth flow)

## Prerequisites
- Claude CLI installed (`npm install -g @anthropic-ai/claude-code`)
- Rust 1.75+ with async-trait, tokio, serde
- Working OAuth authentication (claude setup-token)

## Execution Strategy

### Parallel Sub-Agent Deployment
- **All sub-agents MUST be set to Opus model** for maximum capability
- Use `forge-rust-backend` sub-agent for Rust crate development (specialized in crate structure, API contracts, database operations)
- Deploy multiple agents in parallel where phases are independent
- Each phase ends with `final-review-completeness` agent (Opus) to verify no mocks, placeholders, or TODOs remain

### Agent Parallelization Map
```
Part 1 Parallel Groups:
  Group A: Phase 1.1 (Retry) + Phase 1.2 (Connection) - Independent
  Group B: Phase 1.3 (Thinking) + Phase 1.4 (Caching) - Independent
  Group C: Phase 1.5 (Hooks) + Phase 1.6 (Env Vars) - Independent
  → After each group: final-review-completeness (Opus)

Part 2 Parallel Groups:
  Group A: Phase 2.1 (Types) - Foundation, must complete first
  → final-review-completeness (Opus)

  Group B: Phase 2.2 (Auth) + Phase 2.3 (Process) - Independent after 2.1
  → final-review-completeness (Opus)

  Group C: Phase 2.4 (Parser) + Phase 2.6 (Hooks) - Independent after 2.1
  → final-review-completeness (Opus)

  Group D: Phase 2.5 (Executor) - Depends on 2.4, 2.6
  → final-review-completeness (Opus)

  Group E: Phase 2.7 (Client) - Depends on 2.2, 2.3, 2.5
  → final-review-completeness (Opus)

  Group F: Phase 2.8 (Service) + Phase 2.9 (MCP) + Phase 2.10 (Settings) - After 2.7
  → final-review-completeness (Opus)
```

### Sub-Agent Assignments
| Phase | Primary Agent | Model |
|-------|---------------|-------|
| All Rust crate work | `forge-rust-backend` | Opus |
| Code review after each phase | `final-review-completeness` | Opus |
| Complex debugging if needed | `debugger-detective` | Opus |

---

## Part 1: forge-anthropic Tuneup

### Phase 1.1: Retry Logic and Rate Limit Handling
**Objective**: Add automatic retry with exponential backoff for transient failures

**Files to Modify**:
- `crates/forge-anthropic/src/client.rs` - Add retry logic to request methods
- `crates/forge-anthropic/src/lib.rs` - Export new retry configuration types

**Files to Create**:
- `crates/forge-anthropic/src/retry.rs` - RetryConfig, RetryPolicy, backoff utilities

**Steps**:
1. Create `RetryConfig` struct with:
   - `max_retries: u32` (default: 3)
   - `initial_delay_ms: u64` (default: 1000)
   - `max_delay_ms: u64` (default: 60000)
   - `backoff_multiplier: f64` (default: 2.0)
   - `jitter: bool` (default: true)
2. Implement `RetryPolicy` trait with methods:
   - `should_retry(&self, error: &ClientError, attempt: u32) -> bool`
   - `delay_for_attempt(&self, attempt: u32) -> Duration`
3. Update `AnthropicClient` to accept optional `RetryConfig`
4. Wrap `create_message` and `create_message_stream` with retry logic
5. Parse `retry-after` header from 429 responses
6. Add `ClientError::Retryable` variant for classification

**Verification**:
- [ ] Unit tests for retry logic with mock responses
- [ ] Test exponential backoff timing
- [ ] Test jitter randomization
- [ ] Test max retry limit respected
- [ ] **Run `final-review-completeness` agent (Opus)** - Verify no TODOs, placeholders, or incomplete implementations

### Phase 1.2: Connection Pooling and Timeout Configuration
**Objective**: Add configurable connection management

**Files to Modify**:
- `crates/forge-anthropic/src/client.rs` - Add connection pool settings to ClientConfig

**Steps**:
1. Add to `ClientConfig`:
   - `pool_idle_timeout_secs: Option<u64>` (default: 90)
   - `pool_max_idle_per_host: usize` (default: 10)
   - `connect_timeout_secs: u64` (default: 30)
   - `read_timeout_secs: u64` (default: 300)
2. Configure reqwest client with these settings in `AnthropicClient::new()`
3. Add `with_pool_config()` builder method
4. Add connection health check method

**Verification**:
- [ ] Connection reuse visible in debug logs
- [ ] Timeout behavior verified
- [ ] **Run `final-review-completeness` agent (Opus)** - Verify no TODOs, placeholders, or incomplete implementations

### Phase 1.3: Extended Thinking Support
**Objective**: Add support for Claude's extended thinking feature

**Files to Modify**:
- `crates/forge-anthropic/src/types.rs` - Add thinking block types
- `crates/forge-anthropic/src/client.rs` - Add thinking to StreamAccumulator

**Steps**:
1. Add `ContentBlock::Thinking` variant:
   ```rust
   Thinking { thinking: String, signature: Option<String> }
   ```
2. Add to `MessagesRequest`:
   - `thinking: Option<ThinkingConfig>`
   ```rust
   pub struct ThinkingConfig {
       pub budget_tokens: u32,
   }
   ```
3. Update `StreamAccumulator` to handle thinking deltas:
   - `ContentBlockDelta::ThinkingDelta { thinking: String }`
4. Add `with_thinking(budget_tokens: u32)` builder method
5. Add `thinking_content()` method to response for extracting thinking

**Verification**:
- [ ] Thinking blocks parsed correctly
- [ ] Streaming thinking works
- [ ] Budget respected in requests
- [ ] **Run `final-review-completeness` agent (Opus)** - Verify no TODOs, placeholders, or incomplete implementations

### Phase 1.4: Prompt Caching Support
**Objective**: Enable prompt caching for repeated context

**Files to Modify**:
- `crates/forge-anthropic/src/types.rs` - Add cache control types
- `crates/forge-anthropic/src/client.rs` - Add caching utilities

**Steps**:
1. Add `CacheControl` struct:
   ```rust
   pub struct CacheControl {
       pub cache_type: CacheType,
   }
   pub enum CacheType {
       Ephemeral,
   }
   ```
2. Add `cache_control: Option<CacheControl>` to system prompt in request
3. Track cache stats in `Usage`:
   - Already exists: `cache_creation_input_tokens`, `cache_read_input_tokens`
   - Add methods to check cache hit ratio
4. Add `with_cache_control()` builder method
5. Log cache statistics at debug level

**Verification**:
- [ ] Cache control sent in request
- [ ] Cache statistics tracked
- [ ] Cost calculation includes cache savings
- [ ] **Run `final-review-completeness` agent (Opus)** - Verify no TODOs, placeholders, or incomplete implementations

### Phase 1.5: Request/Response Logging Hooks
**Objective**: Add hooks for debugging and monitoring

**Files to Create**:
- `crates/forge-anthropic/src/hooks.rs` - Hook trait and implementations

**Files to Modify**:
- `crates/forge-anthropic/src/client.rs` - Integrate hooks

**Steps**:
1. Create `RequestHook` trait:
   ```rust
   #[async_trait]
   pub trait RequestHook: Send + Sync {
       async fn on_request(&self, request: &MessagesRequest);
       async fn on_response(&self, response: &MessagesResponse, duration: Duration);
       async fn on_error(&self, error: &ClientError, duration: Duration);
   }
   ```
2. Create `LoggingHook` implementation using tracing
3. Create `MetricsHook` for collecting statistics
4. Add `hooks: Vec<Arc<dyn RequestHook>>` to `AnthropicClient`
5. Call hooks before/after each request

**Verification**:
- [ ] Hooks called on success
- [ ] Hooks called on error
- [ ] Duration tracked correctly
- [ ] **Run `final-review-completeness` agent (Opus)** - Verify no TODOs, placeholders, or incomplete implementations

### Phase 1.6: Environment Variable Fallback
**Objective**: Support standard environment variable configuration

**Files to Modify**:
- `crates/forge-anthropic/src/client.rs` - Add from_env constructor

**Steps**:
1. Add `ClientConfig::from_env()` method:
   - Check `ANTHROPIC_API_KEY`
   - Check `ANTHROPIC_BASE_URL` (optional, defaults to production)
   - Check `ANTHROPIC_MODEL` (optional, defaults to opus-4.5)
   - Check `ANTHROPIC_MAX_TOKENS` (optional)
   - Check `ANTHROPIC_TIMEOUT` (optional)
2. Add `AnthropicClient::from_env()` convenience constructor
3. Return descriptive error if required env vars missing

**Verification**:
- [ ] Works with API key set
- [ ] Custom base URL respected
- [ ] Optional vars apply correctly
- [ ] **Run `final-review-completeness` agent (Opus)** - Verify no TODOs, placeholders, or incomplete implementations

---

## Part 2: forge-claude-sdk (New Crate)

### Phase 2.1: Crate Structure and Core Types
**Objective**: Create the new crate with foundational types

**Files to Create**:
- `crates/forge-claude-sdk/Cargo.toml`
- `crates/forge-claude-sdk/src/lib.rs`
- `crates/forge-claude-sdk/src/types.rs`
- `crates/forge-claude-sdk/src/error.rs`

**Cargo.toml Dependencies**:
```toml
[package]
name = "forge-claude-sdk"
version = "0.1.0"
edition = "2021"

[dependencies]
async-trait = "0.1"
futures = "0.3"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "1.0"
tokio = { version = "1", features = ["full", "process"] }
tokio-stream = "0.1"
tracing = "0.1"
uuid = { version = "1", features = ["v4"] }
async-stream = "0.3"

# Internal dependencies
forge-tools = { path = "../forge-tools" }
forge-types = { path = "../forge-types" }
```

**Steps**:
1. Create crate directory structure
2. Define core types in `types.rs`:
   ```rust
   pub struct ClaudeAgentOptions {
       pub model: String,
       pub system_prompt: Option<String>,
       pub allowed_tools: Vec<String>,
       pub mcp_servers: HashMap<String, McpServerConfig>,
       pub hooks: HookConfig,
       pub max_turns: u32,
       pub cwd: PathBuf,
       pub env: HashMap<String, String>,
       pub max_thinking_tokens: Option<u32>,
       pub settings_path: Option<PathBuf>,
   }

   pub enum McpServerConfig {
       Command { command: String, args: Vec<String> },
       Http { url: String, headers: HashMap<String, String> },
   }

   pub struct HookConfig {
       pub pre_tool_use: Vec<HookMatcher>,
       pub post_tool_use: Vec<HookMatcher>,
   }

   pub struct HookMatcher {
       pub matcher: String,  // Tool name pattern
       pub hooks: Vec<Arc<dyn Hook>>,
   }
   ```
3. Define message types:
   ```rust
   pub enum SdkMessage {
       Assistant(AssistantMessage),
       User(UserMessage),
       System(SystemMessage),
   }

   pub struct AssistantMessage {
       pub content: Vec<ContentBlock>,
   }

   pub enum ContentBlock {
       Text { text: String },
       ToolUse { id: String, name: String, input: serde_json::Value },
       Thinking { thinking: String },
   }

   pub struct UserMessage {
       pub content: Vec<UserContentBlock>,
   }

   pub enum UserContentBlock {
       Text { text: String },
       ToolResult { tool_use_id: String, content: String, is_error: bool },
   }
   ```
4. Define error types in `error.rs`:
   ```rust
   #[derive(Debug, Error)]
   pub enum SdkError {
       #[error("Claude CLI not found")]
       CliNotFound,
       #[error("Authentication required: {0}")]
       AuthRequired(String),
       #[error("Process error: {0}")]
       ProcessError(String),
       #[error("Parse error: {0}")]
       ParseError(String),
       #[error("Tool execution failed: {tool} - {message}")]
       ToolError { tool: String, message: String },
       #[error("Hook blocked: {0}")]
       HookBlocked(String),
       #[error("Timeout after {0} seconds")]
       Timeout(u64),
       #[error("Max turns ({0}) exceeded")]
       MaxTurnsExceeded(u32),
   }
   ```

**Verification**:
- [ ] Crate compiles
- [ ] Types serialize/deserialize correctly
- [ ] Error types implement std::error::Error
- [ ] **Run `final-review-completeness` agent (Opus)** - Verify no TODOs, placeholders, or incomplete implementations

### Phase 2.2: OAuth Token Management
**Objective**: Manage Claude Code OAuth tokens

**Files to Create**:
- `crates/forge-claude-sdk/src/auth.rs`

**Steps**:
1. Create `TokenManager` struct:
   ```rust
   pub struct TokenManager {
       keychain_service: String,
   }

   impl TokenManager {
       pub fn new() -> Self;
       pub fn get_token(&self) -> Result<String, SdkError>;
       pub fn has_token(&self) -> bool;
       pub fn set_token(&self, token: &str) -> Result<(), SdkError>;
       pub fn clear_token(&self) -> Result<(), SdkError>;
   }
   ```
2. Implement token resolution priority:
   - Environment variable: `CLAUDE_CODE_OAUTH_TOKEN`
   - Environment variable: `ANTHROPIC_AUTH_TOKEN`
   - Environment variable: `ANTHROPIC_API_KEY`
3. Add CLI authentication check:
   ```rust
   pub async fn check_cli_auth() -> Result<bool, SdkError> {
       // Run "claude -p 'test' --max-budget-usd 0.001"
       // Check for auth errors in output
   }
   ```
4. Add token setup helper:
   ```rust
   pub async fn setup_token() -> Result<String, SdkError> {
       // Run "claude setup-token"
       // Parse output for token
       // Store in environment
   }
   ```

**Verification**:
- [ ] Environment variable lookup works
- [ ] Token priority order correct
- [ ] CLI auth check detects authenticated/unauthenticated states
- [ ] **Run `final-review-completeness` agent (Opus)** - Verify no TODOs, placeholders, or incomplete implementations

### Phase 2.3: Claude CLI Process Manager
**Objective**: Spawn and manage Claude CLI subprocess

**Files to Create**:
- `crates/forge-claude-sdk/src/process.rs`

**Steps**:
1. Create `ClaudeProcess` struct:
   ```rust
   pub struct ClaudeProcess {
       child: tokio::process::Child,
       stdin: ChildStdin,
       stdout: BufReader<ChildStdout>,
       stderr: BufReader<ChildStderr>,
       options: ClaudeAgentOptions,
   }

   impl ClaudeProcess {
       pub async fn spawn(options: ClaudeAgentOptions) -> Result<Self, SdkError>;
       pub async fn send(&mut self, message: &str) -> Result<(), SdkError>;
       pub async fn read_line(&mut self) -> Result<Option<String>, SdkError>;
       pub async fn kill(&mut self) -> Result<(), SdkError>;
       pub fn is_running(&self) -> bool;
   }
   ```
2. Implement spawn logic:
   - Build CLI arguments from options
   - Set environment variables (CLAUDE_CODE_OAUTH_TOKEN, etc.)
   - Configure stdin/stdout/stderr as piped
   - Set working directory
   - Generate settings file if needed
3. CLI argument builder:
   ```rust
   fn build_cli_args(options: &ClaudeAgentOptions) -> Vec<String> {
       let mut args = vec![];
       args.push("--model".to_string());
       args.push(options.model.clone());
       if let Some(ref prompt) = options.system_prompt {
           args.push("--system-prompt".to_string());
           args.push(prompt.clone());
       }
       for tool in &options.allowed_tools {
           args.push("--allowed-tool".to_string());
           args.push(tool.clone());
       }
       // ... etc
       args
   }
   ```
4. Settings file generator:
   ```rust
   fn generate_settings_file(options: &ClaudeAgentOptions) -> Result<PathBuf, SdkError> {
       let settings = json!({
           "permissions": {
               "allow": options.allowed_tools.iter()
                   .map(|t| format!("{}(*)", t))
                   .collect::<Vec<_>>()
           }
       });
       // Write to temp file
       // Return path
   }
   ```

**Verification**:
- [ ] Process spawns successfully
- [ ] Environment variables passed correctly
- [ ] Stdin/stdout communication works
- [ ] Process cleanup on drop
- [ ] **Run `final-review-completeness` agent (Opus)** - Verify no TODOs, placeholders, or incomplete implementations

### Phase 2.4: Streaming Response Parser
**Objective**: Parse Claude CLI output stream

**Files to Create**:
- `crates/forge-claude-sdk/src/parser.rs`

**Steps**:
1. Define CLI output format (JSON lines):
   ```rust
   #[derive(Deserialize)]
   #[serde(tag = "type")]
   enum CliEvent {
       #[serde(rename = "message_start")]
       MessageStart { message: MessageInfo },
       #[serde(rename = "content_block_start")]
       ContentBlockStart { index: usize, content_block: ContentBlockInfo },
       #[serde(rename = "content_block_delta")]
       ContentBlockDelta { index: usize, delta: DeltaInfo },
       #[serde(rename = "content_block_stop")]
       ContentBlockStop { index: usize },
       #[serde(rename = "message_stop")]
       MessageStop,
       #[serde(rename = "tool_use")]
       ToolUse { id: String, name: String, input: Value },
       #[serde(rename = "tool_result")]
       ToolResult { tool_use_id: String },
       #[serde(rename = "error")]
       Error { message: String },
   }
   ```
2. Create streaming parser:
   ```rust
   pub struct StreamParser {
       current_text: String,
       current_tool: Option<ToolUseBuilder>,
       messages: Vec<SdkMessage>,
   }

   impl StreamParser {
       pub fn new() -> Self;
       pub fn process_line(&mut self, line: &str) -> Result<Option<ParseEvent>, SdkError>;
       pub fn finish(self) -> Vec<SdkMessage>;
   }

   pub enum ParseEvent {
       TextDelta(String),
       ToolUseStart { id: String, name: String },
       ToolUseComplete { id: String, name: String, input: Value },
       ThinkingDelta(String),
       MessageComplete,
       Error(String),
   }
   ```
3. Create async stream adapter:
   ```rust
   pub fn parse_stream(
       reader: BufReader<ChildStdout>,
   ) -> impl Stream<Item = Result<ParseEvent, SdkError>> {
       async_stream::stream! {
           let mut parser = StreamParser::new();
           let mut lines = reader.lines();
           while let Some(line) = lines.next_line().await? {
               if let Some(event) = parser.process_line(&line)? {
                   yield Ok(event);
               }
           }
       }
   }
   ```

**Verification**:
- [ ] Text deltas accumulated correctly
- [ ] Tool use blocks parsed completely
- [ ] Thinking blocks handled
- [ ] Errors propagated
- [ ] **Run `final-review-completeness` agent (Opus)** - Verify no TODOs, placeholders, or incomplete implementations

### Phase 2.5: Tool Execution Loop
**Objective**: Implement the agentic tool-use cycle

**Files to Create**:
- `crates/forge-claude-sdk/src/executor.rs`

**Steps**:
1. Create tool executor wrapper:
   ```rust
   pub struct SdkToolExecutor {
       forge_executor: ToolExecutor,
       hooks: HookConfig,
   }

   impl SdkToolExecutor {
       pub async fn execute(
           &self,
           tool_use: &ToolUse,
       ) -> Result<ToolResultBlock, SdkError> {
           // 1. Run pre-tool hooks
           for hook in self.get_matching_hooks(&tool_use.name, HookPhase::Pre) {
               let decision = hook.execute(&tool_use).await?;
               if decision.blocked {
                   return Err(SdkError::HookBlocked(decision.reason));
               }
           }

           // 2. Execute tool
           let result = self.forge_executor
               .execute(&tool_use.name, &tool_use.input)
               .await;

           // 3. Run post-tool hooks
           for hook in self.get_matching_hooks(&tool_use.name, HookPhase::Post) {
               hook.on_result(&tool_use, &result).await?;
           }

           // 4. Format result
           Ok(ToolResultBlock {
               tool_use_id: tool_use.id.clone(),
               content: result.output,
               is_error: !result.success,
           })
       }
   }
   ```
2. Create agentic loop:
   ```rust
   pub async fn run_agentic_loop(
       process: &mut ClaudeProcess,
       executor: &SdkToolExecutor,
       max_turns: u32,
   ) -> Result<Vec<SdkMessage>, SdkError> {
       let mut turn = 0;
       let mut all_messages = Vec::new();

       loop {
           turn += 1;
           if turn > max_turns {
               return Err(SdkError::MaxTurnsExceeded(max_turns));
           }

           // Read assistant response
           let response = read_assistant_response(process).await?;
           all_messages.push(SdkMessage::Assistant(response.clone()));

           // Check for tool uses
           let tool_uses: Vec<_> = response.content.iter()
               .filter_map(|b| b.as_tool_use())
               .collect();

           if tool_uses.is_empty() {
               // No tools = conversation complete
               break;
           }

           // Execute all tools
           let mut results = Vec::new();
           for tool_use in tool_uses {
               let result = executor.execute(&tool_use).await?;
               results.push(result);
           }

           // Send tool results back
           let user_msg = UserMessage {
               content: results.into_iter()
                   .map(UserContentBlock::ToolResult)
                   .collect(),
           };
           send_message(process, &user_msg).await?;
           all_messages.push(SdkMessage::User(user_msg));
       }

       Ok(all_messages)
   }
   ```

**Verification**:
- [ ] Single tool use works
- [ ] Multiple parallel tool uses work
- [ ] Tool results sent correctly
- [ ] Loop terminates on no tools
- [ ] Max turns respected
- [ ] **Run `final-review-completeness` agent (Opus)** - Verify no TODOs, placeholders, or incomplete implementations

### Phase 2.6: Hook System
**Objective**: Implement pre/post tool use hooks

**Files to Create**:
- `crates/forge-claude-sdk/src/hooks.rs`

**Steps**:
1. Define hook trait:
   ```rust
   #[async_trait]
   pub trait Hook: Send + Sync {
       async fn on_tool_use(
           &self,
           tool_name: &str,
           tool_input: &Value,
           tool_use_id: &str,
       ) -> Result<HookDecision, SdkError>;
   }

   pub struct HookDecision {
       pub blocked: bool,
       pub reason: Option<String>,
       pub modified_input: Option<Value>,
   }

   impl HookDecision {
       pub fn allow() -> Self { Self { blocked: false, reason: None, modified_input: None } }
       pub fn block(reason: impl Into<String>) -> Self {
           Self { blocked: true, reason: Some(reason.into()), modified_input: None }
       }
   }
   ```
2. Create built-in security hook:
   ```rust
   pub struct BashSecurityHook {
       blocked_patterns: Vec<Regex>,
   }

   impl BashSecurityHook {
       pub fn default() -> Self {
           Self {
               blocked_patterns: vec![
                   Regex::new(r"rm\s+-rf\s+/").unwrap(),
                   Regex::new(r":\(\)\{:\|:&\};:").unwrap(),  // Fork bomb
                   Regex::new(r"mkfs").unwrap(),
                   Regex::new(r"dd\s+if=.*of=/dev").unwrap(),
               ],
           }
       }
   }

   #[async_trait]
   impl Hook for BashSecurityHook {
       async fn on_tool_use(
           &self,
           tool_name: &str,
           tool_input: &Value,
           _tool_use_id: &str,
       ) -> Result<HookDecision, SdkError> {
           if tool_name != "Bash" {
               return Ok(HookDecision::allow());
           }

           let command = tool_input.get("command")
               .and_then(|v| v.as_str())
               .unwrap_or("");

           for pattern in &self.blocked_patterns {
               if pattern.is_match(command) {
                   return Ok(HookDecision::block(format!(
                       "Command blocked by security policy: matches pattern '{}'",
                       pattern
                   )));
               }
           }

           Ok(HookDecision::allow())
       }
   }
   ```
3. Create hook matcher:
   ```rust
   pub fn matches_tool(pattern: &str, tool_name: &str) -> bool {
       if pattern == "*" {
           return true;
       }
       if pattern.ends_with('*') {
           tool_name.starts_with(&pattern[..pattern.len()-1])
       } else {
           pattern == tool_name
       }
   }
   ```

**Verification**:
- [ ] Hook called before tool execution
- [ ] Block decision prevents execution
- [ ] Allow decision permits execution
- [ ] Pattern matching works
- [ ] **Run `final-review-completeness` agent (Opus)** - Verify no TODOs, placeholders, or incomplete implementations

### Phase 2.7: ClaudeSdkClient - Main API
**Objective**: Create the main client interface

**Files to Create**:
- `crates/forge-claude-sdk/src/client.rs`

**Steps**:
1. Create main client:
   ```rust
   pub struct ClaudeSdkClient {
       options: ClaudeAgentOptions,
       process: Option<ClaudeProcess>,
       executor: SdkToolExecutor,
       token_manager: TokenManager,
   }

   impl ClaudeSdkClient {
       pub fn new(options: ClaudeAgentOptions) -> Result<Self, SdkError>;

       pub async fn connect(&mut self) -> Result<(), SdkError> {
           // Verify authentication
           let token = self.token_manager.get_token()?;

           // Spawn process
           let mut opts = self.options.clone();
           opts.env.insert("CLAUDE_CODE_OAUTH_TOKEN".to_string(), token);

           self.process = Some(ClaudeProcess::spawn(opts).await?);
           Ok(())
       }

       pub async fn query(&mut self, message: &str) -> Result<(), SdkError> {
           let process = self.process.as_mut()
               .ok_or(SdkError::ProcessError("Not connected".to_string()))?;

           process.send(message).await
       }

       pub fn receive_response(&mut self) -> impl Stream<Item = Result<SdkMessage, SdkError>> + '_ {
           async_stream::stream! {
               let process = self.process.as_mut()
                   .ok_or(SdkError::ProcessError("Not connected".to_string()))?;

               loop {
                   let response = read_assistant_response(process).await?;
                   yield Ok(SdkMessage::Assistant(response.clone()));

                   let tool_uses = extract_tool_uses(&response);
                   if tool_uses.is_empty() {
                       break;
                   }

                   // Execute tools and send results
                   for tool_use in tool_uses {
                       let result = self.executor.execute(&tool_use).await?;
                       send_tool_result(process, &result).await?;
                       yield Ok(SdkMessage::User(UserMessage {
                           content: vec![UserContentBlock::ToolResult(result)],
                       }));
                   }
               }
           }
       }

       pub async fn disconnect(&mut self) -> Result<(), SdkError> {
           if let Some(ref mut process) = self.process {
               process.kill().await?;
           }
           self.process = None;
           Ok(())
       }
   }

   impl Drop for ClaudeSdkClient {
       fn drop(&mut self) {
           if let Some(ref mut process) = self.process {
               let _ = process.kill();
           }
       }
   }
   ```
2. Add convenience methods:
   ```rust
   impl ClaudeSdkClient {
       /// Run a single query and return all messages
       pub async fn run(&mut self, prompt: &str) -> Result<Vec<SdkMessage>, SdkError> {
           self.connect().await?;
           self.query(prompt).await?;

           let mut messages = Vec::new();
           let mut stream = self.receive_response();
           while let Some(msg) = stream.next().await {
               messages.push(msg?);
           }

           self.disconnect().await?;
           Ok(messages)
       }

       /// Check if authenticated
       pub fn is_authenticated(&self) -> bool {
           self.token_manager.has_token()
       }
   }
   ```

**Verification**:
- [ ] Client connects successfully
- [ ] Query sends message
- [ ] Response stream works
- [ ] Tool execution integrated
- [ ] Disconnect cleans up
- [ ] **Run `final-review-completeness` agent (Opus)** - Verify no TODOs, placeholders, or incomplete implementations

### Phase 2.8: Integration with forge-agent
**Objective**: Create LlmService implementation using SDK

**Files to Create**:
- `crates/forge-claude-sdk/src/service.rs`

**Steps**:
1. Create SDK-based LLM service:
   ```rust
   pub struct ClaudeSdkService {
       options: ClaudeAgentOptions,
   }

   impl ClaudeSdkService {
       pub fn new(options: ClaudeAgentOptions) -> Self {
           Self { options }
       }

       pub fn from_env() -> Result<Self, SdkError> {
           let token = TokenManager::new().get_token()?;
           Ok(Self {
               options: ClaudeAgentOptions {
                   model: std::env::var("CLAUDE_MODEL")
                       .unwrap_or_else(|_| "claude-opus-4-5-20251101".to_string()),
                   env: [("CLAUDE_CODE_OAUTH_TOKEN".to_string(), token)]
                       .into_iter().collect(),
                   ..Default::default()
               },
           })
       }
   }

   #[async_trait]
   impl LlmService for ClaudeSdkService {
       async fn analyze_requirements(&self, context: &LlmContext) -> LlmResult<RequirementsAnalysis> {
           let mut client = ClaudeSdkClient::new(self.options.clone())?;

           let prompt = build_requirements_prompt(context);
           let messages = client.run(&prompt).await
               .map_err(|e| LlmError::RequestFailed(e.to_string()))?;

           // Extract text from messages
           let text = extract_text_content(&messages);

           // Parse JSON response
           parse_requirements_json(&text)
               .map_err(|e| LlmError::ParseError(e.to_string()))
       }

       async fn generate_spec(&self, context: &LlmContext) -> LlmResult<ImplementationSpec> {
           // Similar pattern
       }

       async fn critique_spec(&self, context: &LlmContext, spec: &ImplementationSpec) -> LlmResult<SpecCritique> {
           // Similar pattern
       }

       fn is_configured(&self) -> bool {
           TokenManager::new().has_token()
       }
   }
   ```

**Verification**:
- [ ] Implements LlmService trait
- [ ] analyze_requirements works
- [ ] generate_spec works
- [ ] critique_spec works
- [ ] Integration with AgentContext works
- [ ] **Run `final-review-completeness` agent (Opus)** - Verify no TODOs, placeholders, or incomplete implementations

### Phase 2.9: MCP Server Support
**Objective**: Enable MCP server integration

**Files to Create**:
- `crates/forge-claude-sdk/src/mcp.rs`

**Steps**:
1. Create MCP config builder:
   ```rust
   pub struct McpConfig {
       servers: HashMap<String, McpServerConfig>,
   }

   impl McpConfig {
       pub fn new() -> Self { Self { servers: HashMap::new() } }

       pub fn add_command_server(
           mut self,
           name: &str,
           command: &str,
           args: Vec<String>,
       ) -> Self {
           self.servers.insert(name.to_string(), McpServerConfig::Command {
               command: command.to_string(),
               args,
           });
           self
       }

       pub fn add_http_server(
           mut self,
           name: &str,
           url: &str,
           headers: HashMap<String, String>,
       ) -> Self {
           self.servers.insert(name.to_string(), McpServerConfig::Http {
               url: url.to_string(),
               headers,
           });
           self
       }

       pub fn to_cli_args(&self) -> Vec<String> {
           let mut args = Vec::new();
           for (name, config) in &self.servers {
               args.push("--mcp-server".to_string());
               args.push(format!("{}={}", name, config.to_cli_value()));
           }
           args
       }
   }
   ```
2. Add common MCP server presets:
   ```rust
   impl McpConfig {
       pub fn with_context7() -> Self {
           Self::new().add_command_server(
               "context7",
               "npx",
               vec!["-y", "@anthropic/context7-mcp"].iter().map(|s| s.to_string()).collect(),
           )
       }

       pub fn with_puppeteer() -> Self {
           Self::new().add_command_server(
               "puppeteer",
               "npx",
               vec!["-y", "puppeteer-mcp-server"].iter().map(|s| s.to_string()).collect(),
           )
       }
   }
   ```

**Verification**:
- [ ] Command server config works
- [ ] HTTP server config works
- [ ] CLI args generated correctly
- [ ] **Run `final-review-completeness` agent (Opus)** - Verify no TODOs, placeholders, or incomplete implementations

### Phase 2.10: Settings File Management
**Objective**: Generate and manage Claude settings files

**Files to Create**:
- `crates/forge-claude-sdk/src/settings.rs`

**Steps**:
1. Create settings builder:
   ```rust
   pub struct ClaudeSettings {
       sandbox: SandboxConfig,
       permissions: PermissionsConfig,
       mcp_servers: HashMap<String, McpServerConfig>,
   }

   #[derive(Serialize)]
   pub struct SandboxConfig {
       enabled: bool,
       #[serde(rename = "autoAllowBashIfSandboxed")]
       auto_allow_bash: bool,
   }

   #[derive(Serialize)]
   pub struct PermissionsConfig {
       #[serde(rename = "defaultMode")]
       default_mode: String,
       allow: Vec<String>,
   }

   impl ClaudeSettings {
       pub fn from_options(options: &ClaudeAgentOptions) -> Self {
           Self {
               sandbox: SandboxConfig {
                   enabled: true,
                   auto_allow_bash: true,
               },
               permissions: PermissionsConfig {
                   default_mode: "acceptEdits".to_string(),
                   allow: options.allowed_tools.iter()
                       .map(|t| format!("{}(*)", t))
                       .collect(),
               },
               mcp_servers: options.mcp_servers.clone(),
           }
       }

       pub fn write_to_file(&self, path: &Path) -> Result<(), SdkError> {
           let json = serde_json::to_string_pretty(self)?;
           std::fs::write(path, json)?;
           Ok(())
       }

       pub fn write_temp(&self) -> Result<PathBuf, SdkError> {
           let dir = std::env::temp_dir().join("forge-claude-sdk");
           std::fs::create_dir_all(&dir)?;
           let path = dir.join(format!("settings-{}.json", uuid::Uuid::new_v4()));
           self.write_to_file(&path)?;
           Ok(path)
       }
   }
   ```

**Verification**:
- [ ] Settings JSON valid
- [ ] File written successfully
- [ ] Temp file cleanup

---

## Testing Strategy

### Unit Tests
- All new modules have comprehensive unit tests
- Mock CLI responses for parser tests
- Mock process for client tests

### Integration Tests
- `crates/forge-claude-sdk/tests/integration.rs`:
  - Test actual CLI spawning (requires auth)
  - Test tool execution loop
  - Test streaming responses
  - Mark as `#[ignore]` for CI without auth

### Manual Testing Steps
1. Run `claude setup-token` to authenticate
2. Test forge-anthropic improvements with direct API calls
3. Test forge-claude-sdk with simple query
4. Test tool execution (Read, Bash)
5. Verify hook blocking works

---

## Rollback Plan

1. **forge-anthropic changes**: Revert individual commits, changes are additive
2. **forge-claude-sdk**: Delete entire crate if needed, no dependencies yet
3. **Integration**: Use feature flags to switch between SDK and direct API

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Claude CLI protocol changes | Medium | High | Pin to specific claude-code version, add protocol version detection |
| OAuth token expiry | Low | Medium | Detect auth errors, prompt for re-auth |
| Tool execution conflicts | Low | Medium | Use forge-tools claim system for file locks |
| Process zombie/leak | Medium | Medium | Implement robust cleanup in Drop, use process groups |
| Streaming parse errors | Medium | Low | Add comprehensive error recovery, log raw output |

---

## Dependency Changes

### New Dependencies for forge-claude-sdk
- `regex = "1"` (for hook pattern matching)
- `tempfile = "3"` (for settings file management)

### Updates to Cargo.toml workspace
```toml
[workspace]
members = [
    # ... existing
    "crates/forge-claude-sdk",
]
```

### Update forge-agent to optionally use SDK
```toml
[dependencies]
forge-claude-sdk = { path = "../forge-claude-sdk", optional = true }

[features]
claude-sdk = ["forge-claude-sdk"]
```

---

## Open Questions

1. **CLI version pinning**: Should we pin to a specific Claude CLI version for stability, or always use latest?
2. **Parallel vs sequential tool execution**: Should multiple tool uses in one response be executed in parallel?
3. **Hook configuration format**: Should hooks be defined in Rust code only, or also support config file?
4. **Conversation persistence**: Should the SDK support saving/restoring conversation state?

---

**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
