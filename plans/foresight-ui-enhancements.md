# Implementation Plan: Foresight UI/UX Enhancements

Created: 2025-12-22
Status: PENDING APPROVAL

## Summary

Enhance the Foresight strategic intelligence system with rich interactive tag tooltips/popovers, pillar/goal icons, additional sample data, and a fully functional Workstreams feature. The goal is to transform the current functional UI into a workflow-oriented experience that helps users understand the taxonomy and strategic alignments at a glance.

## Scope

### In Scope
- Interactive tooltips/popovers for pillar tags (showing full name, description, related goals)
- Interactive tooltips for horizon badges (explaining H1/H2/H3 timeframes)
- Interactive tooltips for stage badges (showing maturity stage details)
- Icons for each pillar and anchor type
- Top 25 Priority alignment indicators on cards
- Additional sample cards (15-20 total) covering all pillars and stages
- Complete Workstreams feature (create, edit, delete, view feed)
- Workstream feed page (`/workstreams/:id`)

### Out of Scope
- Implications Analysis feature (separate future enhancement)
- Real-time notifications
- AI pipeline modifications
- Backend API changes beyond workstreams

## Prerequisites
- Radix UI tooltip/popover already installed (package.json confirms)
- Lucide-react icons library available
- Supabase tables and migrations already in place
- Basic Workstreams backend endpoints exist

## Implementation Phases

### Phase 1: Shared UI Components - Tooltips & Popovers

**Objective**: Create reusable tooltip components for taxonomy elements

**Files to Create**:
- `frontend/foresight-frontend/src/components/ui/Tooltip.tsx` - Base Radix tooltip wrapper
- `frontend/foresight-frontend/src/components/PillarBadge.tsx` - Pillar tag with hover tooltip
- `frontend/foresight-frontend/src/components/HorizonBadge.tsx` - Horizon badge with tooltip
- `frontend/foresight-frontend/src/components/StageBadge.tsx` - Stage indicator with tooltip
- `frontend/foresight-frontend/src/components/AnchorBadge.tsx` - Anchor tag with tooltip
- `frontend/foresight-frontend/src/data/taxonomy.ts` - Static taxonomy data (pillars, goals, anchors, stages)

**Files to Modify**:
- `frontend/foresight-frontend/src/pages/Dashboard.tsx` - Replace hardcoded pillar badges with PillarBadge component
- `frontend/foresight-frontend/src/pages/Discover.tsx` - Replace hardcoded pillar badges with PillarBadge component
- `frontend/foresight-frontend/src/pages/CardDetail.tsx` - Add PillarBadge, HorizonBadge, StageBadge components

**Steps**:
1. Create `taxonomy.ts` with all 6 pillars, 23 goals, 6 anchors, 8 stages, and 24 Top 25 priorities as typed constants
2. Create base `Tooltip.tsx` component wrapping Radix UI tooltip with consistent styling
3. Create `PillarBadge.tsx` that:
   - Displays pillar code with appropriate background color
   - Shows tooltip on hover with: full pillar name, description, icon, related goals list
   - Accepts pillar_id and optional goal_id props
4. Create `HorizonBadge.tsx` showing H1/H2/H3 with tooltip explaining timeframe
5. Create `StageBadge.tsx` with tooltip showing stage name, description, and horizon alignment
6. Create `AnchorBadge.tsx` for strategic anchors (Equity, Innovation, etc.)
7. Update Dashboard, Discover, and CardDetail pages to use new components

**Verification**:
- [ ] Hovering pillar tags shows full pillar name and related goals
- [ ] Hovering horizon badges explains timeframe (0-2 years, 2-5 years, 5+ years)
- [ ] Hovering stage badges shows stage name and description
- [ ] All badge components render correctly across pages

### Phase 2: Pillar & Anchor Icons

**Objective**: Add distinctive icons for each pillar and anchor type

**Files to Modify**:
- `frontend/foresight-frontend/src/data/taxonomy.ts` - Add icon references
- `frontend/foresight-frontend/src/components/PillarBadge.tsx` - Add icon display
- `frontend/foresight-frontend/src/components/AnchorBadge.tsx` - Add icon display

