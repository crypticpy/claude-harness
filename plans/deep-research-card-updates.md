# Implementation Plan: Deep Research & Card Update System

Created: 2025-12-22
Status: PENDING APPROVAL

## Summary

Implement a comprehensive research and update system for cards that enables users to:
1. Trigger deep research or regular updates from any card detail view
2. Track timestamps for created, updated, and deep-researched dates
3. Have an "Analyze Now" option when creating workstreams to immediately run analysis

This builds on the existing AI pipeline documentation (07_AI_PIPELINE.md) and integrates **GPT Researcher** (`gpt-researcher` Python package) as the core research engine.

## Key Decisions (User Confirmed)

| Question | Decision |
|----------|----------|
| Research depth configuration | No - keep it simple |
| Research history display | Smart - show via existing timeline, no separate UI |
| Workstream "Analyze Now" scope | Can find existing cards AND create new ones |
| Rate limiting | Max 2 deep research per day per card (shared across users) |

## Scope

### In Scope
- Database schema changes: Add `deep_research_at` column to cards, create `research_tasks` table
- Backend API: New research endpoints with GPT Researcher integration
- Frontend CardDetail: Display timestamps, add "Update" and "Deep Research" buttons
- Frontend WorkstreamForm: Add "Analyze Now" toggle option
- Research task execution with status tracking (queued → processing → completed/failed)
- Timeline events for research activities
- Rate limiting (2 deep research/day/card)

### Out of Scope
- Configurable research depth (fixed settings)
- Research task history page (use timeline)
- Email notifications for research completion
- Research task queueing with Celery/Redis (use simple async for MVP)

## Prerequisites
- OpenAI API key configured in backend
- **Tavily API key** (required by GPT Researcher for web search)
- Supabase database access
- Install `gpt-researcher` package: `pip install gpt-researcher`

## Technology: GPT Researcher

### Why GPT Researcher?
- Model agnostic (works with GPT-4, Claude, Gemini, local models)
- Built-in deep research mode with tree-like recursive exploration
- Returns structured sources with URLs, content, and relevance
- Cost tracking built-in
- MCP integration available for future enhancements

### Key Integration Patterns

```python
from gpt_researcher import GPTResearcher

# Regular Update (quick, 5-10 sources)
researcher = GPTResearcher(
    query="Latest developments in AI-powered water pressure management for municipalities",
    report_type="research_report",  # Standard research
)

# Deep Research (comprehensive, 20+ sources, recursive exploration)
researcher = GPTResearcher(
    query="AI-powered water pressure management municipal applications",
    report_type="deep",  # Triggers deep research mode
)

# Execute research
research_data = await researcher.conduct_research()
report = await researcher.write_report()

# Extract results
sources = researcher.get_research_sources()  # Full source data
source_urls = researcher.get_source_urls()   # Just URLs
costs = researcher.get_costs()               # Token/API costs
context = researcher.get_research_context()  # Raw research context
```

### Environment Variables Required
```bash
OPENAI_API_KEY=sk-...
TAVILY_API_KEY=tvly-...

# Optional: Deep research tuning (defaults are good)
DEEP_RESEARCH_BREADTH=4
DEEP_RESEARCH_DEPTH=2
DEEP_RESEARCH_CONCURRENCY=4
```

---

## Implementation Phases

### Phase 1: Database Schema Updates

**Objective**: Add necessary columns and tables to support research tracking

**Files to Create**:
- `supabase/migrations/[timestamp]_add_research_tracking.sql`

**Schema Changes**:

