# Implementation Plan: Discovery System

Created: 2025-12-22
Status: PENDING APPROVAL

## Summary

Build an automated Discovery System that proactively scans for emerging trends based on Austin's strategic priorities (Pillars, Top 25), creates/enriches intelligence cards with deduplication, and includes a review workflow for managing discovered content.

## Scope

### In Scope
- Discovery Service backend (weekly automated scan)
- Query generation from Pillars + Top 25 Priorities
- Deduplication via vector similarity + LLM verification
- Blocked/ignored topics tracking (user dismissals as soft-delete)
- Card status workflow (discovered → pending_review → active/rejected)
- Auto-approval for high-confidence discoveries (>0.95)
- Discovery Queue frontend UI
- Dashboard integration (pending review count)
- Discovery run history and reporting
- Configurable discovery scope caps

### Out of Scope
- Real-time discovery (webhook-based)
- External notification system (email/Slack alerts)
- pgRouting graph traversal (future phase)
- Advanced graph visualization UI (future phase)
- Machine learning model training for predictions
- Multi-tenant/organization support

## Prerequisites
- Existing research pipeline working (GPT Researcher, Firecrawl, Exa)
- Vector embeddings functional on cards and sources
- Authentication and RLS policies in place

## Key Decisions
- **Rejected cards**: Soft-delete (hidden, not permanently deleted)
- **Auto-approval**: Cards with AI confidence > 0.95 auto-approved to 'active'
- **Cost control**: Cap discovery scope (queries/sources per run) rather than hard cost limit
- **Notifications**: Deferred to future phase

---

## Implementation Phases

### Phase 1: Database Schema Extensions
**Objective**: Add tables for discovery tracking, blocked topics, card relationships, and pgRouting graph support.

**Files to Modify**:
- None (new migration only)

**New Files to Create**:
- `supabase/migrations/1766435000_discovery_and_graph_schema.sql`

**Schema Changes**:

```sql
-- 1. Discovery runs tracking
CREATE TABLE discovery_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),

    -- Configuration
    pillars_scanned TEXT[] DEFAULT '{}',
    priorities_scanned TEXT[] DEFAULT '{}',
    queries_generated INT DEFAULT 0,

    -- Results
    sources_found INT DEFAULT 0,
    sources_relevant INT DEFAULT 0,
    cards_created INT DEFAULT 0,
    cards_enriched INT DEFAULT 0,

    -- Cost tracking
    estimated_cost NUMERIC(10,4) DEFAULT 0,

    -- Error handling
    error_message TEXT,

    -- Report
    summary_report JSONB DEFAULT '{}'
);

-- 2. Discovery blocks (ignored topics)
CREATE TABLE discovery_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What's blocked
    topic_name TEXT NOT NULL,
    topic_embedding VECTOR(1536),
    keywords TEXT[] DEFAULT '{}',

    -- Tracking
    blocked_by_count INT DEFAULT 1,
    first_blocked_at TIMESTAMPTZ DEFAULT NOW(),
    last_blocked_at TIMESTAMPTZ DEFAULT NOW(),

    -- Metadata
    reason TEXT,
    is_active BOOLEAN DEFAULT true
);

-- 3. User dismissals (individual tracking)
CREATE TABLE user_card_dismissals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    card_id UUID REFERENCES cards(id) ON DELETE CASCADE,
    dismissed_at TIMESTAMPTZ DEFAULT NOW(),
    reason TEXT,

    UNIQUE(user_id, card_id)
);

-- 4. Add status field to cards for discovery workflow
ALTER TABLE cards ADD COLUMN IF NOT EXISTS review_status TEXT
    DEFAULT 'active' CHECK (review_status IN ('discovered', 'pending_review', 'active', 'rejected'));

ALTER TABLE cards ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS discovery_run_id UUID REFERENCES discovery_runs(id);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(3,2);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES users(id);

-- 6. Function to find similar cards (for deduplication and related cards)
CREATE OR REPLACE FUNCTION find_similar_cards(
    query_embedding VECTOR(1536),
    exclude_card_id UUID DEFAULT NULL,
    match_threshold FLOAT DEFAULT 0.75,
    match_count INT DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    summary TEXT,
    pillar_id TEXT,
    horizon TEXT,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.name,
        c.summary,
        c.pillar_id,
        c.horizon,
        1 - (c.embedding <=> query_embedding) AS similarity
    FROM cards c
    WHERE
        c.embedding IS NOT NULL
        AND c.status = 'active'
        AND c.review_status NOT IN ('rejected')
        AND (exclude_card_id IS NULL OR c.id != exclude_card_id)
        AND 1 - (c.embedding <=> query_embedding) > match_threshold
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_discovery_runs_status ON discovery_runs(status);
CREATE INDEX IF NOT EXISTS idx_discovery_blocks_embedding ON discovery_blocks
    USING ivfflat (topic_embedding vector_cosine_ops) WITH (lists = 50);
CREATE INDEX IF NOT EXISTS idx_discovery_blocks_active ON discovery_blocks(is_active);
CREATE INDEX IF NOT EXISTS idx_user_dismissals_user ON user_card_dismissals(user_id);
CREATE INDEX IF NOT EXISTS idx_cards_review_status ON cards(review_status);
CREATE INDEX IF NOT EXISTS idx_cards_discovered_at ON cards(discovered_at);

-- 8. RLS Policies
ALTER TABLE discovery_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_card_dismissals ENABLE ROW LEVEL SECURITY;

-- Discovery runs - viewable by all authenticated
CREATE POLICY "Discovery runs viewable by authenticated" ON discovery_runs
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role full access on discovery_runs" ON discovery_runs
    FOR ALL USING (auth.role() = 'service_role');

-- Blocks - viewable by all, service role manages
CREATE POLICY "Discovery blocks viewable by authenticated" ON discovery_blocks
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role full access on discovery_blocks" ON discovery_blocks
    FOR ALL USING (auth.role() = 'service_role');

-- User dismissals - users manage their own
CREATE POLICY "Users manage own dismissals" ON user_card_dismissals
    FOR ALL TO authenticated USING (auth.uid() = user_id);
```

**Verification**:
- [ ] Run migration successfully
- [ ] Test find_similar_cards function with sample embedding
- [ ] Confirm RLS policies work correctly
- [ ] Verify cards table has new columns

---

### Phase 2: Discovery Service Backend
**Objective**: Create the core discovery orchestration service that generates queries, executes searches, triages results, and creates/enriches cards.

**Files to Modify**:
- `backend/app/main.py` - Add discovery endpoints and scheduler job
- `backend/app/research_service.py` - Add discovery-specific methods

**New Files to Create**:
- `backend/app/discovery_service.py` - Main discovery orchestration
- `backend/app/query_generator.py` - Generate search queries from taxonomy

**Steps**:

1. **Create Query Generator** (`query_generator.py`):
```python
"""
Generates search queries from Pillars and Top 25 Priorities.
"""

PILLAR_QUERY_TEMPLATES = {
    'CH': [  # Community Health & Sustainability
        "{priority} public health technology municipal",
        "{priority} climate resilience city government",
        "{priority} smart parks recreation innovation",
    ],
    'EW': [  # Economic & Workforce Development
        "{priority} economic development municipal innovation",
        "{priority} small business technology city",
        "{priority} workforce automation government",
    ],
    # ... templates for HG, HH, MC, PS
}

HORIZON_MODIFIERS = {
    'H3': ['research breakthrough', 'academic study', 'patent filing', 'startup funding'],
    'H2': ['pilot program', 'proof of concept', 'city announces', 'vendor demo'],
    'H1': ['case study', 'implementation', 'adoption', 'best practices'],
}

class QueryGenerator:
    def generate_queries(self, pillars: List[str], priorities: List[str]) -> List[QueryConfig]:
        """Generate search queries from taxonomy."""
        # Returns list of QueryConfig with query text, target horizon, source pillar
```

