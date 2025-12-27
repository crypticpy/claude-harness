# GrantScope 2.0: Full-Stack Refactor Plan

## Vision
Transform GrantScope into an **AI-powered grant discovery agent** that actively searches for funding opportunities on behalf of novice grant seekers. No static datasets - the app uses AI agents to search the web, query free grant APIs, and synthesize personalized recommendations.

## Core Value Proposition
> "Tell us about your project. Our AI agents will search for grants you're eligible for and create a personalized funding plan."

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│        Next.js 14 + React 18 + Material UI v6 (MD3)             │
│    ┌─────────────┬─────────────┬─────────────┬────────────┐     │
│    │  Onboarding │   Project   │   Grant     │   Action   │     │
│    │    Flow     │  Definition │   Search    │    Plan    │     │
│    └─────────────┴─────────────┴─────────────┴────────────┘     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ REST + SSE (streaming agent progress)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Python/FastAPI)                      │
│              Orchestrates AI agents + caches results             │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  GRANT SEARCH   │  │  WEB RESEARCH   │  │   SYNTHESIS     │
│    AGENTS       │  │    AGENTS       │  │    AGENT        │
│ • Grants.gov    │  │ • Web search    │  │ • Analyze fits  │
│ • Foundation DB │  │ • Foundation    │  │ • Rank matches  │
│ • State portals │  │   websites      │  │ • Generate plan │
│ • GrantWatch    │  │ • News/updates  │  │ • Write summaries│
└─────────────────┘  └─────────────────┘  └─────────────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATA LAYER                                  │
│  ┌─────────────┐  ┌─────────────────┐  ┌───────────────────┐    │
│  │ PostgreSQL  │  │  Redis Cache    │  │  Azure Blob       │    │
│  │ • Users     │  │  • Search cache │  │  • Reports        │    │
│  │ • Projects  │  │  • Rate limits  │  │  • Exports        │    │
│  │ • Searches  │  │  • Sessions     │  │                   │    │
│  └─────────────┘  └─────────────────┘  └───────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Key Pivot: From Static Data to Agentic Search

**OLD**: User uploads/views pre-loaded grant dataset → analyzes patterns → gets recommendations
**NEW**: User describes project → AI agents search for real grants → returns actionable opportunities

### Grant Data Sources (Free/Public APIs)
1. **Grants.gov API** - Federal grants (free, official)
2. **Foundation Directory Online** - Limited free tier
3. **GrantWatch** - Aggregator (may need scraping or partnership)
4. **State grant portals** - Varies by state
5. **Web search** - Google/Bing for foundation websites, RFPs
6. **USAspending.gov** - Historical federal awards (context)

## Deployment Target
- **Azure Container Apps** (multi-container)
- **Azure Redis Cache** (search caching)
- **Azure OpenAI Service** (GPT-5 for agents + chat)
- **Azure Blob Storage** (report exports - optional)

### Azure OpenAI Configuration
```
AZURE_OPENAI_ENDPOINT=<your-endpoint>
AZURE_OPENAI_API_KEY=<your-key>
AZURE_OPENAI_DEPLOYMENT=gpt-5          # or your deployment name
AZURE_OPENAI_API_VERSION=2024-10-21    # latest stable
```

---

## Phase 1: Foundation + AI Agent Infrastructure
**Goal**: Create the backend with AI agent framework for grant discovery.

### 1.1 Project Setup
- [ ] Initialize monorepo structure:
  ```
  grantscope/
  ├── apps/
  │   ├── web/              # Next.js frontend
  │   └── api/              # Python FastAPI backend
  ├── packages/
  │   └── shared/           # Shared types (TypeScript + Python)
  ├── docker/
  │   ├── Dockerfile.web
  │   ├── Dockerfile.api
  │   └── docker-compose.yml
  └── infra/
      └── azure/            # Bicep/ARM templates
  ```

### 1.2 Data Storage Architecture
**All user data stored in browser (IndexedDB + localStorage) - NO backend database for user data**