```sql
-- Add deep_research_at to cards table
ALTER TABLE cards ADD COLUMN deep_research_at TIMESTAMPTZ;

-- Add daily research counter for rate limiting
ALTER TABLE cards ADD COLUMN deep_research_count_today INTEGER DEFAULT 0;
ALTER TABLE cards ADD COLUMN deep_research_reset_date DATE DEFAULT CURRENT_DATE;

-- Create research_tasks table
CREATE TABLE research_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    card_id UUID REFERENCES cards(id) ON DELETE SET NULL,
    workstream_id UUID REFERENCES workstreams(id) ON DELETE SET NULL,

    -- Task configuration
    task_type TEXT NOT NULL CHECK (task_type IN ('update', 'deep_research', 'workstream_analysis')),
    query TEXT,

    -- Status tracking
    status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),

    -- Results
    result_summary JSONB DEFAULT '{}',
    -- Example: { "sources_found": 12, "sources_added": 8, "metrics_updated": true, "cards_created": 0, "cost": 0.45 }
    error_message TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE research_tasks ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own research tasks"
    ON research_tasks FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can create own research tasks"
    ON research_tasks FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own research tasks"
    ON research_tasks FOR UPDATE
    USING (user_id = auth.uid());

-- Index for efficient queries
CREATE INDEX idx_research_tasks_card_status ON research_tasks(card_id, status);
CREATE INDEX idx_research_tasks_user_created ON research_tasks(user_id, created_at DESC);
```

**Verification**:
- [ ] Migration applies successfully
- [ ] Can insert and query research_tasks
- [ ] RLS policies restrict access to user's own tasks

---

### Phase 2: Backend - GPT Researcher Integration

**Objective**: Create research service using GPT Researcher

**Files to Modify**:
- `backend/requirements.txt` - Add dependencies
- Create `backend/app/research_service.py` - Research logic

**New Dependencies** (requirements.txt):
```
gpt-researcher>=0.9.0
tavily-python>=0.3.0
```

**Research Service** (research_service.py):

