# Implementation Plan: Agent Execution Graph Visualizer

Created: 2025-12-23
Status: PENDING APPROVAL

## Summary

Build a **game-like interactive agent execution visualizer** that displays agent hierarchies as an animated node graph with glowing shapes, real-time updates, click-to-inspect details, and SpacetimeDB-powered replay capabilities. The orchestrator appears as a central glowing hexagon, with agents spawning outward as connected nodes with distinct visual identities.

## Vision & Aesthetic

```
                    ┌─────────────────────────────────────────────────────────────┐
                    │                                                             │
                    │         ◇─────────◇ coder-2                                │
                    │        /     (working)                                      │
                    │       /                                                     │
                    │   ⬡━━━━◇ coder-1 ━━━◇ subagent-a                           │
                    │  /    (idle)        (completed ✓)                          │
                    │ /                                                           │
   ⬢ ORCHESTRATOR ━━                                                             │
    (glowing hex)   \                                                             │
                    │ \                                                           │
                    │  \━━━◇ qa-reviewer ━━━◇ qa-fixer                           │
                    │      (waiting)        (working)                            │
                    │                                                             │
                    └─────────────────────────────────────────────────────────────┘

    Legend: ⬢ = Orchestrator (hexagon), ◇ = Agent (diamond), ⬡ = Primary (pentagon)
    Colors: Cyan=Working, Green=Completed, Yellow=Waiting, Red=Failed, Gray=Idle
    Glow: Active nodes pulse, completed nodes have soft glow
```

**Key Visual Features:**
- **Glowing hexagon** for orchestrator (central, pulsing when active)
- **Diamonds** for coder agents (cyan theme)
- **Pentagons** for planner agents (violet theme)
- **Circles** for QA agents (amber/emerald themes)
- **Connecting lines** animate as data flows between agents
- **Particle effects** on tool executions and state changes
- **Dark sci-fi aesthetic** matching existing Mission Control theme

## Scope

### In Scope
- New "Execution Flow" view in sidebar navigation
- Interactive SVG/Canvas node graph with zoom/pan
- Real-time agent spawning with animated node creation
- Click-to-select nodes with detail panel
- Agent output/history browser in side panel
- Tool execution visualizations (pulses, particles)
- SpacetimeDB-powered timeline scrubber for replay
- Session selector for viewing past executions

### Out of Scope
- 3D WebGL rendering (keeping 2D for performance)
- Sound effects (may add later)
- Custom shader effects
- Multi-project simultaneous view
- Collaborative/multi-user features

## Prerequisites

- SpacetimeDB integration complete (Phase 3 ✅)
- Agent hierarchy store exists (`agent-hierarchy-store.ts`)
- Motion library available for animations
- Need to add: **React Flow** or similar graph library

## Technology Decision

### Graph Rendering Library Options

| Library | Pros | Cons | Verdict |
|---------|------|------|---------|
| **React Flow** | Production-ready, handles zoom/pan/layout, React-native | 60kb bundle, learning curve | ✅ **Recommended** |
| **D3.js** | Maximum control, lightweight core | Imperative API, React integration complex | Consider for custom nodes |
| **Custom Canvas** | Full control, lightweight | Significant dev time, must build interactions | Backup option |
| **Vis.js** | Good network visualization | Older library, less React integration | Skip |

**Decision: Use React Flow** with custom node components for the game-like aesthetic. React Flow handles the hard parts (layout, zoom, pan, connections) while we focus on visual polish.

## Implementation Phases

### Phase 1: Foundation & Graph Setup
**Objective**: Set up React Flow, create basic node graph with orchestrator + agents

**Files to Modify**:
- `package.json` - Add reactflow dependency
- `src/renderer/components/Sidebar.tsx` - Add navigation item
- `src/renderer/App.tsx` - Add view routing

**New Files to Create**:
- `src/renderer/components/execution-flow/ExecutionFlowView.tsx` - Main container
- `src/renderer/components/execution-flow/AgentGraph.tsx` - React Flow wrapper
- `src/renderer/components/execution-flow/nodes/OrchestratorNode.tsx` - Hexagon node
- `src/renderer/components/execution-flow/nodes/AgentNode.tsx` - Agent diamond/shape nodes
- `src/renderer/components/execution-flow/nodes/index.ts` - Node type registry
- `src/renderer/components/execution-flow/edges/AnimatedEdge.tsx` - Glowing connections
- `src/renderer/components/execution-flow/index.ts` - Exports

**Steps**:
1. Install React Flow: `pnpm add reactflow`
2. Create ExecutionFlowView component with full-height layout
3. Add "Execution Flow" to sidebar with GitBranch icon
4. Create basic AgentGraph with React Flow provider
5. Create OrchestratorNode as custom hexagon SVG shape
6. Create AgentNode with shape variants (diamond, pentagon, circle)
7. Wire up to agent-hierarchy-store for node data
8. Implement basic layout algorithm (radial from center)