- [ ] **Frontend Storage (IndexedDB via Dexie.js)**:
  ```typescript
  // Browser-side database schema
  interface GrantScopeDB {
    // User profile & preferences
    profile: {
      id: 'singleton',
      experienceLevel: 'new' | 'some' | 'pro',
      orgType: string,
      region: string,
      createdAt: Date
    }

    // Projects (user's grant-seeking projects)
    projects: {
      id: string,           // UUID
      name: string,
      problem: string,
      beneficiaries: string,
      budgetMin: number,
      budgetMax: number,
      timeline: string,
      createdAt: Date,
      updatedAt: Date
    }

    // Search history
    searches: {
      id: string,
      projectId: string,
      query: object,        // Search parameters
      resultCount: number,
      createdAt: Date
    }

    // Cached search results (TTL: 24 hours)
    grantResults: {
      id: string,
      searchId: string,
      source: string,
      title: string,
      funder: string,
      amountMin: number,
      amountMax: number,
      deadline: Date,
      url: string,
      description: string,
      relevanceScore: number,
      rawData: object
    }

    // Saved grants (favorites)
    savedGrants: {
      id: string,
      grantResultId: string,
      notes: string,
      savedAt: Date
    }

    // Application tracking
    applications: {
      id: string,
      grantResultId: string,
      status: 'researching' | 'writing' | 'submitted' | 'awarded' | 'rejected',
      dueDate: Date,
      submittedAt: Date | null,
      outcomeAt: Date | null,
      notes: string,
      checklist: { item: string, completed: boolean }[]
    }

    // Custom uploaded datasets
    customDatasets: {
      id: string,
      name: string,
      grants: object[],     // Array of grant objects
      uploadedAt: Date
    }

    // Action plans
    actionPlans: {
      id: string,
      projectId: string,
      content: object,      // Generated plan
      tasks: { title: string, dueDate: Date, completed: boolean }[],
      createdAt: Date
    }
  }
  ```

- [ ] **localStorage** for quick access:
  - Current session ID
  - Theme preference (light/dark)
  - Onboarding completion status
  - Last visited page

- [ ] **Export/Import functionality**:
  - Export all data as JSON (backup)
  - Import from JSON (restore)
  - Share via URL with encoded data (for small datasets)

- [ ] **Backend only stores**:
  - Search query logs (anonymous, for analytics)
  - Cached grant data from APIs (shared cache, not per-user)
  - Rate limiting counters (by IP/session)

### 1.3 AI Agent Framework
- [ ] Set up agent orchestration (using Azure OpenAI function calling):
  ```python
  # Agent types:
  class GrantSearchAgent:
      """Searches specific grant databases/APIs"""
      sources = ["grants.gov", "usaspending", "state_portals"]

  class WebResearchAgent:
      """Searches web for foundation info, RFPs, deadlines"""
      tools = ["web_search", "web_scrape", "pdf_extract"]

  class SynthesisAgent:
      """Analyzes results, scores relevance, generates recommendations"""
      capabilities = ["relevance_scoring", "deadline_extraction", "eligibility_check"]
  ```

- [ ] Implement grant source connectors:
  ```
  /api/sources/
  ├── grants_gov.py      # Grants.gov API (free, official)
  ├── usaspending.py     # USAspending.gov API (historical awards)
  ├── foundation_search.py  # Web search for foundations
  └── web_scraper.py     # General web scraping with rate limits
  ```

### 1.4 FastAPI Backend (Stateless - No User Data Storage)
- [ ] API endpoints:

  **Grant Search (Core)**
  ```
  POST /api/search/start         # Start grant search, return search_id
  GET  /api/search/{id}/stream   # SSE: stream agent progress + results
  POST /api/search/parse-project # AI parses natural language → structured project
  ```

  **AI Services**
  ```
  POST /api/chat                 # Contextual chat (streaming SSE)
  POST /api/plan/generate        # Generate action plan from grants + project
  POST /api/relevance/score      # Score grant relevance to project
  ```

  **Data Sources**
  ```
  GET  /api/sources/status       # Health check for grant APIs
  GET  /api/sources/grants-gov   # Direct Grants.gov search (cached)
  ```

  **Utilities**
  ```
  GET  /api/health               # Health check
  POST /api/export/pdf           # Generate PDF from plan data
  POST /api/export/ics           # Generate calendar file
  ```