**Icon Mapping (Lucide-react)**:
- CH (Community Health): `Heart` or `Activity`
- MC (Mobility & Connectivity): `Car` or `Train`
- HS (Housing & Stability): `Home`
- EC (Economic Development): `TrendingUp` or `Briefcase`
- ES (Environmental Sustainability): `Leaf` or `TreePine`
- CE (Cultural & Entertainment): `Music` or `Palette`

**Anchor Icons**:
- Equity: `Scale`
- Innovation: `Lightbulb`
- Prevention: `Shield`
- Data-Driven: `BarChart`
- Adaptive: `RefreshCw`
- Collaboration: `Users`

**Steps**:
1. Import required icons from lucide-react
2. Add icon component references to taxonomy data
3. Update PillarBadge to optionally show icon alongside code
4. Update AnchorBadge to show icon alongside name
5. Add icons to tooltips for visual reference

**Verification**:
- [ ] Each pillar displays its unique icon
- [ ] Icons are visible in badges and tooltips
- [ ] Icons scale appropriately at different sizes

### Phase 3: Top 25 Priority Alignment Indicator

**Objective**: Show when cards align with CMO Top 25 Priorities

**Files to Create**:
- `frontend/foresight-frontend/src/components/Top25Badge.tsx` - Priority alignment indicator

**Files to Modify**:
- `frontend/foresight-frontend/src/data/taxonomy.ts` - Add Top 25 priorities data
- `frontend/foresight-frontend/src/pages/CardDetail.tsx` - Add Top 25 section
- `frontend/foresight-frontend/src/pages/Discover.tsx` - Show Top 25 indicator on cards

**Steps**:
1. Add Top 25 priorities to taxonomy.ts with id, title, and mapped pillar
2. Create Top25Badge component:
   - Small star or flag icon that appears when card has top25_relevance
   - Tooltip shows which Top 25 priority/priorities it aligns with
3. Add Top25Badge to card preview components
4. Add dedicated "Top 25 Alignments" section in CardDetail page

**Verification**:
- [ ] Cards with top25_relevance show indicator
- [ ] Hovering indicator shows priority names
- [ ] CardDetail shows full alignment list

### Phase 4: Additional Sample Data

**Objective**: Populate database with 15+ additional sample cards across all pillars

**Files to Create**:
- `supabase/migrations/XXXXXX_seed_additional_cards.sql` - Migration with more sample data

**New Cards Distribution**:
- CH (Community Health): 3 cards - Mental health apps, Preventive care AI, Community wellness platforms
- MC (Mobility): 3 cards - Electric vehicle infrastructure, Autonomous transit, Smart parking
- HS (Housing): 3 cards - Modular housing, ADU policies, Housing blockchain
- EC (Economic): 3 cards - Gig economy regulation, AI job displacement, Local currency initiatives
- ES (Environmental): 2 cards - Carbon capture, Urban farming tech
- CE (Cultural): 2 cards - AR heritage tours, Digital arts funding

**Steps**:
1. Create migration file with INSERT statements for 16 new cards
2. Each card includes:
   - Realistic name, slug, summary, description
   - Appropriate pillar_id, goal_id, anchor_id
   - Stage (distribute across 1-8)
   - Horizon (mix of H1, H2, H3)
   - Scoring metrics (novelty, maturity, impact, relevance, velocity, risk, opportunity)
3. Add 2-3 sample sources per card
4. Add timeline events for each card
5. Optionally add top25_relevance for some cards

**Verification**:
- [ ] Database has 20+ active cards
- [ ] Cards distributed across all 6 pillars
- [ ] Cards distributed across different stages and horizons
- [ ] Running app shows diverse card data

### Phase 5: Workstreams Feature - Create Form

**Objective**: Implement working create workstream form

**Files to Modify**:
- `frontend/foresight-frontend/src/pages/Workstreams.tsx` - Replace placeholder with real form

**Files to Create**:
- `frontend/foresight-frontend/src/components/WorkstreamForm.tsx` - Reusable form component

**Form Fields**:
- Name (required, text)
- Description (optional, textarea)
- Pillars (multi-select checkboxes using PillarBadge components)
- Goals (multi-select grouped by pillar)
- Stages (range slider or multi-select)
- Horizon (single select: H1, H2, H3, ALL)
- Keywords (tag input, comma-separated)
- Auto-add (toggle)
- Is Active (toggle, default true)