**Verification**:
- [ ] New view appears in sidebar
- [ ] Clicking shows React Flow canvas
- [ ] Mock nodes render with correct shapes
- [ ] Zoom/pan works

---

### Phase 2: Visual Polish & Glow Effects
**Objective**: Add the game-like aesthetic with glowing effects, animations, status colors

**New Files to Create**:
- `src/renderer/components/execution-flow/effects/GlowFilter.tsx` - SVG glow filter definitions
- `src/renderer/components/execution-flow/effects/PulseAnimation.tsx` - Pulse keyframes
- `src/renderer/components/execution-flow/effects/ParticleEffect.tsx` - Tool execution particles
- `src/renderer/components/execution-flow/styles/flow-theme.css` - Custom React Flow styling

**Files to Modify**:
- `nodes/OrchestratorNode.tsx` - Add glow filter, pulse animation
- `nodes/AgentNode.tsx` - Add status-based coloring, glow on active
- `edges/AnimatedEdge.tsx` - Add flowing dot animation along edges

**Steps**:
1. Create SVG filter definitions for glow effects (blur + overlay)
2. Add CSS animations for pulsing (scale + opacity)
3. Implement status-to-color mapping (working=cyan, completed=green, etc.)
4. Add drop shadows and border glows to nodes
5. Create animated edges with dots flowing from parent to child
6. Add spawn animation (scale from 0, fade in, particle burst)
7. Add completion animation (glow pulse, checkmark overlay)

**Verification**:
- [ ] Orchestrator hexagon has cyan glow
- [ ] Active agents pulse
- [ ] Completed agents show green with subtle glow
- [ ] Edges animate with flowing particles
- [ ] New node spawns have entrance animation

---

### Phase 3: Real-Time Updates & Interactivity
**Objective**: Connect to SpacetimeDB for live updates, add click interactions

**Files to Modify**:
- `AgentGraph.tsx` - Subscribe to store changes, update nodes
- `nodes/AgentNode.tsx` - Add click handler, selection state
- `ExecutionFlowView.tsx` - Add detail panel container

**New Files to Create**:
- `src/renderer/components/execution-flow/panels/AgentDetailPanel.tsx` - Selected agent info
- `src/renderer/components/execution-flow/panels/OutputViewer.tsx` - Live output stream
- `src/renderer/components/execution-flow/hooks/useAgentGraphData.ts` - Transform store to React Flow format
- `src/renderer/components/execution-flow/hooks/useGraphLayout.ts` - Auto-layout logic

**Steps**:
1. Create useAgentGraphData hook to transform hierarchy store to React Flow nodes/edges
2. Subscribe to SpacetimeDB store for real-time session updates
3. Implement selection state (highlight selected node, dim others)
4. Create AgentDetailPanel with agent info, status, metrics
5. Add OutputViewer component for streaming agent output
6. Implement smooth node position transitions when graph updates
7. Add tool execution indicators (flash effect on node when tool runs)

**Verification**:
- [ ] Nodes update in real-time as agents spawn/complete
- [ ] Clicking node shows detail panel
- [ ] Detail panel shows agent type, status, tokens, cost
- [ ] Tool executions show brief flash on node
- [ ] New agents appear with animation

---

### Phase 4: History & Output Browser
**Objective**: Add history browsing, output scrollback, error inspection

**New Files to Create**:
- `src/renderer/components/execution-flow/panels/HistoryBrowser.tsx` - Collapsible history
- `src/renderer/components/execution-flow/panels/ToolExecutionList.tsx` - Tool call history
- `src/renderer/components/execution-flow/panels/ErrorInspector.tsx` - Error details
- `src/renderer/components/execution-flow/panels/MessageHistory.tsx` - Conversation view

**Files to Modify**:
- `AgentDetailPanel.tsx` - Add tabs for Output, Tools, Errors, Messages

**Steps**:
1. Create tabbed interface in AgentDetailPanel
2. Implement HistoryBrowser with expandable sections
3. Create ToolExecutionList with input/output expandables
4. Add ErrorInspector with stack trace viewer
5. Create MessageHistory for viewing agent conversation
6. Implement scroll-to-bottom for live output
7. Add search/filter for history items

**Verification**:
- [ ] Can browse all tools an agent executed
- [ ] Can expand tool calls to see input/output
- [ ] Errors shown with full context
- [ ] Message history shows conversation flow
- [ ] Search filters history items

---

### Phase 5: Timeline & Replay System
**Objective**: Add time scrubber to replay past executions from SpacetimeDB