- [ ] Azure OpenAI integration:
  - Function calling for agent tools
  - Streaming responses for chat
  - Structured outputs for grant parsing

- [ ] Redis for:
  - Grant API response caching (24h TTL)
  - Rate limiting by IP
  - In-flight search state (ephemeral)

- [ ] **NO PostgreSQL needed** - backend is stateless
  - All user data lives in browser IndexedDB
  - Backend only caches external API responses

### 1.5 Containerization
- [ ] Dockerfile for API (Python 3.12 + FastAPI + uvicorn)
- [ ] docker-compose.yml with Redis only (no PostgreSQL)
- [ ] Health checks + graceful shutdown

**Deliverable**: Stateless backend with grant search agents, testable via API

---

## Phase 2: Frontend Foundation
**Goal**: Basic Next.js app with routing, auth context, and Material Design system.

### 2.1 Next.js Setup
- [ ] Create Next.js 14 app with App Router
- [ ] Configure TypeScript strict mode
- [ ] Install and configure MUI v6 (Material Design 3):
  - Custom theme with brand colors
  - Dark/light mode support
  - Responsive breakpoints
- [ ] Set up API client (fetch wrapper with error handling)

### 2.2 Core Layout
- [ ] App shell with responsive navigation:
  - Mobile: Bottom navigation + hamburger menu
  - Desktop: Sidebar rail (collapsible) + top bar
- [ ] Progress stepper component (for guided journey)
- [ ] Global state management (Zustand or React Context)
- [ ] User profile context (experience level, preferences)

### 2.3 Design System
- [ ] Create component library:
  - `GuidedCard` - card with "why this matters" expandable section
  - `FormField` - input with inline help, "why we ask" tooltip
  - `ChartContainer` - wrapper with interpretation header + chart + insights
  - `ActionButton` - primary CTA with "next step" indicator
  - `EmptyState` - friendly messaging when no data/results
  - `ProgressIndicator` - "Step X of Y" with stage names
- [ ] Typography scale for accessibility (16px base, clear hierarchy)
- [ ] Color system: Primary, secondary, success, warning, error + semantic colors for data viz

**Deliverable**: Next.js shell with routing, theme, and component primitives

---

## Phase 3: Novice-First User Journey
**Goal**: Implement the reimagined UX flow - simple inputs, AI agents do the hard work.

### 3.1 Onboarding Flow
- [ ] Welcome screen with clear value prop:
  > "Tell us about your project. We'll search for grants you can actually win."
- [ ] Experience level selection (visual cards):
  - "I'm new to grants" → Maximum guidance, plain language
  - "I have some experience" → Moderate guidance
  - "I'm a grant professional" → Streamlined, less hand-holding
- [ ] Quick profile: Organization type, location, general interest area
- [ ] Store in session (no account required)

### 3.2 Simplified Journey (4 Steps)

| Step | Page | What User Does | What AI Does |
|------|------|----------------|--------------|
| 1 | **Your Project** | Describe project in plain terms | Extracts keywords, categories, eligibility factors |
| 2 | **Search** | Watch progress, answer follow-ups | Agents search grants.gov, web, foundations |
| 3 | **Results** | Review matched grants, save favorites | Ranks by relevance, extracts deadlines, flags issues |
| 4 | **Your Plan** | Export action plan | Generates timeline, checklist, application tips |

### 3.3 Project Definition (Step 1) - Conversational
- [ ] **Chat-style input** instead of form:
  ```
  AI: "What's your project about? Tell me like you'd tell a friend."
  User: "We want to start an after-school coding program for kids in our neighborhood"
  AI: "That sounds great! A few quick questions:
       - About how many kids would you serve?
       - What's your rough budget range?
       - When do you want to start?"
  ```