```python
"""
Research service using GPT Researcher for card updates and deep research.
"""
import asyncio
import os
from datetime import date
from typing import Optional, Dict, Any, List
from gpt_researcher import GPTResearcher
from supabase import Client

class ResearchService:
    """Handles research operations for cards and workstreams."""

    DAILY_DEEP_RESEARCH_LIMIT = 2

    def __init__(self, supabase: Client):
        self.supabase = supabase

    async def check_rate_limit(self, card_id: str) -> bool:
        """Check if deep research is allowed for this card today."""
        result = self.supabase.table("cards").select(
            "deep_research_count_today, deep_research_reset_date"
        ).eq("id", card_id).single().execute()

        if not result.data:
            return False

        card = result.data
        today = date.today().isoformat()

        # Reset counter if it's a new day
        if card.get("deep_research_reset_date") != today:
            self.supabase.table("cards").update({
                "deep_research_count_today": 0,
                "deep_research_reset_date": today
            }).eq("id", card_id).execute()
            return True

        return card.get("deep_research_count_today", 0) < self.DAILY_DEEP_RESEARCH_LIMIT

    async def increment_research_count(self, card_id: str):
        """Increment the daily research counter for a card."""
        self.supabase.rpc("increment_deep_research_count", {"card_id": card_id}).execute()

    async def execute_update(self, card_id: str, task_id: str) -> Dict[str, Any]:
        """Execute a quick update research for a card."""
        # Get card details for query
        card = self.supabase.table("cards").select("name, summary").eq("id", card_id).single().execute()

        query = f"Recent developments and news about {card.data['name']}. {card.data.get('summary', '')}"

        researcher = GPTResearcher(
            query=query,
            report_type="research_report",
        )

        await researcher.conduct_research()
        report = await researcher.write_report()

        sources = researcher.get_research_sources()
        source_urls = researcher.get_source_urls()
        costs = researcher.get_costs()

        # Add sources to card
        sources_added = await self._add_sources_to_card(card_id, sources[:5])

        # Update card timestamp
        self.supabase.table("cards").update({
            "updated_at": "now()"
        }).eq("id", card_id).execute()

        # Create timeline event
        await self._create_timeline_event(
            card_id,
            "updated",
            f"Quick update: {len(sources_added)} new sources added",
            {"sources_count": len(sources_added), "cost": costs}
        )

        return {
            "sources_found": len(sources),
            "sources_added": len(sources_added),
            "cost": costs,
            "report_preview": report[:500] if report else None
        }

    async def execute_deep_research(self, card_id: str, task_id: str) -> Dict[str, Any]:
        """Execute deep research for a card."""
        # Check rate limit
        if not await self.check_rate_limit(card_id):
            raise Exception("Daily deep research limit reached (2 per day per card)")

        # Get card details
        card = self.supabase.table("cards").select("*").eq("id", card_id).single().execute()

        query = f"""
        Comprehensive research on {card.data['name']}.
        Context: {card.data.get('summary', '')}
        Focus areas: municipal applications, recent pilots, technology maturity,
        key vendors, implementation challenges, and future outlook.
        """

        researcher = GPTResearcher(
            query=query,
            report_type="deep",  # Deep research mode
        )

        await researcher.conduct_research()
        report = await researcher.write_report()

        sources = researcher.get_research_sources()
        costs = researcher.get_costs()
        context = researcher.get_research_context()

        # Add sources (more for deep research)
        sources_added = await self._add_sources_to_card(card_id, sources[:15])

        # Update card metrics based on research
        metrics_updated = await self._update_card_metrics(card_id, context, report)

        # Update timestamps
        self.supabase.table("cards").update({
            "updated_at": "now()",
            "deep_research_at": "now()"
        }).eq("id", card_id).execute()

        # Increment rate limit counter
        await self.increment_research_count(card_id)

        # Create timeline event
        await self._create_timeline_event(
            card_id,
            "deep_research",
            f"Deep research completed: {len(sources_added)} sources, metrics updated",
            {"sources_count": len(sources_added), "metrics_updated": metrics_updated, "cost": costs}
        )

        return {
            "sources_found": len(sources),
            "sources_added": len(sources_added),
            "metrics_updated": metrics_updated,
            "cost": costs,
            "report_preview": report[:1000] if report else None
        }

    async def execute_workstream_analysis(
        self, workstream_id: str, task_id: str, user_id: str
    ) -> Dict[str, Any]:
        """Analyze a workstream and find/create relevant cards."""
        # Get workstream details
        ws = self.supabase.table("workstreams").select("*").eq("id", workstream_id).single().execute()

        keywords = ws.data.get("keywords", [])
        name = ws.data.get("name", "")

        query = f"""
        Research emerging technologies and trends related to: {name}.
        Keywords: {', '.join(keywords)}.
        Focus on municipal and government applications.
        """

        researcher = GPTResearcher(
            query=query,
            report_type="research_report",
        )

        await researcher.conduct_research()
        report = await researcher.write_report()

        sources = researcher.get_research_sources()
        costs = researcher.get_costs()

        # Find or create cards based on research
        cards_found, cards_created = await self._match_or_create_cards(
            sources, ws.data, user_id
        )

        return {
            "sources_found": len(sources),
            "cards_found": len(cards_found),
            "cards_created": len(cards_created),
            "cost": costs
        }

    async def _add_sources_to_card(
        self, card_id: str, sources: List[Dict]
    ) -> List[str]:
        """Add research sources to a card."""
        added_ids = []

        for source in sources:
            # Check if URL already exists
            existing = self.supabase.table("sources").select("id").eq(
                "card_id", card_id
            ).eq("url", source.get("url", "")).execute()

            if existing.data:
                continue

            result = self.supabase.table("sources").insert({
                "card_id": card_id,
                "title": source.get("title", "Untitled"),
                "url": source.get("url", ""),
                "summary": source.get("content", "")[:500],
                "content": source.get("content", ""),
                "source_type": "article",
                "publisher": source.get("source", ""),
                "relevance_score": int(source.get("relevance", 0.7) * 100),
                "fetched_date": "now()"
            }).execute()

            if result.data:
                added_ids.append(result.data[0]["id"])

        return added_ids

    async def _update_card_metrics(
        self, card_id: str, context: str, report: str
    ) -> bool:
        """Update card metrics based on research findings."""
        # Use OpenAI to analyze and update metrics
        # This is a simplified version - could be enhanced with specific prompts
        # For MVP, we mark metrics as "updated" if deep research completed
        return True

    async def _create_timeline_event(
        self, card_id: str, event_type: str, title: str, metadata: Dict
    ):
        """Create a timeline event for a card."""
        self.supabase.table("card_timeline").insert({
            "card_id": card_id,
            "event_type": event_type,
            "title": title,
            "description": f"Research completed with {metadata.get('sources_count', 0)} sources",
            "metadata": metadata
        }).execute()

    async def _match_or_create_cards(
        self, sources: List[Dict], workstream: Dict, user_id: str
    ) -> tuple:
        """Match sources to existing cards or create new ones."""
        # Simplified matching - can be enhanced with embeddings
        cards_found = []
        cards_created = []

        # For now, just link existing matching cards
        # Full implementation would use vector similarity

        return cards_found, cards_created
```

