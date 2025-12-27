# Implementation Plan: Frontend Bug/Performance/Stability Fixes

Created: 2025-12-17
Status: PENDING APPROVAL

## Summary

This plan addresses 7 documented frontend issues from `frontend/FRONTEND_REVIEW.md`: return URL mismatch on login redirect, missing `/notifications` route protection, client-only pagination on request/invoice lists, stale initial filters, stub invoice download, unsafe totalAmount formatting, and unauthenticated query firing before auth hydration.

## Scope

### In Scope
1. **Auth redirect alignment**: Fix middleware `redirect` vs login `returnUrl` parameter mismatch
2. **Route protection**: Add `/notifications` to middleware protected routes list
3. **Server-side pagination**: Wire page/limit handlers for RequestList and InvoiceList components
4. **Filter sync**: Re-apply initial filter props when parent changes modes
5. **Query auth guards**: Add `enabled: isAuthenticated` to notification/invoice hooks
6. **Amount formatting**: Guard `totalAmount.toLocaleString()` calls against null/string values
7. **Autosave abort**: Add AbortController pattern to funding autosave

### Out of Scope
- Invoice PDF generation backend (would require new PDFKit implementation)
- Backend changes (all fixes are frontend-only)
- New features beyond fixing documented bugs

## Prerequisites
- Backend APIs already support pagination (page/limit params) - verified
- Auth store provides `isAuthenticated` flag - verified
- Existing safe formatting patterns available for reuse - verified

---

## Implementation Phases

### Phase 1: Auth Redirect Alignment
**Objective**: Fix return URL being lost after forced login

**Files to Modify**:
- `frontend/apps/web/middleware.ts` - Change `redirect` → `returnUrl` (line 58)

**Steps**:
1. In middleware.ts line 58, change:
   ```typescript
   // FROM:
   loginUrl.searchParams.set('redirect', pathname);
   // TO:
   loginUrl.searchParams.set('returnUrl', pathname);
   ```

**Verification**:
- [ ] Visit protected route while unauthenticated
- [ ] Verify URL contains `?returnUrl=/original-path`
- [ ] After login, verify redirect to original path (not /home)

---

### Phase 2: Add /notifications to Protected Routes
**Objective**: Prevent unauthenticated access to notifications page

**Files to Modify**:
- `frontend/apps/web/middleware.ts` - Add `/notifications` to protectedRoutes array (line 18-29)

**Steps**:
1. Add `'/notifications'` to the `protectedRoutes` array after `/invoices`

**Verification**:
- [ ] Visit `/notifications` while unauthenticated
- [ ] Verify redirect to `/login?returnUrl=/notifications`

---

### Phase 3: Add Auth Guards to Notification/Invoice Hooks
**Objective**: Prevent 401 spam during auth hydration

**Files to Modify**:
- `frontend/packages/data/src/hooks/services/useNotifications.ts` - Add enabled guards to 4 hooks
- `frontend/packages/data/src/hooks/services/useInvoices.ts` - Add enabled guards to 3 hooks

**Steps**:

1. In `useNotifications.ts`, update these hooks to include auth guard:

   ```typescript
   // usePendingNotificationsCount (lines 109-116)
   export const usePendingNotificationsCount = () => {
     const { isAuthenticated } = useAuthStore();
     return useQuery<number>({
       queryKey: ['pendingNotificationsCount'],
       queryFn: () => notificationsApi.getPendingCount(),
       enabled: isAuthenticated,  // ADD THIS
       staleTime: 2 * 60 * 1000,
       refetchInterval: 2 * 60 * 1000,
     });
   };

   // useMyNotifications (lines 119-125)
   export const useMyNotifications = (filters?: NotificationFilters) => {
     const { isAuthenticated } = useAuthStore();
     return useQuery({
       queryKey: ['myNotifications', filters],
       queryFn: () => notificationsApi.getAll(filters),
       enabled: isAuthenticated,  // ADD THIS
       staleTime: 1 * 60 * 1000,
     });
   };

   // useUnreadNotificationCount (lines 128-135)
   export const useUnreadNotificationCount = () => {
     const { isAuthenticated } = useAuthStore();
     return useQuery<number>({
       queryKey: ['unreadNotificationCount'],
       queryFn: () => notificationsApi.getUnreadCount(),
       enabled: isAuthenticated,  // ADD THIS
       staleTime: 1 * 60 * 1000,
       refetchInterval: 2 * 60 * 1000,
     });
   };
   ```