- [ ] AI extracts structured data from natural language
- [ ] Shows summary card: "Here's what I understood..." with edit option
- [ ] No jargon - user never sees "populations", "outcomes", "program area"

### 3.4 Grant Search (Step 2) - Live Agent Progress
- [ ] **Visible agent activity**:
  ```
  ┌─────────────────────────────────────────────┐
  │ 🔍 Searching for grants...                  │
  │                                             │
  │ ✓ Searched Grants.gov (12 results)          │
  │ ✓ Searched state programs (3 results)       │
  │ ⟳ Checking foundation websites...           │
  │ ○ Analyzing relevance                       │
  │ ○ Generating recommendations                │
  │                                             │
  │ Found 18 potential grants so far            │
  └─────────────────────────────────────────────┘
  ```
- [ ] Results stream in as agents find them
- [ ] User can pause/cancel if they see enough
- [ ] AI may ask clarifying questions mid-search

### 3.5 Results Review (Step 3)
- [ ] **Grant cards** with key info at a glance:
  ```
  ┌─────────────────────────────────────────────┐
  │ 🏛️ STEM Education Grant                     │
  │ National Science Foundation                 │
  │                                             │
  │ 💰 $25,000 - $100,000                       │
  │ 📅 Deadline: March 15, 2025                 │
  │ 📍 Nationwide                               │
  │                                             │
  │ ⭐ 92% match - "Strong fit for your         │
  │    after-school STEM focus"                 │
  │                                             │
  │ [View Details] [Save] [Not Relevant]        │
  └─────────────────────────────────────────────┘
  ```
- [ ] Filter/sort: By deadline, amount, match score
- [ ] Expand for full details, eligibility requirements, tips
- [ ] "Why this matches" explanation for each grant
- [ ] Save favorites to action plan

### 3.6 Action Plan (Step 4)
- [ ] **Personalized checklist**:
  ```
  Your Grant Application Plan
  ══════════════════════════════════════════════

  📋 DOCUMENTS TO PREPARE
  □ 501(c)(3) determination letter
  □ Board of directors list
  □ Organization budget (current year)
  □ Project budget (template provided)

  📅 TIMELINE
  □ Feb 1 - Start NSF application (6 weeks before deadline)
  □ Feb 15 - Complete project narrative
  □ Mar 1 - Internal review
  □ Mar 10 - Submit (5 days early)

  💡 TIPS FOR YOUR TOP MATCH (NSF STEM)
  • Emphasize measurable outcomes (# of students served)
  • Include teacher training component
  • Show community partnerships
  ```
- [ ] Export as PDF
- [ ] Add deadlines to calendar (.ics download)
- [ ] Share link (session-based, expires after 30 days)

**Deliverable**: Complete novice journey with AI-powered grant discovery

---

## Phase 4: Results & Insights Visualization
**Goal**: Visualize search results and insights in a clear, actionable way.

### 4.1 Results Dashboard
- [ ] **Search results summary**:
  - Total grants found by source
  - Deadline distribution (calendar heat map)
  - Amount range distribution (histogram)
  - Geographic coverage (simple map or list)

### 4.2 Grant Comparison View
- [ ] Side-by-side comparison of saved grants
- [ ] Key differences highlighted
- [ ] "Best for you" recommendation

### 4.3 Application Timeline
- [ ] Visual timeline of saved grant deadlines
- [ ] Workload estimation ("You'd be working on 3 applications in March")
- [ ] Conflict warnings ("These two deadlines are only 2 days apart")

### 4.4 Chart Components (Minimal Set)
- [ ] Use **Recharts** for simplicity
- [ ] Deadline calendar (month view)
- [ ] Amount distribution (horizontal bar)
- [ ] Match score breakdown (radar chart for factors)

**Deliverable**: Clean results visualization, not overwhelming

---

## Phase 5: Contextual AI Assistant
**Goal**: Helpful AI companion throughout the journey, not just a chat box.

### 5.1 Integrated Assistance (Not Separate Chat)
- [ ] AI is woven into the experience, not a sidebar:
  - Project definition: AI asks questions conversationally
  - Search: AI explains what it's doing and why
  - Results: AI highlights why each grant matches
  - Plan: AI explains each recommendation

