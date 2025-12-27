# Implementation Plan: Fix Research Results Flow

Created: 2025-12-22
Status: ✅ IMPLEMENTED

## Summary

Research completes successfully but sources aren't being stored (0 added from 11 discovered) and the research report isn't displayed to users. Root causes: (1) Tavily API content fetch failures cause empty content, (2) triage filters out sources without content, (3) silent error handling masks failures, (4) frontend doesn't display the generated report.

**Enhanced Plan**: Integrate Firecrawl (already supported by GPT Researcher!) and Exa AI as alternative/fallback source fetchers to solve Tavily reliability issues.

## Root Cause Analysis

1. **Tavily API Failures**: GPT Researcher finds URLs but Tavily fails to fetch content
2. **Aggressive Triage Filtering**: `_triage_sources` requires content, filters all sources
3. **Silent Error Handling**: `_store_source` returns `None` without logging failures
4. **Missing Report Display**: Research generates a full report but frontend only shows counts

## Scope

### In Scope
- **Enable Firecrawl** in GPT Researcher for better web scraping (already supported!)
- **Add Exa AI** as fallback search/content provider
- Fix source triage to allow sources without full content
- Add proper error handling and logging to source storage
- Store and display the research report text
- Show research results in a more useful format

### Out of Scope
- Implementing embedding/vector storage
- Creating a dedicated research history page
- Advanced entity visualization