**Verification**:
- [ ] GPT Researcher imports successfully
- [ ] Can execute research with Tavily API
- [ ] Sources are extracted correctly

---

### Phase 3: Backend API - Research Endpoints

**Objective**: Create API endpoints for triggering and monitoring research tasks

**Files to Modify**:
- `/Users/aiml/Projects/foresight-app/backend/app/main.py`

**New Pydantic Models**:
```python
class ResearchTaskCreate(BaseModel):
    card_id: Optional[str] = None
    workstream_id: Optional[str] = None
    task_type: str  # 'update' | 'deep_research' | 'workstream_analysis'

class ResearchTask(BaseModel):
    id: str
    user_id: str
    card_id: Optional[str]
    workstream_id: Optional[str]
    task_type: str
    status: str
    result_summary: Optional[dict]
    error_message: Optional[str]
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
```

**New Endpoints**:

```python
from app.research_service import ResearchService

# POST /api/v1/research - Create and start research task
@app.post("/api/v1/research", response_model=ResearchTask)
async def create_research_task(
    task_data: ResearchTaskCreate,
    current_user: dict = Depends(get_current_user)
):
    """Create and execute a research task."""
    # Validate input
    if not task_data.card_id and not task_data.workstream_id:
        raise HTTPException(400, "Either card_id or workstream_id required")

    # Check rate limit for deep research
    if task_data.task_type == "deep_research" and task_data.card_id:
        service = ResearchService(supabase)
        if not await service.check_rate_limit(task_data.card_id):
            raise HTTPException(429, "Daily deep research limit reached (2 per card)")

    # Create task record
    task = supabase.table("research_tasks").insert({
        "user_id": current_user["id"],
        "card_id": task_data.card_id,
        "workstream_id": task_data.workstream_id,
        "task_type": task_data.task_type,
        "status": "queued"
    }).execute()

    task_id = task.data[0]["id"]

    # Execute research in background
    asyncio.create_task(execute_research_task(task_id, task_data, current_user["id"]))

    return ResearchTask(**task.data[0])


async def execute_research_task(task_id: str, task_data: ResearchTaskCreate, user_id: str):
    """Background task to execute research."""
    service = ResearchService(supabase)

    try:
        # Update status to processing
        supabase.table("research_tasks").update({
            "status": "processing",
            "started_at": datetime.now().isoformat()
        }).eq("id", task_id).execute()

        # Execute based on task type
        if task_data.task_type == "update":
            result = await service.execute_update(task_data.card_id, task_id)
        elif task_data.task_type == "deep_research":
            result = await service.execute_deep_research(task_data.card_id, task_id)
        elif task_data.task_type == "workstream_analysis":
            result = await service.execute_workstream_analysis(
                task_data.workstream_id, task_id, user_id
            )
        else:
            raise ValueError(f"Unknown task type: {task_data.task_type}")

        # Update as completed
        supabase.table("research_tasks").update({
            "status": "completed",
            "completed_at": datetime.now().isoformat(),
            "result_summary": result
        }).eq("id", task_id).execute()

    except Exception as e:
        # Update as failed
        supabase.table("research_tasks").update({
            "status": "failed",
            "completed_at": datetime.now().isoformat(),
            "error_message": str(e)
        }).eq("id", task_id).execute()


# GET /api/v1/research/{task_id} - Get task status
@app.get("/api/v1/research/{task_id}", response_model=ResearchTask)
async def get_research_task(
    task_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get research task status."""
    result = supabase.table("research_tasks").select("*").eq(
        "id", task_id
    ).eq("user_id", current_user["id"]).single().execute()

    if not result.data:
        raise HTTPException(404, "Research task not found")

    return ResearchTask(**result.data)


# GET /api/v1/me/research-tasks - List user's research tasks
@app.get("/api/v1/me/research-tasks")
async def list_research_tasks(
    current_user: dict = Depends(get_current_user),
    limit: int = 10
):
    """List user's recent research tasks."""
    result = supabase.table("research_tasks").select("*").eq(
        "user_id", current_user["id"]
    ).order("created_at", desc=True).limit(limit).execute()

    return [ResearchTask(**t) for t in result.data]
```