### 5.2 Proactive Help
- [ ] **Contextual suggestions** that appear at the right moment:
  - "This grant requires a 501(c)(3). Do you have one?"
  - "The deadline is in 3 weeks - that's tight. Want me to help prioritize?"
  - "I noticed you're interested in education grants. Should I also search for STEM-specific opportunities?"

### 5.3 "Ask Me Anything" Fallback
- [ ] FAB button for open-ended questions
- [ ] Context-aware: knows their project, search results, saved grants
- [ ] Streaming responses with SSE
- [ ] Suggested follow-up questions

### 5.4 Response Quality
- [ ] System prompt tuned for:
  - Plain language (no jargon)
  - Actionable advice (not just information)
  - Encouraging tone (grant seeking is stressful)
- [ ] Structured outputs where helpful (checklists, timelines)
- [ ] Always cite sources when referencing specific grants

**Deliverable**: AI that feels like a knowledgeable friend, not a search engine

---

## Phase 6: Polish & Production
**Goal**: Production-ready deployment on Azure Container Apps.

### 6.1 Session Management
- [ ] Session-based storage (no auth required for v1)
- [ ] Redis for session state + search caching
- [ ] 30-day session expiry with data cleanup
- [ ] Optional: "Email my results" for persistence

### 6.2 Performance
- [ ] Search result caching (same project = cached results for 24h)
- [ ] Grants.gov API response caching (updates daily)
- [ ] Next.js static generation for landing page
- [ ] Bundle analysis and code splitting

### 6.3 Rate Limiting & Costs
- [ ] Rate limit searches per session (e.g., 10/day)
- [ ] Azure OpenAI token budgeting per search
- [ ] Web scraping rate limits (respect robots.txt)
- [ ] Cost monitoring dashboard

### 6.4 Observability
- [ ] Structured logging (Python: structlog)
- [ ] Azure Application Insights integration
- [ ] Search analytics (what people search for, success rates)
- [ ] Error tracking with user-friendly fallbacks

### 6.5 Azure Deployment (Simplified - No Database)
- [ ] **Azure Container Apps**:
  ```
  Container Apps Environment
  ├── web (Next.js) - 0.5 vCPU, 1GB
  └── api (FastAPI) - 1 vCPU, 2GB
  ```
- [ ] **Azure Cache for Redis** (Basic C0) - API response caching only
- [ ] **Azure Key Vault** for secrets (OpenAI keys, etc.)
- [ ] **GitHub Actions** → Azure Container Registry → Container Apps
- [ ] **NO PostgreSQL** - all user data in browser IndexedDB

### 6.6 Testing
- [ ] Unit tests: Agent functions, API endpoints (pytest)
- [ ] Integration tests: Grant source connectors
- [ ] Component tests: React components (Vitest)
- [ ] E2E tests: Full user journey (Playwright)
- [ ] Accessibility: axe-core automated checks

**Deliverable**: Production deployment on Azure, cost-optimized

---

## Implementation Order

### Sprint 1: Backend Foundation + First Agent
**Goal**: Prove the agent architecture works end-to-end

1. Project setup (monorepo, docker-compose with Redis)
2. FastAPI skeleton with health checks
3. **Grants.gov connector** (first real data source)
4. Basic search endpoint that returns real federal grants
5. SSE streaming for search progress
6. Redis caching for API responses

**Milestone**: Can search Grants.gov via API and stream results

### Sprint 2: Frontend Shell + Browser Storage
**Goal**: User can describe project, data persists in browser

1. Next.js 14 + MUI v6 (MD3 theme) setup
2. **IndexedDB setup with Dexie.js** (all user data storage)
3. Landing page with value prop
4. Onboarding flow (experience level, org type)
5. **Conversational project input** (AI asks questions)
6. Summary card: "Here's what I understood"
7. Project persistence + project list

**Milestone**: User can describe project, data persists across sessions

### Sprint 3: Full Search Experience
**Goal**: Complete search flow with multiple sources

