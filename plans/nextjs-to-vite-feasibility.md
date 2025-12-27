# Feasibility Evaluation: Next.js to Vite Migration

Created: 2025-12-19
Status: EVALUATION ONLY (No Implementation)

---

## Executive Summary

This document evaluates the feasibility of converting the PurchasePro frontend from Next.js 16 to Vite. The assessment covers technical complexity, risk factors, effort estimates, and strategic recommendations.

**Overall Assessment: HIGH COMPLEXITY / MODERATE-HIGH RISK**

The migration is technically feasible but involves significant effort due to:
1. Server-side rendering patterns deeply integrated with React Query
2. Middleware-based authentication protection
3. Next.js API routes handling secure cookie management
4. 13+ UI components with direct `next/navigation` imports
5. Monorepo structure with 6 internal packages

---

## Current Architecture Analysis

### Project Structure
```
frontend/
├── apps/web/                    # Next.js 16 application
│   ├── src/app/                 # App Router (36 pages)
│   ├── middleware.ts            # Auth route protection
│   └── next.config.mjs          # Turbopack + webpack config
├── packages/
│   ├── data/                    # API services + React Query (framework-agnostic)
│   ├── state/                   # Zustand stores (framework-agnostic)
│   ├── types/                   # TypeScript definitions (framework-agnostic)
│   ├── ui-components/           # MUI components (HAS Next.js coupling)
│   └── ui-theme/                # MUI theme (framework-agnostic)
```

### Next.js Feature Usage Matrix

| Feature | Usage Count | Migration Complexity | Notes |
|---------|-------------|---------------------|-------|
| App Router (file-based routing) | 36 pages | HIGH | Need react-router or TanStack Router |
| Server Components (async) | 9 pages | MEDIUM | Convert to client-side data fetching |
| SSR Hydration (React Query) | 33+ uses | MEDIUM | Remove SSR prefetch, use client loading |
| Middleware (auth) | 1 file | HIGH | Replace with client-side auth guards |
| API Routes | 2 endpoints | MEDIUM | Move to backend or use proxy |
| `next/navigation` | 89 occurrences | HIGH | Replace with router library |
| `next/link` | 7 files | LOW | Replace with router Link |
| `next/font` | 1 file | LOW | Use standard font loading |
| `next/headers` (cookies) | 3 files | MEDIUM | Use document.cookie or backend |
| Metadata API | 4 exports | LOW | Use react-helmet or similar |
| `use server` directive | 2 files | MEDIUM | Convert to client-side utilities |

---

## Detailed Impact Analysis

### 1. Routing System (HIGH IMPACT)

**Current State:**
- 36 pages using Next.js App Router file-based routing
- 4 dynamic route segments: `[id]`, `[token]`
- Nested layouts (single root layout)

**Migration Requirement:**
- Install and configure `react-router-dom` or `@tanstack/react-router`
- Create explicit route definitions
- Convert all `page.tsx` files to route components
- Handle dynamic segments with URL parameters

**Files Affected:**
- `/apps/web/src/app/**/page.tsx` (36 files)
- All files importing from `next/navigation` (34 files)
- All files importing from `next/link` (7 files)

**Example Conversion:**
```typescript
// Before (Next.js): apps/web/src/app/requests/[id]/page.tsx
export default async function RequestDetail({ params }: { params: { id: string } }) {
  const { id } = params;
  return <RequestDetailClient id={id} />;
}

// After (Vite + React Router):
// routes/requests/[id].tsx
export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  return <RequestDetailClient id={id!} />;
}
```

### 2. Authentication Middleware (HIGH IMPACT)

**Current State:**
```typescript
// middleware.ts - Server-side route protection
export function middleware(request: NextRequest) {
  const authCookie = request.cookies.get('auth-token');
  if (isProtectedRoute && !isAuthenticated) {
    return NextResponse.redirect(loginUrl);
  }
}
```

**Migration Requirement:**
- Remove server-side middleware entirely
- Implement client-side route guards
- Handle flash of unauthenticated content (FOUC)
- Potential security implications (protected routes briefly visible)

**Recommended Approach:**
```typescript
// Client-side auth guard with React Router
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/login', { state: { returnUrl: location.pathname } });
    }
  }, [isAuthenticated, isLoading]);

  if (isLoading) return <LoadingSpinner />;
  if (!isAuthenticated) return null;
  return children;
}
```

