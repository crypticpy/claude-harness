---
name: archon
description: Archon MCP integration for visual task management with localhost Kanban UI, hierarchical knowledge search (project docs → tasks → external RAG), and version-controlled project workflows. Only use when user mentions Archon.
---

# Archon MCP Usage Guide

Only Project ID for this repo is: XXXXXXXXXXXXXXXXXXXXXX
**Reminder**: Deleting a project deletes all associated tasks. Be Careful and Duplicate Tasks first.
Never Delete a project. Ask user to do so themselves through UI.

## 🚨 CRITICAL: Knowledge Search Hierarchy

**🚨 RAG USAGE RESTRICTION**: RAG queries (perform_rag_query/search_code_examples) are only authorized when explicitly requested by the user during task specification with feature/enhancement PRD. Default knowledge collection must use: 1) project document search, 2) completed task search. RAG is supplementary, not primary.

**MANDATORY WORKFLOW**: Always prioritize internal project knowledge over external RAG sources.

### Knowledge Priority System

```yaml
Priority 1 - Internal Project Documents:
  1. List all project documents first
  2. Select relevant based on titles/metadata
  3. Read selected documents for context
  4. Evaluate if sufficient for task completion

Priority 2 - Project Tasks (if documents insufficient):
  1. List all tasks (filtered by project)
  2. Select relevant tasks based on titles/descriptions
  3. Read selected tasks for implementation context
  4. Extract learnings from completed work

Priority 3 - External RAG (only when internal knowledge insufficient):
  1. Check available sources first (MANDATORY)
  2. Select appropriate source based on domain
  3. Use source filter ALWAYS (never cross-source)
  4. Minimum match_count: 10 (never use default 5)
```

## 📋 Internal Knowledge Search Workflow

### Step 1: Project Document Discovery

```python
# ALWAYS start with internal documents
docs = mcp__archon__manage_document(
  action="list",
  project_id="[current_project_id]"
)

# Evaluate titles and metadata
relevant_docs = [d for d in docs if relevant_to_task(d.title, d.tags)]
```

### Step 2: Parallel Document Retrieval

```python
# Fetch multiple documents simultaneously for efficiency
[Get doc_1]  # All execute
[Get doc_2]  # in parallel
[Get doc_3]  # for speed
```

### Step 3: Context Evaluation

- Extract relevant sections from documents
- Assess if information is sufficient for task
- If insufficient, proceed to Priority 2 (Task Search)

## 📝 Project Task Search Workflow (Priority 2)

### Step 1: Task Discovery

```python
# Search across ALL task statuses for relevant context
tasks = mcp__archon__manage_task(
  action="list",
  project_id="[current_project_id]",
  include_closed=True  # Include completed tasks
)

# Filter tasks by relevance
relevant_tasks = [t for t in tasks if relevant_to_current_work(t.title, t.description)]
```

### Step 2: Task Context Extraction

```python
# Fetch specific tasks for detailed context
for task_id in relevant_task_ids:
  task_detail = mcp__archon__manage_task(
    action="get",
    task_id=task_id
  )
  # Extract implementation details, decisions, patterns
```

### Step 3: Learning Synthesis

- Extract implementation patterns from completed tasks
- Identify decisions and trade-offs from task descriptions
- Learn from issues documented in review/done tasks
- If still insufficient, proceed to Priority 3 (External RAG)

## 🔍 External RAG Search Workflow (Priority 3)

### Step 1: Check Available Sources (MANDATORY)

```python
# NEVER skip this step
sources = mcp__archon__get_available_sources()
# Returns: source_id, title, summary, metadata
```

### Step 2: Execute Targeted Query

```python
# ALWAYS include source parameter
results = mcp__archon__perform_rag_query(
  query="specific technical terms",
  source="fumadocs.dev",  # MANDATORY - never omit
  match_count=10          # MINIMUM 10, not default 5
)
```

### Step 3: Code Examples Search (when needed)

```python
code_examples = mcp__archon__search_code_examples(
  query="implementation pattern",
  source_id="fumadocs.dev",  # MANDATORY
  match_count=10              # MINIMUM 10
)
```

## 🛠️ MCP Tool Reference

### Session & System Tools

**health_check**

```
Check MCP server and dependencies health status.
Returns JSON with health status.
```

**session_info**

```
Get current and active sessions information.
Returns JSON with session data.
```

### Project Management

**manage_project**