## Prerequisites
- Backend running on port 8000
- Database schema already updated with required columns
- Firecrawl API key (get from https://firecrawl.dev)
- Exa API key (get from https://exa.ai)

## Implementation Phases

### Phase 1: Enable Firecrawl in GPT Researcher
**Objective**: Switch from Tavily to Firecrawl for more reliable web scraping

GPT Researcher already has Firecrawl integration built-in! We just need to enable it.

**Files to Modify**:
- `/Users/aiml/Projects/foresight-app/backend/.env` - Add Firecrawl API key
- `/Users/aiml/Projects/foresight-app/backend/app/research_service.py` - Configure GPT Researcher to use Firecrawl

**Steps**:
1. Add `FIRECRAWL_API_KEY=fc-xxxxx` to `.env`
2. Install firecrawl: `pip install firecrawl-py`
3. Configure GPT Researcher to use Firecrawl scraper:
   ```python
   researcher = GPTResearcher(
       query=query,
       report_type=report_type,
       config_path=None,  # or custom config
       websocket=None,
       scraper="firecrawl"  # Use Firecrawl instead of default
   )
   ```
4. Add fallback logic if Firecrawl fails

**Verification**:
- [ ] Firecrawl successfully fetches page content
- [ ] Sources have populated `content` field

---

### Phase 2: Add Exa AI as Search Enhancement
**Objective**: Use Exa for higher-quality, AI-powered source discovery

**Files to Modify**:
- `/Users/aiml/Projects/foresight-app/backend/.env` - Add Exa API key
- `/Users/aiml/Projects/foresight-app/backend/app/research_service.py` - Add Exa search method

**New Files to Create**:
- `/Users/aiml/Projects/foresight-app/backend/app/exa_service.py` - Exa integration

**Steps**:
1. Add `EXA_API_KEY=xxx` to `.env`
2. Install exa: `pip install exa_py`
3. Create `exa_service.py` with search and content retrieval:
   ```python
   from exa_py import Exa

   class ExaSearchService:
       def __init__(self, api_key: str):
           self.exa = Exa(api_key)

       async def search_and_get_contents(
           self,
           query: str,
           num_results: int = 10,
           days_back: int = 30
       ) -> List[RawSource]:
           results = self.exa.search_and_contents(
               query,
               num_results=num_results,
               start_published_date=...,
               text=True,
               highlights=True
           )
           return [RawSource(...) for r in results.results]
   ```
4. Add Exa as supplementary source discovery in `_discover_sources`
5. Merge Exa results with GPT Researcher results

**Verification**:
- [ ] Exa returns relevant sources with content
- [ ] Sources are deduplicated when combining with GPT Researcher

---

### Phase 3: Fallback Content Fetching with Firecrawl
**Objective**: If a source has no content, use Firecrawl to fetch it directly

**Files to Modify**:
- `/Users/aiml/Projects/foresight-app/backend/app/research_service.py` - Add content backfill

**Steps**:
1. After `_discover_sources`, check for sources with empty content
2. For each source without content, call Firecrawl scrape API:
   ```python
   from firecrawl import Firecrawl

   async def _backfill_content(self, sources: List[RawSource]) -> List[RawSource]:
       fc = Firecrawl(api_key=os.getenv("FIRECRAWL_API_KEY"))
       for source in sources:
           if not source.content and source.url:
               try:
                   result = fc.scrape(source.url, formats=["markdown"])
                   source.content = result.get("markdown", "")
               except Exception as e:
                   logger.warning(f"Firecrawl failed for {source.url}: {e}")
       return sources
   ```
3. Call `_backfill_content` before triage
4. Add rate limiting/batching for multiple URLs

**Verification**:
- [ ] Sources without content get backfilled
- [ ] Backfill errors are logged but don't fail the pipeline

---

### Phase 4: Fix Backend Triage Logic
**Objective**: Allow sources without content to pass triage (we still have URL, title, and can store them)

**Files to Modify**:
- `/Users/aiml/Projects/foresight-app/backend/app/research_service.py` - Relax triage requirements

**Steps**:
1. Modify `_triage_sources` (line 242) to not require content
2. If content is empty, skip AI triage and auto-pass with default relevance
3. Add logging to show how many sources pass/fail triage

**Verification**:
- [ ] Run research and see sources passing triage even without content

---

### Phase 5: Add Error Handling to Source Storage
**Objective**: Catch and log insert failures instead of silent returns

**Files to Modify**:
- `/Users/aiml/Projects/foresight-app/backend/app/research_service.py` - Add try-catch to `_store_source`

**Steps**:
1. Wrap Supabase insert in try-catch block
2. Log actual error messages from Supabase
3. Distinguish between "duplicate" (expected) and "failed" (error)

**Verification**:
- [ ] Insert failures are logged with actual error messages

---

### Phase 6: Store Research Report
**Objective**: Save the full research report so it can be displayed to users

**Files to Modify**:
- `/Users/aiml/Projects/foresight-app/backend/app/research_service.py` - Store report in result_summary
- `/Users/aiml/Projects/foresight-app/backend/app/main.py` - Include report in task update

**Steps**:
1. Include `report_preview` (full report) in `result_summary` JSONB field
2. Limit to reasonable size (e.g., first 10,000 chars)
3. Return report in research task response

**Verification**:
- [ ] `research_tasks.result_summary` contains the report text

---

### Phase 7: Display Research Report in Frontend
**Objective**: Show the research report to users after completion

**Files to Modify**:
- `/Users/aiml/Projects/foresight-app/frontend/foresight-frontend/src/pages/CardDetail.tsx` - Add report display

**Steps**:
1. Extract report from `researchTask.result_summary.report_preview`
2. Add collapsible section showing the full report
3. Use markdown rendering for the report content
4. Add "Copy Report" button for easy sharing

**Verification**:
- [ ] Research report is visible in CardDetail after completion
- [ ] Report is properly formatted with markdown

---

### Phase 8: Improve Results Display
**Objective**: Show more useful information about research results

**Files to Modify**:
- `/Users/aiml/Projects/foresight-app/frontend/foresight-frontend/src/pages/CardDetail.tsx` - Enhanced results banner

**Steps**:
1. Show sources that were discovered (with links) even if not stored
2. Display report preview with "Show Full Report" expansion
3. Better error messaging when sources couldn't be added

**Verification**:
- [ ] Users can see what sources were found
- [ ] Clear feedback on research success/partial success

---

## Testing Strategy

### Manual Testing Steps
1. Trigger "Update" research on a card
2. Verify sources pass triage (check backend logs)
3. Verify sources are stored OR errors are logged
4. Verify research report appears in frontend
5. Verify report is readable and properly formatted

### Edge Cases
- Research with 0 sources found
- Research where all sources are duplicates
- Research timeout/failure scenarios

## Rollback Plan
- Revert changes to research_service.py
- Revert changes to CardDetail.tsx
- Changes are additive, low risk

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Large reports slow down UI | Low | Low | Limit report preview to 10KB |
| Source storage still fails | Medium | Medium | Comprehensive logging will reveal cause |
| Tavily continues failing | High | Medium | Firecrawl + Exa provide reliable alternatives |
| Firecrawl rate limits | Medium | Low | Add retry logic, batch requests |
| Exa API costs | Low | Low | Limit to 10-15 results per search |
| Multiple APIs increase complexity | Medium | Medium | Clear fallback chain: GPT Researcher → Firecrawl backfill → Exa supplement |

## Open Questions
- Should we store the full report in a separate `reports` table?
- Should we add a "View Report" button that opens a modal vs inline display?
- Maximum report size to store/display?
- Do you have Firecrawl and Exa API keys, or need to sign up?

## API Key Requirements

| Service | Purpose | Get Key |
|---------|---------|---------|
| Firecrawl | Web scraping for GPT Researcher | https://firecrawl.dev |
| Exa | AI-powered search + content | https://exa.ai |

Both have free tiers for development.

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