**Files Affected:**
- `/apps/web/middleware.ts` (delete)
- Create new `AuthGuard.tsx` wrapper
- Update all 10 protected route segments

### 3. Server-Side Data Fetching (MEDIUM IMPACT)

**Current State:**
```typescript
// Async server component with SSR prefetch
export default async function Home() {
  const qc = await createServerQueryClient();
  await qc.prefetchQuery({
    queryKey: ['recentActivity'],
    queryFn: async () => serverFetch('/api/data'),
  });
  return <ServerHydrationBoundary state={dehydrate(qc)}><Client /></ServerHydrationBoundary>;
}
```

**Migration Requirement:**
- Remove all async server page components
- Remove `ServerHydrationBoundary` wrapper
- Convert to client-side loading states with React Query
- Accept initial loading states on page mount

**Impact:**
- Slightly slower perceived load (no SSR data)
- Need loading skeletons for all data-dependent views
- SEO impact minimal (enterprise internal app)

**Files Affected:**
- 9 async server pages
- `/lib/server/react-query.ts` (delete or repurpose)
- `/components/providers/ServerHydrationBoundary.tsx` (simplify)

### 4. API Routes (MEDIUM IMPACT)

**Current State:**
2 API routes handling authentication cookies:
- `POST /api/auth/session` - Set httpOnly auth cookies
- `DELETE /api/auth/session` - Clear auth cookies

**Migration Options:**

**Option A: Move to Backend (Recommended)**
- Add equivalent endpoints to Express backend
- Backend already handles authentication
- Maintains httpOnly cookie security

**Option B: Use Vite Proxy + Client Cookies**
- Use non-httpOnly cookies (reduced security)
- Not recommended for production

**Option C: Separate Auth Service**
- Deploy minimal Express/Fastify service for cookie handling
- Adds operational complexity

**Files Affected:**
- `/apps/web/src/app/api/auth/session/route.ts` (delete)
- `/apps/web/src/app/api/ping-backend/route.ts` (delete or move)
- Backend: Add new auth endpoints

### 5. UI Components Package Coupling (HIGH IMPACT)

**Current State:**
13 files in `packages/ui-components` import from `next/navigation`:
- Header.tsx, Sidebar.tsx
- AuthGuard.tsx, SessionExpiredModal.tsx
- RequestList.tsx, RequestDetails.tsx
- InvoiceList.tsx, InvoiceSubmission.tsx
- PurchaseRequestWizard.tsx, ApprovalWizard.tsx
- AdminOpsDashboard.tsx, AdminInvoicePanel.tsx, KeyMetrics.tsx
- GuidedTour.tsx, DemoScenarios.tsx

**Migration Requirement:**
- Abstract navigation into a router-agnostic interface
- Create navigation context/hook that wraps router library
- Update all 13 components to use abstraction

**Abstraction Pattern:**
```typescript
// packages/ui-components/src/navigation/useAppNavigation.ts
import { useNavigate, useLocation, useParams } from 'react-router-dom';

export function useAppNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  return {
    push: (path: string) => navigate(path),
    replace: (path: string) => navigate(path, { replace: true }),
    back: () => navigate(-1),
    pathname: location.pathname,
    params,
  };
}
```

### 6. Build Configuration (MEDIUM IMPACT)

**Current State:**
- Turbopack (Next.js 16 default)
- Monorepo path aliases via `next.config.mjs`
- API proxy via `rewrites()`

**Migration Requirement:**
```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@aph/ui': path.resolve(__dirname, '../../packages/ui-components/src'),
      '@aph/data': path.resolve(__dirname, '../../packages/data/src'),
      '@aph/state': path.resolve(__dirname, '../../packages/state/src'),
      '@aph/theme': path.resolve(__dirname, '../../packages/ui-theme/src'),
      '@aph/types': path.resolve(__dirname, '../../packages/types/src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  },
});
```

### 7. Testing Infrastructure (LOW-MEDIUM IMPACT)

**Current State:**
- Jest 30 with Babel transformer
- Extensive module mocking for Next.js navigation
- Playwright E2E tests auto-starting Next.js dev server

**Migration Requirement:**
- Update Jest mocks from `next/navigation` to react-router
- Update Playwright config to start Vite dev server
- Consider migrating to Vitest (better Vite integration)

**Files Affected:**
- `jest.config.cjs` - Update moduleNameMapper
- `jest.setup.ts` - Remove Next.js polyfills
- `playwright.config.ts` - Change webServer command
- 37 test files with navigation mocks

---