1. **Web search agent** (Bing/Google API for foundation websites)
2. **Synthesis agent** (relevance scoring, deduplication)
3. Search progress UI with live updates
4. Results grid with grant cards
5. Match explanation for each grant
6. **Search history** (stored in IndexedDB)
7. Re-run previous searches

**Milestone**: Real grant search with history

### Sprint 4: Saved Grants + Application Tracking
**Goal**: Track grants through application pipeline

1. **Saved grants library** (IndexedDB)
2. Grant details view with notes
3. **Application tracking Kanban** (Researching → Writing → Submitted → Awarded/Rejected)
4. Checklist per application
5. **Win rate dashboard** (local analytics)
6. Deadline sorting and filtering

**Milestone**: Full application pipeline tracking

### Sprint 5: Action Plan + Custom Data
**Goal**: Export plans, upload custom data

1. **Action plan generator** (documents, timeline, tips)
2. PDF export (via backend WeasyPrint)
3. Calendar export (.ics)
4. **JSON/CSV data upload**
5. Field mapping UI
6. Merge uploaded data with search results
7. **Full data export** (backup all IndexedDB data)

**Milestone**: Complete data management

### Sprint 6: Polish + Production
**Goal**: Production-ready on Azure

1. Rate limiting + cost controls
2. Error handling + graceful fallbacks
3. Loading states + empty states
4. Azure Container Apps deployment
5. CI/CD pipeline (GitHub Actions)
6. Monitoring + analytics
7. Performance optimization

**Milestone**: Live on Azure, ready for users

---

## Project Structure

### Monorepo Layout
```
grantscope/
├── apps/
│   ├── web/                    # Next.js frontend
│   └── api/                    # Python FastAPI backend
├── packages/
│   └── shared/                 # Shared TypeScript types
├── docker/
│   ├── Dockerfile.web
│   ├── Dockerfile.api
│   └── docker-compose.yml
├── infra/
│   └── azure/                  # Bicep templates
├── .github/
│   └── workflows/              # CI/CD
└── README.md
```

### Frontend (`apps/web/`)
```
src/
├── app/
│   ├── layout.tsx              # Root layout + MUI theme provider
│   ├── page.tsx                # Landing page
│   ├── onboarding/
│   │   └── page.tsx            # Experience level + org type
│   ├── project/
│   │   └── page.tsx            # Conversational project input
│   ├── search/
│   │   └── page.tsx            # Search progress + results
│   ├── grants/
│   │   └── page.tsx            # Saved grants library
│   ├── applications/
│   │   └── page.tsx            # Application tracking (Kanban)
│   ├── plan/
│   │   └── page.tsx            # Action plan + export
│   ├── data/
│   │   └── page.tsx            # Custom data upload
│   ├── settings/
│   │   └── page.tsx            # Export/import data, preferences
│   └── api/
│       └── [...proxy]/route.ts # Proxy to backend
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx        # Main app wrapper
│   │   ├── Header.tsx          # Top bar with progress
│   │   ├── Sidebar.tsx         # Desktop navigation
│   │   └── BottomNav.tsx       # Mobile navigation
│   ├── onboarding/
│   │   ├── ExperienceCards.tsx # Visual level selection
│   │   └── OrgTypeSelect.tsx
│   ├── project/
│   │   ├── ChatInput.tsx       # Conversational input
│   │   ├── ProjectSummary.tsx  # "Here's what I understood"
│   │   └── ProjectList.tsx     # Saved projects
│   ├── search/
│   │   ├── SearchProgress.tsx  # Agent activity display
│   │   ├── GrantCard.tsx       # Individual result
│   │   ├── GrantGrid.tsx       # Results grid
│   │   ├── MatchExplanation.tsx
│   │   └── SearchHistory.tsx   # Past searches
│   ├── grants/
│   │   ├── SavedGrantsList.tsx
│   │   ├── GrantDetails.tsx
│   │   └── GrantNotes.tsx
│   ├── applications/
│   │   ├── KanbanBoard.tsx     # Drag-drop pipeline
│   │   ├── ApplicationCard.tsx
│   │   ├── Checklist.tsx
│   │   └── WinRateStats.tsx
│   ├── plan/
│   │   ├── ActionChecklist.tsx
│   │   ├── Timeline.tsx
│   │   └── ExportOptions.tsx
│   ├── data/
│   │   ├── DataUpload.tsx      # CSV/JSON upload
│   │   ├── FieldMapper.tsx     # Map custom fields
│   │   └── DataPreview.tsx
│   └── common/
│       ├── AIAssistant.tsx     # FAB + chat panel
│       ├── LoadingSkeleton.tsx
│       └── EmptyState.tsx
├── lib/
│   ├── api.ts                  # Typed API client
│   ├── db.ts                   # Dexie.js IndexedDB setup
│   ├── store.ts                # Zustand store (UI state only)
│   ├── sse.ts                  # SSE stream handler
│   └── export.ts               # JSON/PDF/ICS export utilities
└── theme/
    ├── theme.ts                # MUI v6 MD3 theme
    └── palette.ts              # Color definitions
```