2. Add import for `useAuthStore` at top of `useNotifications.ts`:
   ```typescript
   import { useAuthStore } from '@aph/state';
   ```

3. In `useInvoices.ts`, update `useInvoices` hook (lines 32-38):
   ```typescript
   export const useInvoices = (filters?: InvoiceFilters) => {
     const { isAuthenticated } = useAuthStore();
     return useQuery<PaginatedResponse<Invoice>, Error>({
       queryKey: ['invoices', filters],
       queryFn: () => invoicesApi.getAll(filters),
       enabled: isAuthenticated,  // ADD THIS
       staleTime: 1000 * 60 * 5,
     });
   };
   ```

4. Add import for `useAuthStore` at top of `useInvoices.ts`:
   ```typescript
   import { useAuthStore } from '@aph/state';
   ```

**Verification**:
- [ ] Load app fresh (clear localStorage)
- [ ] Verify no 401 errors in console before login
- [ ] After login, verify notification/invoice queries execute

---

### Phase 4: Harden Amount Formatting
**Objective**: Prevent crashes on null/string totalAmount values

**Files to Modify**:
- `frontend/packages/ui-components/src/components/features/request-list/RequestDetails.tsx` - Lines 791, 1036
- `frontend/packages/ui-components/src/components/features/approvals/components/PendingRequestsList.tsx` - Line 217
- `frontend/packages/ui-components/src/components/features/purchase-request/components/DynamicApproverSelection.tsx` - Line 232

**Steps**:

1. In `RequestDetails.tsx` line 791, change:
   ```typescript
   // FROM:
   label={`Amount: $${request.totalAmount.toLocaleString()}`}
   // TO:
   label={`Amount: $${Number(request.totalAmount ?? 0).toLocaleString()}`}
   ```

2. In `RequestDetails.tsx` line 1036, apply same pattern if present

3. In `PendingRequestsList.tsx` line 217, change:
   ```typescript
   // FROM:
   request.totalAmount.toLocaleString()
   // TO:
   Number(request.totalAmount ?? 0).toLocaleString()
   ```

4. In `DynamicApproverSelection.tsx` line 232, change:
   ```typescript
   // FROM:
   totalAmount.toLocaleString()
   // TO:
   Number(totalAmount ?? 0).toLocaleString()
   ```

**Verification**:
- [ ] View request details with various totalAmount values (null, string, number)
- [ ] Verify no crashes and proper formatting

---

### Phase 5: Wire Server-Side Pagination for RequestList
**Objective**: Enable users to navigate beyond first page of requests

**Investigation Result**: The `useRequestList` hook currently strips pagination metadata via `extractData()` function, returning only the data array. Need to refactor to return full `PaginatedResponse` including `meta.total`.

**Files to Modify**:
- `frontend/packages/data/src/hooks/services/useRequestList.ts` - Return full response with meta
- `frontend/packages/ui-components/src/components/features/request-list/RequestList.tsx` - Add pagination state and handlers

**Steps**:

1. **Refactor useRequestList hook** to return full paginated response:
   ```typescript
   // Change return type and remove extractData wrapper
   const fetchRequests = async (
     filters: RequestListFilters
   ): Promise<PaginatedResponse<PurchaseRequest>> => {
     const { mode, ...params } = filters;
     const apiFilters: PurchaseRequestFilters = {
       ...params,
       page: params.page || 1,
       limit: params.limit || 20,
     };

     switch (mode) {
       case 'my-requests':
         return purchaseRequestsApi.getMyRequests(apiFilters);
       case 'approvals':
         return purchaseRequestsApi.getPendingApprovals(apiFilters);
       default:
         return purchaseRequestsApi.getAll(apiFilters);
     }
   };

   export const useRequestList = (filters: RequestListFilters) => {
     const { isAuthenticated } = useAuthStore();
     return useQuery<PaginatedResponse<PurchaseRequest>, Error>({
       queryKey: ['purchaseRequests', filters],
       queryFn: () => fetchRequests(filters),
       enabled: isAuthenticated,
       // ... rest of options
     });
   };
   ```

2. **Update RequestList component** - Add pagination state:
   ```typescript
   const [paginationModel, setPaginationModel] = useState({
     page: 0,  // MUI uses 0-indexed pages
     pageSize: 10,
   });
   ```

3. **Pass pagination to hook**:
   ```typescript
   const { data: response, isLoading } = useRequestList({
     ...filters,
     page: paginationModel.page + 1,  // API uses 1-indexed
     limit: paginationModel.pageSize,
   });
   const requests = response?.data ?? [];
   const meta = response?.meta;
   ```

4. **Update StyledDataGrid** for server-side pagination:
   ```typescript
   <StyledDataGrid
     rows={requests}
     columns={columns}
     paginationMode="server"
     rowCount={meta?.total ?? 0}
     paginationModel={paginationModel}
     onPaginationModelChange={setPaginationModel}
     pageSizeOptions={[10, 25, 50]}
     // ... rest of props
   />
   ```

**Verification**:
- [ ] Load request list with >10 items
- [ ] Click page 2, verify new items load from API
- [ ] Change page size, verify correct number of items

---

### Phase 6: Wire Server-Side Pagination for InvoiceList
**Objective**: Enable users to navigate beyond first 100 invoices

**Files to Modify**:
- `frontend/packages/ui-components/src/components/features/invoices/InvoiceList.tsx` - Add pagination state and handlers

**Steps**:

1. Add pagination state (~line 80):
   ```typescript
   const [paginationModel, setPaginationModel] = useState({
     page: 0,
     pageSize: 10,
   });
   ```

2. Update useInvoices call to include pagination params:
   ```typescript
   const { data: invoicesData, isLoading } = useInvoices({
     ...filters,
     page: paginationModel.page + 1,
     limit: paginationModel.pageSize,
   });
   ```

3. Update StyledDataGrid to use server-side pagination (similar to Phase 5)

**Verification**:
- [ ] Load invoice list with >10 items
- [ ] Verify pagination controls work
- [ ] Verify API receives correct page/limit params

---

### Phase 7: Re-sync Initial Filters on Prop Changes
**Objective**: Update filter state when parent changes mode

**Files to Modify**:
- `frontend/packages/ui-components/src/components/features/request-list/RequestList.tsx` - Add useEffect for initial props

**Steps**:

1. Add useEffect to sync initialStatuses when they change:
   ```typescript
   useEffect(() => {
     if (initialStatuses) {
       setStatusFilter(initialStatuses);
     }
   }, [initialStatuses]);

   useEffect(() => {
     if (initialDateRange) {
       setDateRange(initialDateRange);
     }
   }, [initialDateRange]);
   ```

**Verification**:
- [ ] Parent component changes mode/initial filters
- [ ] Verify child RequestList updates filter state accordingly

---

### Phase 8: Add Abort Guard to Funding Autosave
**Objective**: Prevent stale autosave responses from mutating state after unmount

**Files to Modify**:
- `frontend/apps/web/src/lib/api/purchase-requests.ts` - Add AbortController pattern

**Steps**:

1. Add AbortController ref at component level:
   ```typescript
   const abortControllerRef = React.useRef<AbortController | null>(null);
   ```