```
Manage project lifecycle with PRP support and automatic version control.

Actions: create, list, get, delete (preserves version history).
All project data is versioned automatically.
```

### Task Management

**manage_task**

```
Task management with status workflow: todo → doing → review → done.

Actions: create, list, get, update, delete, archive.
Filter by status, project, or assignee.
```

#### Critical Task Creation Pattern

```python
mcp__archon__manage_task(
  action="create",
  project_id="[project_id]",
  title="[Specific 1-4 hour atomic task]",
  description="""[Task overview]

- [ ] First specific subtask
- [ ] Second specific subtask
- [ ] Third specific subtask
- [ ] Validation and testing

Research Context:
- RAG Query: [query] → [findings]
- Code Examples: [patterns identified]
  """,
  assignee="[specialist_name]",
  task_order=[1-100 priority],
  feature="[logical_grouping]",
  sources=[
    {"url": "[research_source]", "type": "documentation", "relevance": "[why_important]"},
    {"url": "[codebase_file]", "type": "existing_code", "relevance": "[context_provided]"}
  ],
  code_examples=[
    {"file": "[example.py]", "function": "[method_name]", "purpose": "[implementation_pattern]"},
    {"file": "[pattern.js]", "class": "[ClassName]", "purpose": "[architectural_guidance]"}
  ]
)
```

#### Parent-Child Task Linking

```python
# Create parent task
parent_task = mcp__archon__manage_task(
  action="create",
  title="Major Feature Implementation",
  ...
)

# Create subtask with parent reference
mcp__archon__manage_task(
  action="create",
  title="Specific Component Implementation",
  parent_task_id=parent_task.id,  # Links to parent
  task_order=10,
  ...
)
```

### Document Management

**manage_document**

```
Document management with automatic version snapshots on every update.

Actions: add, list, get, update, delete.
PRP documents require structured JSON, not markdown.
Complete version history preserved, rollback available via manage_versions.
```

### Version Control

**manage_versions**

```
Immutable version management with complete change history.

Actions: create, list, get, restore.
Fields: docs, features, data, prd.
Automatic snapshots on document updates, manual snapshots also available.
```

### Feature Management

**get_project_features**

```
Get features from project's features JSONB field.
Returns JSON with feature list.
```

### Knowledge & Search Tools

**get_available_sources**

```
Get available sources in knowledge base.

Returns JSON with source list. Call before RAG queries.
```

**perform_rag_query**

```
Vector search on indexed content.

Always specify source for precision. Use get_available_sources first.
Minimum match_count of 10 recommended.
```

**search_code_examples**

```
Search code examples in knowledge base.

Always specify source for precision. Use get_available_sources first.
Minimum match_count of 10 recommended.
```

## 📝 Task Update Pattern

When documenting research in tasks:

```markdown
Internal Research:

- Documents reviewed: [list project docs]
- Tasks reviewed: [list relevant task IDs]
- Key findings: [internal insights]

External Research (if performed):

- Sources checked: [from get_available_sources]
- Source selected: [specific source_id]
- Query: "[exact query]"
- Results: [X results with avg similarity Y]
```

## 🔄 Error Recovery

### Internal Document Issues

1. If no relevant documents found, broaden search criteria
2. Check document tags and metadata fields
3. Consider related feature areas

### RAG Result Issues

1. Verify source selection matches domain
2. Refine query with specific technical terms
3. Increase match_count to 15-20
4. Try related source if available

## 📊 Quality Metrics

- **Internal first**: 100% of searches start with project documents
- **Task search**: Check project tasks before external RAG
- **Source specified**: 100% of RAG queries include source
- **Match count**: Always ≥ 10 for RAG queries
- **Parallel fetching**: Multiple documents/tasks retrieved simultaneously
- **Context evaluation**: Evaluate each knowledge source before proceeding to RAG step

## 🚀 Implementation Checklist

For ANY knowledge search:

- [ ] Priority 1: List and review internal project documents
- [ ] Priority 2: If needed, search project tasks (all statuses)
- [ ] Priority 3: If still needed, check external RAG sources
- [ ] For RAG: Always run get_available_sources() first
- [ ] For RAG: Include source parameter (MANDATORY)
- [ ] For RAG: Set match_count to at least 10
- [ ] Document complete research path in task updates

---

**Remember**:

- Internal project documents contain specifications and requirements
- Project tasks contain implementation details and decisions
- External RAG provides general patterns and best practices
- Always exhaust internal knowledge (docs + tasks) before seeking external solutions