### Backend (`apps/api/`) - Stateless
```
app/
├── main.py                     # FastAPI entry + CORS + middleware
├── config.py                   # Settings (pydantic-settings)
├── routers/
│   ├── search.py               # Search start + SSE stream
│   ├── chat.py                 # AI chat endpoint (SSE)
│   ├── plan.py                 # Action plan generation
│   ├── export.py               # PDF/ICS generation
│   └── health.py               # Health checks
├── agents/
│   ├── base.py                 # Base agent class
│   ├── orchestrator.py         # Coordinates agent execution
│   ├── grant_search.py         # Searches grant databases
│   ├── web_research.py         # Web search + scraping
│   └── synthesis.py            # Relevance scoring + ranking
├── sources/
│   ├── grants_gov.py           # Grants.gov API client
│   ├── usaspending.py          # USAspending API client
│   ├── web_search.py           # Bing/Google search API
│   └── scraper.py              # Web page extraction (trafilatura)
├── services/
│   ├── azure_openai.py         # Azure OpenAI wrapper
│   ├── project_parser.py       # NLP: chat → structured project
│   ├── relevance.py            # Grant-project matching scores
│   ├── plan_generator.py       # Action plan creation
│   └── pdf_export.py           # WeasyPrint PDF generation
├── schemas/
│   ├── project.py              # Project input schema
│   ├── grant.py                # Grant result schema
│   ├── search.py               # Search request/response
│   └── plan.py                 # Action plan schema
└── cache/
    └── redis.py                # Redis client for API caching
```

### Docker
```
docker/
├── Dockerfile.web
│   # Multi-stage: deps → build → runner (node:20-alpine)
├── Dockerfile.api
│   # Python 3.12-slim + uvicorn
├── docker-compose.yml
│   # Local dev: web + api + postgres + redis
└── docker-compose.prod.yml
    # Production-like with proper env vars
```

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time from landing to first search | < 3 minutes |
| Conversational turns to define project | 3-5 questions |
| Grants found per search | 10-30 relevant results |
| Search completion time | < 60 seconds |
| Users who export action plan | > 50% of completions |
| Mobile usability score | Full responsive, works on phone |
| Azure monthly cost (low traffic) | < $50 |

---

## Risk Mitigation

1. **Grants.gov API availability**: Cache responses, have fallback messaging
2. **Web scraping reliability**: Rate limit, respect robots.txt, graceful failures
3. **Azure OpenAI costs**: Token budgeting, caching, fallback to simpler prompts
4. **Search quality**: Log searches, iterate on relevance scoring
5. **Session data loss**: Clear messaging about temporary nature, email export option

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Frontend framework | Next.js 14 (App Router) | Best React DX, good Azure support |
| UI library | MUI v6 (Material Design 3) | User preference, good accessibility |
| State management | Zustand | Simpler than Redux, sufficient for our needs |
| Backend framework | FastAPI | Async, great typing, Azure OpenAI support |
| Database | PostgreSQL | Reliable, pgvector for future embeddings |
| Caching | Redis | Session state, search result caching |
| AI orchestration | Custom agents | More control than LangChain, Azure-native |
| LLM | GPT-5 via Azure OpenAI | User requirement, latest capabilities |
| Deployment | Azure Container Apps | User requirement, good scaling |