**Steps**:
1. Create WorkstreamForm component with all fields
2. Add form validation (name required, at least one filter criterion)
3. Wire up to Supabase insert via existing API endpoint
4. Add success/error handling
5. Refresh workstream list on successful creation
6. Close modal on success

**Verification**:
- [ ] Form opens when clicking "New Workstream"
- [ ] All fields function correctly
- [ ] Validation prevents empty submissions
- [ ] Successful creation adds workstream to list
- [ ] Modal closes on success

### Phase 6: Workstreams Feature - Edit & Delete

**Objective**: Enable editing and deleting existing workstreams

**Files to Modify**:
- `backend/app/main.py` - Add PATCH and DELETE endpoints
- `frontend/foresight-frontend/src/pages/Workstreams.tsx` - Add edit/delete UI
- `frontend/foresight-frontend/src/components/WorkstreamForm.tsx` - Support edit mode

**Steps**:
1. Add backend PATCH endpoint `/api/v1/me/workstreams/{workstream_id}`
2. Add backend DELETE endpoint `/api/v1/me/workstreams/{workstream_id}`
3. Add edit icon button to each workstream card
4. Add delete icon button with confirmation dialog
5. Modify WorkstreamForm to accept initial values for edit mode
6. Wire up edit form to PATCH endpoint
7. Wire up delete button to DELETE endpoint

**Verification**:
- [ ] Edit button opens form with existing values
- [ ] Changes save correctly to database
- [ ] Delete button shows confirmation
- [ ] Confirmed delete removes workstream

### Phase 7: Workstreams Feature - Feed View

**Objective**: Implement `/workstreams/:id` page showing filtered cards

**Files to Create**:
- `frontend/foresight-frontend/src/pages/WorkstreamFeed.tsx` - New page component

**Files to Modify**:
- `frontend/foresight-frontend/src/App.tsx` - Add route for `/workstreams/:id`
- `frontend/foresight-frontend/src/pages/Workstreams.tsx` - Link "View Feed" to new page
- `backend/app/main.py` - Enhance feed endpoint with keyword and goal filtering

**Steps**:
1. Create WorkstreamFeed page component
2. Fetch workstream details by ID
3. Fetch filtered cards using existing `/me/workstreams/{id}/feed` endpoint
4. Display workstream name, description, and filter criteria as header
5. Show matching cards in grid/list view (similar to Discover)
6. Add "Edit Workstream" button linking to edit form
7. Backend: Add keyword filtering (text search) to feed endpoint
8. Backend: Add goal_ids filtering to feed endpoint
9. Add route to App.tsx

**Verification**:
- [ ] Clicking "View Feed" navigates to feed page
- [ ] Feed shows only cards matching workstream filters
- [ ] Keyword filtering works correctly
- [ ] Edit button navigates to edit form
- [ ] Empty state shows when no matching cards

## Testing Strategy

**Manual Testing**:
- Test tooltip hover interactions on all badge types
- Test form validation in workstream creation
- Test workstream CRUD operations end-to-end
- Test workstream feed filtering logic
- Verify sample data appears correctly

**Cross-Browser**:
- Chrome, Safari, Firefox for tooltip behavior
- Mobile responsiveness of new components

## Rollback Plan

1. Database: Migration files are additive (INSERT only), can be reversed with DELETE statements
2. Frontend: Revert component changes via git
3. Backend: Revert API changes via git
4. All changes are isolated and can be rolled back independently

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Radix tooltip CSS conflicts | Low | Low | Use isolated component styling |
| Performance with many tooltips | Medium | Medium | Use lazy loading, limit tooltip content |
| Form validation edge cases | Low | Low | Add comprehensive client-side validation |
| Backend filter complexity | Medium | Low | Start simple, enhance incrementally |

## Open Questions

1. **Tooltip trigger preference**: Should tooltips appear on hover (default) or on click for mobile users?
2. **Icons**: Are the suggested lucide-react icons appropriate, or do you have specific icon preferences?
3. **Top 25 visibility**: Should Top 25 alignment be prominently shown on card previews, or just in detail view?
4. **Sample data themes**: Any specific emerging technologies you'd like as sample cards beyond the suggested list?
5. **Workstream auto-add**: Should we implement the auto-add feature now, or defer to a later phase?

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