## Framework-Agnostic Components (No Changes Required)

The following packages require NO changes for Vite migration:

| Package | Dependencies | Status |
|---------|--------------|--------|
| `@aph/data` | axios, @tanstack/react-query | READY |
| `@aph/state` | zustand | READY |
| `@aph/types` | None | READY |
| `@aph/theme` | @mui/material, @emotion | READY |

These represent ~60% of the shared package code and contain all business logic.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Auth security regression | Medium | High | Thorough security review, keep httpOnly cookies via backend |
| Route protection gaps | Medium | High | Comprehensive E2E testing of all protected routes |
| Performance regression (no SSR) | Low | Medium | Add loading states, consider SWR patterns |
| Breaking existing tests | High | Medium | Parallel test suite during migration |
| Development velocity drop | High | Low | Temporary, recovers post-migration |
| Hidden Next.js dependencies | Medium | Medium | Thorough grep/search before migration |

---

## Effort Estimation

| Phase | Tasks | Effort |
|-------|-------|--------|
| **Phase 1: Setup** | Vite config, router setup, build scripts | 2-3 days |
| **Phase 2: Core Routing** | Convert 36 pages, implement route guards | 5-7 days |
| **Phase 3: Auth Migration** | Move API routes to backend, update auth flow | 2-3 days |
| **Phase 4: UI Package** | Abstract navigation in 13 components | 3-4 days |
| **Phase 5: Remove SSR** | Convert async pages to client loading | 2-3 days |
| **Phase 6: Testing** | Update Jest mocks, fix E2E tests | 3-4 days |
| **Phase 7: QA & Polish** | Bug fixes, performance testing | 3-5 days |

**Total Estimated Effort: 20-30 developer days**

---

## Alternative Approaches

### Option 1: Full Migration (As Described)
- Complete removal of Next.js
- Replace with Vite + React Router
- Highest effort, cleanest result

### Option 2: Partial Extraction (Hybrid)
- Keep Next.js for routing and SSR benefits
- Use Vite for development speed
- Not recommended (complexity without benefits)

### Option 3: Stay with Next.js
- No migration effort
- Maintain current SSR capabilities
- Address pain points within Next.js ecosystem

### Option 4: Incremental Migration
- Start with new features in Vite
- Gradually migrate existing pages
- Longest timeline, lower risk per phase

---

## Benefits of Migration

| Benefit | Impact |
|---------|--------|
| Faster HMR (Hot Module Replacement) | High - Vite is significantly faster |
| Simpler mental model (no SSR) | Medium - Reduced complexity |
| Smaller bundle (no Next.js runtime) | Low-Medium - ~50KB savings |
| More control over build | Medium - Direct Rollup/esbuild config |
| Better monorepo tooling options | Low - Can use Turborepo with either |

## Drawbacks of Migration

| Drawback | Impact |
|----------|--------|
| Loss of SSR/SSG capabilities | Low for internal app |
| No middleware-based auth | Medium - Security consideration |
| More boilerplate for routing | Medium - Explicit route definitions |
| Lost investment in Next.js patterns | High - Rewrite ~60% of app layer |
| Learning curve for team | Medium - If team knows Next.js well |

---

## Recommendation

**For an enterprise internal application like PurchasePro:**

### If Primary Goal is Development Speed:
**PROCEED WITH CAUTION** - The migration is feasible but costly. Vite's faster HMR may not justify 20-30 days of migration effort unless the team experiences significant daily friction with Next.js development.

### If Primary Goal is Simplification:
**CONSIDER STAYING** - Next.js App Router patterns are already established. The SSR complexity is manageable and provides real benefits (faster initial loads, SEO if needed later).

### If Primary Goal is Future Flexibility:
**PROCEED** - Removing Next.js coupling makes the codebase more portable to other frameworks/deployments.

### Suggested Decision Criteria:
1. **Migrate if:** Development team is blocked by Next.js issues, SSR is not needed, team prefers Vite ecosystem
2. **Stay if:** Current setup works well, SSR provides value, team invested in Next.js patterns

---

## Open Questions for Stakeholders

1. What is the primary motivation for considering this migration?
2. Is SSR/fast initial page load a requirement for this internal application?
3. What is the acceptable timeline for this migration work?
4. Are there specific Next.js pain points driving this evaluation?
5. Does the team have Vite experience, or would training be needed?

---

**USER: This is an evaluation document. No implementation will be performed. Please review and provide feedback or ask questions.**