2. **Create Discovery Service** (`discovery_service.py`):
```python
"""
Discovery orchestration service.
"""

class DiscoveryService:
    """
    Orchestrates the weekly discovery scan.

    Pipeline:
    1. Generate queries from Pillars + Top 25
    2. Execute searches (GPT Researcher + Exa)
    3. Triage sources for relevance
    4. Check against blocked topics
    5. Deduplicate against existing cards
    6. Create new cards or enrich existing
    7. Generate discovery report
    """

    async def execute_discovery_run(self, config: DiscoveryConfig) -> DiscoveryResult:
        """Main entry point for discovery."""

    async def _generate_queries(self) -> List[QueryConfig]:
        """Generate search queries from taxonomy."""

    async def _execute_searches(self, queries: List[QueryConfig]) -> List[RawSource]:
        """Execute searches and collect sources."""

    async def _check_blocked_topics(self, sources: List[RawSource]) -> List[RawSource]:
        """Filter out sources matching blocked topics."""

    async def _deduplicate_sources(self, sources: List[ProcessedSource]) -> DeduplicationResult:
        """Check sources against existing cards."""

    async def _create_or_enrich_cards(self, dedup_result: DeduplicationResult) -> CardActionResult:
        """Create new cards or add sources to existing."""

    async def _generate_card_relationships(self, new_cards: List[str]) -> int:
        """Auto-generate relationships between cards based on similarity."""

    async def _generate_report(self, run_id: str) -> str:
        """Generate discovery run summary report."""
```

3. **Add Discovery Task Type** (modify `main.py`):
```python
VALID_TASK_TYPES = {"update", "deep_research", "workstream_analysis", "discovery"}

# Add endpoint
@app.post("/api/v1/discovery/run")
async def trigger_discovery_run(
    config: DiscoveryConfig,
    current_user: dict = Depends(get_current_user)
):
    """Manually trigger a discovery run."""

@app.get("/api/v1/discovery/runs")
async def list_discovery_runs(
    limit: int = 10,
    current_user: dict = Depends(get_current_user)
):
    """List recent discovery runs."""

@app.get("/api/v1/discovery/runs/{run_id}")
async def get_discovery_run(
    run_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get details of a specific discovery run."""

# Add to scheduler
scheduler.add_job(
    run_weekly_discovery,
    'cron',
    day_of_week='sun',  # Weekly on Sunday
    hour=2,
    minute=0,
    id='weekly_discovery',
    replace_existing=True
)
```

4. **Add Blocked Topics Management** (modify `main.py`):
```python
@app.post("/api/v1/cards/{card_id}/dismiss")
async def dismiss_card(
    card_id: str,
    reason: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Dismiss a card (contributes to blocking threshold)."""

@app.get("/api/v1/discovery/blocked-topics")
async def list_blocked_topics(
    current_user: dict = Depends(get_current_user)
):
    """List currently blocked discovery topics."""
```

**Verification**:
- [ ] Query generator produces valid queries for all pillars
- [ ] Discovery service completes a test run
- [ ] Deduplication correctly identifies similar cards
- [ ] Blocked topics filter works
- [ ] Cards created with 'discovered' status
- [ ] Scheduler job registered correctly

---

### Phase 3: Card Review Workflow Backend
**Objective**: Add API endpoints for reviewing discovered cards and managing the review workflow.

**Files to Modify**:
- `backend/app/main.py` - Add review endpoints

**Steps**:

1. **Add Card Review Endpoints**:
```python
class CardReviewRequest(BaseModel):
    action: str  # 'approve', 'reject', 'edit_approve'
    updates: Optional[Dict[str, Any]] = None
    reason: Optional[str] = None

@app.post("/api/v1/cards/{card_id}/review")
async def review_card(
    card_id: str,
    review: CardReviewRequest,
    current_user: dict = Depends(get_current_user)
):
    """Review a discovered card."""

@app.get("/api/v1/cards/pending-review")
async def get_pending_review_cards(
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get cards pending review."""

@app.post("/api/v1/cards/bulk-review")
async def bulk_review_cards(
    card_ids: List[str],
    action: str,
    current_user: dict = Depends(get_current_user)
):
    """Bulk approve or reject cards."""
```

2. **Add Similar Cards Endpoint** (for review UI):
```python
@app.get("/api/v1/cards/{card_id}/similar")
async def get_similar_cards(
    card_id: str,
    limit: int = 5
):
    """Get cards similar to this card via embedding similarity."""
    # Uses find_similar_cards RPC function
```

**Verification**:
- [ ] Approve transitions card to 'active' status
- [ ] Reject transitions card to 'rejected' status with timestamp
- [ ] Edit+approve updates card and transitions to 'active'
- [ ] Bulk operations work correctly
- [ ] Similar cards endpoint returns vector-based matches

---

### Phase 4: Discovery Queue Frontend
**Objective**: Build the frontend UI for reviewing discovered cards.

**Files to Modify**:
- `frontend/src/components/Header.tsx` - Add navigation item
- `frontend/src/pages/Dashboard.tsx` - Add pending review count
- `frontend/src/App.tsx` - Add route

**New Files to Create**:
- `frontend/src/pages/DiscoveryQueue.tsx` - Main queue page
- `frontend/src/components/QueueCard.tsx` - Card component for queue
- `frontend/src/components/ReviewModal.tsx` - Review details modal
- `frontend/src/components/ConfidenceBadge.tsx` - AI confidence indicator
- `frontend/src/lib/discovery-api.ts` - API helpers

**Steps**:

1. **Create Discovery API helpers** (`discovery-api.ts`):
```typescript
export async function fetchPendingReviewCards(token: string): Promise<Card[]>;
export async function reviewCard(token: string, cardId: string, action: ReviewAction): Promise<void>;
export async function bulkReviewCards(token: string, cardIds: string[], action: string): Promise<void>;
export async function dismissCard(token: string, cardId: string, reason?: string): Promise<void>;
export async function fetchDiscoveryRuns(token: string, limit?: number): Promise<DiscoveryRun[]>;
export async function fetchRelatedCards(token: string, cardId: string): Promise<RelatedCard[]>;
```

2. **Create DiscoveryQueue page** (`DiscoveryQueue.tsx`):
- Header with pending count
- Filter chips (All Pending, By Pillar, By Confidence)
- Grid of QueueCard components
- Bulk action toolbar
- Empty state when queue is clear

3. **Create QueueCard component** (`QueueCard.tsx`):
- Similar to existing card display
- AI confidence badge
- Suggested taxonomy fields highlighted
- Quick action buttons (Approve, Edit, Reject)
- Expandable details section

4. **Create ReviewModal** (`ReviewModal.tsx`):
- Full card details
- Editable taxonomy fields
- Similar/related cards sidebar
- AI suggestions with confidence scores
- Approve/Reject buttons with confirmation

5. **Update Dashboard** (`Dashboard.tsx`):
```typescript
// Add pending review alert
{pendingReviewCount > 0 && (
  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 mb-6">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-5 w-5 text-amber-600" />
        <span className="font-medium text-amber-800 dark:text-amber-200">
          {pendingReviewCount} cards awaiting review
        </span>
      </div>
      <Link to="/discover/queue" className="text-amber-700 hover:text-amber-800 text-sm font-medium">
        Review now →
      </Link>
    </div>
  </div>
)}
```

6. **Update Header navigation**:
```typescript
// Add badge to Discover nav item if pending
<Link to="/discover">
  <Compass className="w-4 h-4 mr-2" />
  Discover
  {pendingReviewCount > 0 && (
    <span className="ml-2 px-2 py-0.5 text-xs bg-amber-500 text-white rounded-full">
      {pendingReviewCount}
    </span>
  )}
</Link>
```