**New Files to Create**:
- `src/renderer/components/execution-flow/timeline/TimelineScrubber.tsx` - Time slider
- `src/renderer/components/execution-flow/timeline/SessionSelector.tsx` - Past session picker
- `src/renderer/components/execution-flow/timeline/PlaybackControls.tsx` - Play/pause/speed
- `src/renderer/components/execution-flow/hooks/useReplayState.ts` - Manage replay mode

**Files to Modify**:
- `ExecutionFlowView.tsx` - Add timeline bar, session selector
- `useAgentGraphData.ts` - Support replaying historical data

**Steps**:
1. Create SessionSelector dropdown to pick past spec executions
2. Query SpacetimeDB for all events within selected session
3. Create TimelineScrubber with time range and current position
4. Implement PlaybackControls (play, pause, 1x/2x/4x speed)
5. Create useReplayState hook to manage replay vs. live mode
6. Implement event-by-event playback (spawn agents at their spawn time)
7. Add "jump to live" button when viewing replay
8. Show timeline markers for key events (spawns, completions, errors)

**Verification**:
- [ ] Can select past session from dropdown
- [ ] Timeline shows full execution duration
- [ ] Scrubbing shows graph state at that point in time
- [ ] Play button animates through execution
- [ ] Speed controls work
- [ ] Can jump back to live mode

---

### Phase 6: Tool Execution Visualization
**Objective**: Show tool executions as visual effects on the graph

**New Files to Create**:
- `src/renderer/components/execution-flow/effects/ToolBurst.tsx` - Tool execution burst
- `src/renderer/components/execution-flow/effects/FileGlow.tsx` - File operation indicator
- `src/renderer/components/execution-flow/overlays/ToolActivityOverlay.tsx` - Live tool display

**Files to Modify**:
- `AgentNode.tsx` - Integrate tool execution effects
- `AgentGraph.tsx` - Add overlay layer for effects

**Steps**:
1. Create ToolBurst component (radial burst animation)
2. Map tool types to visual effects:
   - Read → Blue pulse inward
   - Write/Edit → Orange pulse outward
   - Bash → Green terminal icon flash
   - Task → Spawn line animation
3. Add FileGlow for file path indicators
4. Create ToolActivityOverlay showing current tool name briefly
5. Add success/failure variants (green burst vs red burst)
6. Implement effect queuing for rapid tool calls

**Verification**:
- [ ] Tool executions show visual burst on node
- [ ] Different tools have different colors
- [ ] Failed tools show red effect
- [ ] Multiple rapid tools queue properly
- [ ] Tool name briefly visible during execution

---

## Testing Strategy

**Unit Tests**:
- `useAgentGraphData.test.ts` - Transform logic
- `useGraphLayout.test.ts` - Layout algorithm
- Node components render correctly

**Integration Tests**:
- Graph renders with mock store data
- Real-time updates propagate to nodes
- Selection state persists correctly

**Manual Testing**:
- Run actual Auto-Claude build and observe visualization
- Test with 5+ concurrent agents
- Verify replay with past sessions
- Test zoom/pan at various scales
- Verify performance with 50+ nodes

## Rollback Plan

- React Flow is isolated to execution-flow directory
- Sidebar item can be hidden via feature flag
- No changes to core agent/store logic
- Can revert to existing AgentHierarchyTree if needed

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| React Flow bundle size (60kb) | High | Low | Lazy load the view, code split |
| Performance with many nodes | Medium | Medium | Virtualize off-screen nodes, limit history |
| Complex layout algorithm | Medium | Medium | Start with simple radial, iterate |
| SpacetimeDB replay complexity | Medium | High | Implement incrementally, test with small sessions |
| Visual effects performance | Low | Medium | Use CSS animations over JS, reduce particle count |

## Open Questions

1. **Layout Algorithm**: Should we use force-directed, hierarchical tree, or radial? (Recommend: start with hierarchical, switch to radial if too tall)

2. **Maximum Replay Duration**: How far back should timeline support? (Recommend: last 24 hours, with dropdown for older)

3. **Real-time vs Polling**: Should we use WebSocket subscriptions or poll SpacetimeDB? (Current: WebSocket via existing integration)

4. **Node Limit**: At what point should we aggregate/collapse nodes? (Recommend: 50+ nodes triggers clustering)

---

## Dependency Installation

```bash
pnpm add reactflow
```

React Flow includes:
- Node/Edge rendering
- Zoom/pan controls
- Minimap component
- Background patterns
- Selection handling
- Keyboard navigation

---

**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**

Key decision points to consider:
1. React Flow vs. custom canvas implementation
2. Starting layout algorithm preference
3. Replay timeline scope (24h, 7d, unlimited)
4. Whether to include the particle effects in Phase 2 or defer to polish phase