---

## Full Feature Set

### Session-Based User Experience (No Auth Required)
- [ ] Anonymous sessions with local storage persistence
- [ ] Session ID in URL for sharing/bookmarking
- [ ] 30-day session expiry with data cleanup
- [ ] Optional: "Email my results" for one-time export (no account)

### Search History & Saved Data
- [ ] Full search history within session
- [ ] Re-run previous searches with one click
- [ ] Saved grants library (favorites)
- [ ] Search comparison (see changes over time)
- [ ] Export all data (JSON/CSV)

### Grant Application Tracking
- [ ] Application status pipeline (Researching → Writing → Submitted → Awarded/Rejected)
- [ ] Visual Kanban board view
- [ ] Document checklist per application
- [ ] Notes per grant (local storage)
- [ ] Success/failure tracking
- [ ] Win rate dashboard (within session)

### Custom Data Upload
- [ ] Upload JSON/CSV grant datasets
- [ ] Map custom fields to standard schema
- [ ] Combine with live search results
- [ ] Data validation and preview
- [ ] Merge uploaded data with search results

### Future: Premium Features (Prepared but not active)
- [ ] Database schema ready for billing
- [ ] Usage tracking infrastructure
- [ ] Stripe integration hooks (disabled)
- [ ] Rate limiting by tier (all users get "free" tier for now)

---

## Getting Started (Sprint 1)

**First day**:
1. Create new git branch: `feat/nextjs-refactor`
2. Initialize monorepo structure (`apps/web`, `apps/api`)
3. Set up docker-compose with Redis only
4. Create FastAPI skeleton with health check
5. Verify Azure OpenAI connection

**First week**:
1. Implement Grants.gov API client
2. Create search endpoint with SSE streaming
3. Set up Next.js with MUI v6
4. Implement IndexedDB storage layer (Dexie.js)
5. Build landing page + onboarding screens
6. Connect frontend to backend

**First milestone** (end of Sprint 1):
> User can describe a project, click "Search", and see real federal grants from Grants.gov streamed to the UI.

---

## Architecture Summary

```
┌──────────────────────────────────────────────────────────────┐
│                        USER'S BROWSER                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Next.js + React + MUI v6                   │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │              IndexedDB (Dexie.js)                 │  │  │
│  │  │  • Projects    • Saved Grants   • Applications   │  │  │
│  │  │  • Searches    • Custom Data    • Action Plans   │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                              │
                              │ REST + SSE
                              ▼
┌──────────────────────────────────────────────────────────────┐
│               STATELESS BACKEND (FastAPI)                     │
│  • Grant search agents (Grants.gov, web search)              │
│  • AI services (Azure OpenAI)                                │
│  • Export generation (PDF, ICS)                              │
│  • NO user data storage                                      │
└──────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Redis    │   │ Grants   │   │ Web      │
        │ (cache)  │   │ .gov API │   │ Search   │
        └──────────┘   └──────────┘   └──────────┘
```

**Key Design Decisions**:
- All user data in browser (IndexedDB) - no backend database
- Stateless backend - only caches external API responses
- Privacy-friendly - data stays on user's device
- Offline-capable - saved data works without connection
- Easy deployment - no database to manage

---

## Ready to Start?

This plan transforms GrantScope into an **AI-powered grant discovery agent** with:

1. **Conversational input** - No forms, just describe your project
2. **Agentic search** - AI actively searches for grants on your behalf
3. **Real-time results** - Watch as grants are discovered
4. **Application tracking** - Kanban board for grant pipeline
5. **Custom data upload** - Import your own grant data
6. **Browser-based storage** - All data stays on your device
7. **Actionable output** - Leave with a concrete plan

When you approve this plan, I'll begin with Sprint 1: monorepo setup, FastAPI backend, and Grants.gov search agent.