**Verification**:
- [ ] Queue page loads and displays pending cards
- [ ] Filter chips work correctly
- [ ] Individual card review workflow functions
- [ ] Bulk actions work
- [ ] Dashboard shows pending count
- [ ] Navigation badge updates

---

### Phase 5: Discovery Run History & Reporting
**Objective**: Add UI for viewing discovery run history and reports.

**New Files to Create**:
- `frontend/src/pages/DiscoveryHistory.tsx` - Run history page

**Steps**:

1. **Create DiscoveryHistory page**:
- Table of past discovery runs
- Status indicators (completed, failed, running)
- Summary stats (sources found, cards created)
- Expandable report view
- Cost tracking

2. **Add route and navigation**:
- Add to Settings or as sub-page of Discover

**Verification**:
- [ ] History page shows past runs
- [ ] Reports are viewable
- [ ] Stats are accurate

---

## Testing Strategy

### Unit Tests
- Query generator produces valid queries for all pillars/priorities
- Deduplication logic correctly identifies matches
- Blocked topics filter works with embeddings
- Graph traversal functions return correct paths

### Integration Tests
- Full discovery run completes without errors
- Cards created with correct status
- Review workflow transitions work
- API endpoints return expected responses

### Manual Testing
1. Trigger manual discovery run
2. Review discovered cards in queue
3. Approve/reject cards
4. Verify cards appear in Discover page after approval
5. Test graph traversal on card detail page
6. Verify blocked topics prevent future discoveries

---

## Rollback Plan

1. **Database**: All changes are additive (new tables, columns). Rollback by:
   - Dropping new tables: `discovery_runs`, `discovery_blocks`, `user_card_dismissals`
   - Removing new columns: `cards.review_status`, `cards.discovered_at`, `cards.ai_confidence`, etc.
   - Dropping function: `find_similar_cards`

2. **Backend**: Revert to previous commit, redeploy

3. **Frontend**: Revert to previous commit, redeploy

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| High API costs from discovery runs | Medium | Medium | Configurable scope caps (max queries, max sources per run) |
| Deduplication false positives (creating duplicates) | Low | Medium | Conservative thresholds (0.92), LLM verification |
| Large review queue overwhelming users | Medium | Low | Auto-approval for high confidence, batch processing |
| GPT Researcher rate limits | Low | Medium | Exponential backoff, query batching |

---

## Cost Estimates (Per Weekly Run)

| Component | Unit Cost | Volume | Total |
|-----------|-----------|--------|-------|
| Query generation | ~$0.01 | 100 queries | $1 |
| GPT Researcher searches | ~$0.15 | 100 queries | $15 |
| Source triage (gpt-4o-mini) | ~$0.01 | 500 sources | $5 |
| Full analysis (gpt-4o) | ~$0.15 | 75 sources | $11 |
| Embeddings | ~$0.0001 | 100 | $0.01 |
| **Weekly Total** | | | **~$32** |
| **Monthly Total** | | | **~$128** |

*Note: Acceptable in production to scale up to ~$200/month if discovery is working well.*

---

## Configuration Options

```python
class DiscoveryConfig:
    # Scope caps
    max_queries_per_run: int = 100        # Cap total queries
    max_sources_per_query: int = 10       # Cap sources per search
    max_sources_total: int = 500          # Hard cap on total sources

    # Auto-approval
    auto_approve_threshold: float = 0.95  # Auto-approve if confidence > this

    # Deduplication
    similarity_threshold: float = 0.92    # Consider duplicate if above
    weak_match_threshold: float = 0.82    # Use LLM to decide if above

    # Pillars to scan (empty = all)
    pillars_filter: List[str] = []

    # Dry run mode (no card creation)
    dry_run: bool = False
```

---

**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