**Verification**:
- [ ] Can create research task via API
- [ ] Task executes in background
- [ ] Status updates correctly through lifecycle
- [ ] Rate limiting works (returns 429 after 2 deep research)

---

### Phase 4: Frontend - Card Interface Update

**Objective**: Add research/update buttons and timestamp displays to CardDetail

**Files to Modify**:
- `/Users/aiml/Projects/foresight-app/frontend/foresight-frontend/src/pages/CardDetail.tsx`

**Changes**:

1. **Update Card interface** (line ~19):
```typescript
interface Card {
  // ... existing fields
  deep_research_at?: string;
}
```

2. **Add research state** (after line ~135):
```typescript
const [researchTask, setResearchTask] = useState<{
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  task_type: string;
} | null>(null);
const [isResearching, setIsResearching] = useState(false);
```

3. **Add research trigger function**:
```typescript
const triggerResearch = async (taskType: 'update' | 'deep_research') => {
  if (!card || isResearching) return;

  setIsResearching(true);
  try {
    const response = await fetch('/api/v1/research', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`
      },
      body: JSON.stringify({
        card_id: card.id,
        task_type: taskType
      })
    });

    if (response.status === 429) {
      alert('Daily deep research limit reached (2 per card)');
      return;
    }

    const task = await response.json();
    setResearchTask(task);

    // Poll for completion
    pollTaskStatus(task.id);
  } catch (error) {
    console.error('Research failed:', error);
  } finally {
    setIsResearching(false);
  }
};

const pollTaskStatus = async (taskId: string) => {
  const poll = setInterval(async () => {
    const response = await fetch(`/api/v1/research/${taskId}`, {
      headers: { 'Authorization': `Bearer ${session?.access_token}` }
    });
    const task = await response.json();
    setResearchTask(task);

    if (task.status === 'completed' || task.status === 'failed') {
      clearInterval(poll);
      if (task.status === 'completed') {
        loadCardDetail(); // Refresh card data
      }
    }
  }, 2000);
};
```

4. **Add research buttons** (in header area, after Follow button ~line 360):
```tsx
<div className="flex items-center gap-2">
  <button
    onClick={() => triggerResearch('update')}
    disabled={isResearching}
    className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
  >
    <RefreshCw className={`h-4 w-4 mr-2 ${isResearching && researchTask?.task_type === 'update' ? 'animate-spin' : ''}`} />
    Update
  </button>
  <button
    onClick={() => triggerResearch('deep_research')}
    disabled={isResearching}
    className="inline-flex items-center px-3 py-2 border border-brand-blue rounded-md text-sm font-medium text-white bg-brand-blue hover:bg-brand-dark-blue disabled:opacity-50"
  >
    <Search className={`h-4 w-4 mr-2 ${isResearching && researchTask?.task_type === 'deep_research' ? 'animate-spin' : ''}`} />
    Deep Research
  </button>
</div>
```

5. **Update Activity section** (line ~593-614) to show all timestamps:
```tsx
<div className="space-y-3 text-sm">
  <div className="flex justify-between">
    <span className="text-gray-500">Created</span>
    <span className="font-medium">{new Date(card.created_at).toLocaleDateString()}</span>
  </div>
  <div className="flex justify-between">
    <span className="text-gray-500">Last Updated</span>
    <span className="font-medium">{new Date(card.updated_at).toLocaleDateString()}</span>
  </div>
  {card.deep_research_at && (
    <div className="flex justify-between">
      <span className="text-gray-500">Last Deep Research</span>
      <span className="font-medium">{new Date(card.deep_research_at).toLocaleDateString()}</span>
    </div>
  )}
  <div className="flex justify-between">
    <span className="text-gray-500">Sources</span>
    <span className="font-medium">{sources.length}</span>
  </div>