2. In the autosave effect, create new AbortController and abort previous:
   ```typescript
   timerRef.current = setTimeout(async () => {
     // Abort any previous in-flight request
     abortControllerRef.current?.abort();
     abortControllerRef.current = new AbortController();
     const signal = abortControllerRef.current.signal;

     // Only autosave when there is at least one row
     if (!rows || rows.length === 0) return;
     setIsSaving(true);
     setError(null);
     try {
       // Check if aborted before state updates
       if (signal.aborted) return;
       // ... rest of autosave logic
       if (signal.aborted) return;  // Check again after async operations
       setLastSavedAt(new Date());
     } catch (e: unknown) {
       if (signal.aborted) return;  // Don't handle errors for aborted requests
       // ... error handling
     } finally {
       if (!signal.aborted) {
         setIsSaving(false);
       }
     }
   }, debounceMs);
   ```

3. Update cleanup to abort on unmount:
   ```typescript
   return () => {
     if (timerRef.current) clearTimeout(timerRef.current);
     abortControllerRef.current?.abort();
   };
   ```

**Verification**:
- [ ] Rapidly navigate away from funding step while autosave is pending
- [ ] Verify no React warnings about unmounted component state updates
- [ ] Verify no stray sessionStorage writes after navigation

---

### Phase 9: Invoice Download - Show "Coming Soon" Message
**Objective**: Replace silent log with user-friendly notification (backend endpoint doesn't exist)

**Investigation Result**: Backend has NO `/invoices/:id/pdf` endpoint. The `generateInvoicePdf` service method doesn't exist. Creating the backend endpoint is out of scope for this frontend-only fix.

**Files to Modify**:
- `frontend/packages/ui-components/src/components/features/invoices/InvoiceList.tsx` - Show notification instead of silent log

**Steps**:

1. Update InvoiceList handleAction case 'download' to show user-friendly message:
   ```typescript
   case 'download':
     // Backend invoice PDF endpoint not yet implemented
     addNotification({
       type: 'info',
       title: 'Feature Coming Soon',
       message: 'Invoice PDF download will be available in a future update.',
     });
     break;
   ```

2. Ensure `addNotification` is available from `useNotificationStore` (may need to import)

**Verification**:
- [ ] Click download on invoice
- [ ] Verify user sees "Coming Soon" notification
- [ ] No silent failures or console errors

---

## Testing Strategy

### Unit Tests
- Test amount formatting utility with null, undefined, string, number inputs
- Test hook enabled guards with mocked auth state

### Integration Tests
- Test login redirect flow end-to-end
- Test pagination state persistence across filter changes

### Manual Testing
1. Auth flow: Unauthenticated visit to protected route → login → return to original
2. Pagination: Navigate through multiple pages on request/invoice lists
3. Notifications: Fresh load without auth cookies → no 401 errors
4. Amount display: View requests with various totalAmount values

---

## Rollback Plan

Each phase is independent and can be reverted individually:
1. Revert specific file changes via git
2. No database migrations required
3. No backend changes required

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Pagination breaks existing filters | Medium | Medium | Test thoroughly with existing filter combinations |
| Auth guard breaks legitimate unauthenticated flows | Low | High | Verify no public pages use these hooks |
| Amount formatting edge cases | Low | Low | Use defensive `Number(...) ?? 0` pattern |
| useRequestList refactor breaks consumers | Medium | Medium | Search for all usages and update accordingly |

---

## Resolved Questions (Investigation Complete)

1. **Invoice PDF**: Backend has NO `/invoices/:id/pdf` endpoint. **Decision**: Show "Coming Soon" notification instead of implementing backend (out of scope).

2. **Request list meta**: `useRequestList` uses `extractData()` which strips pagination meta. **Decision**: Refactor hook to return full `PaginatedResponse<PurchaseRequest>` with meta.

---

**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