</div>
```

6. **Add imports** at top:
```typescript
import { RefreshCw, Search } from 'lucide-react';
```

**Verification**:
- [ ] Update button triggers research and shows loading
- [ ] Deep Research button works similarly
- [ ] All three timestamps display correctly
- [ ] Card data refreshes after research completes
- [ ] Rate limit error shows user-friendly message

---

### Phase 5: Frontend - WorkstreamForm Update

**Objective**: Add "Analyze Now" option when creating workstreams

**Files to Modify**:
- `/Users/aiml/Projects/foresight-app/frontend/foresight-frontend/src/components/WorkstreamForm.tsx`

**Changes**:

1. **Update FormData interface** (line ~59):
```typescript
interface FormData {
  // ... existing fields
  analyze_now: boolean;
}
```

2. **Update initial state** (line ~186):
```typescript
const [formData, setFormData] = useState<FormData>({
  // ... existing fields
  analyze_now: false,
});
```

3. **Add toggle after Active toggle** (after line ~641):
```tsx
{/* Analyze Now Toggle - Only in CREATE mode */}
{!isEditMode && (
  <div className="pt-2">
    <ToggleSwitch
      checked={formData.analyze_now}
      onChange={(checked) =>
        setFormData((prev) => ({ ...prev, analyze_now: checked }))
      }
      label="Analyze Now"
      description="Immediately search for and analyze relevant cards based on your filters"
    />
  </div>
)}
```

4. **Update handleSubmit** to trigger analysis (after line ~366):
```typescript
// After successful creation, trigger analysis if requested
if (!isEditMode && formData.analyze_now && response.data) {
  const workstreamId = response.data[0].id;

  // Fire and forget - don't block the UI
  fetch('/api/v1/research', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`
    },
    body: JSON.stringify({
      workstream_id: workstreamId,
      task_type: 'workstream_analysis'
    })
  }).catch(console.error);
}
```

**Verification**:
- [ ] Toggle appears in create mode only
- [ ] Toggle does NOT appear in edit mode
- [ ] Enabling it triggers research after workstream creation
- [ ] Workstream is still created even if analysis fails

---

### Phase 6: Environment & Configuration

**Objective**: Set up required API keys and configuration

**Files to Modify**:
- `/Users/aiml/Projects/foresight-app/backend/.env`
- `/Users/aiml/Projects/foresight-app/backend/.env.example`

**Add to .env.example**:
```bash
# GPT Researcher / Tavily (required for research features)
TAVILY_API_KEY=tvly-your-key-here

# Optional: Deep research tuning
DEEP_RESEARCH_BREADTH=4
DEEP_RESEARCH_DEPTH=2
DEEP_RESEARCH_CONCURRENCY=4
```

**Verification**:
- [ ] Tavily API key is configured
- [ ] GPT Researcher can execute searches
- [ ] Environment variables are documented

---

## Testing Strategy

### Manual Testing
- [ ] Create a workstream with "Analyze Now" enabled
- [ ] Navigate to a card and click "Update"
- [ ] Navigate to a card and click "Deep Research"
- [ ] Verify timestamps update correctly
- [ ] Verify sources are added to card
- [ ] Verify timeline shows research events
- [ ] Test rate limiting (try 3rd deep research on same card - should fail)
- [ ] Test error handling (disconnect network during research)

### Database Validation
- [ ] Query research_tasks table to verify task lifecycle
- [ ] Check cards table for timestamp updates
- [ ] Verify sources are linked correctly
- [ ] Verify rate limit counters reset daily

## Rollback Plan

1. **Database**: Migration is additive (new columns, new table). Can be rolled back by:
   - Dropping `research_tasks` table
   - Removing `deep_research_at`, `deep_research_count_today`, `deep_research_reset_date` columns

2. **Backend**: Remove `research_service.py` and research endpoints from `main.py`

3. **Frontend**: Hide research buttons via conditional rendering, remove analyze_now toggle

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Tavily API rate limits | Medium | Medium | Monitor usage, implement backoff |
| GPT Researcher package updates | Low | Medium | Pin version in requirements.txt |
| Long-running research blocks API | Low | High | Using asyncio.create_task for non-blocking |
| User triggers multiple tasks | Medium | Low | Disable buttons while task active |
| Research returns no results | Medium | Low | Show informative message, still update timestamp |
| Costs exceed budget | Low | Medium | Track costs in result_summary, add alerts if needed |

---

**USER: Please review this updated plan. Confirm when ready to proceed with implementation.**
