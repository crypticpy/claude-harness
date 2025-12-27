# Comprehensive Security Review: APH Purchase Request Workflow

Created: 2025-11-28
Status: PENDING APPROVAL
Prepared For: Municipal Government Security Audit Readiness

---

## Executive Summary

This security review evaluates the APH Purchase Request Workflow application against modern government security standards, including NIST 800-53, OWASP Top 10 (2021), and Texas DIR security requirements typical for municipal government applications. The review identifies vulnerabilities, assesses risk levels, and provides actionable remediation recommendations.

**Overall Security Posture: MODERATE RISK**

The application demonstrates solid foundational security practices but has several gaps that would likely be flagged in a municipal government security audit.

---

## Table of Contents

1. [Authentication & Authorization](#1-authentication--authorization)
2. [Input Validation & Injection Prevention](#2-input-validation--injection-prevention)
3. [API Security](#3-api-security)
4. [Data Protection & Privacy](#4-data-protection--privacy)
5. [Secrets Management](#5-secrets-management)
6. [Dependency & Supply Chain Security](#6-dependency--supply-chain-security)
7. [Logging & Audit Trail](#7-logging--audit-trail)
8. [Infrastructure Security](#8-infrastructure-security)
9. [Frontend Security](#9-frontend-security)
10. [Compliance Gap Analysis](#10-compliance-gap-analysis)
11. [Prioritized Remediation Plan](#11-prioritized-remediation-plan)

---

## 1. Authentication & Authorization

### Current Implementation

| Component | Status | Risk |
|-----------|--------|------|
| JWT-based authentication | Implemented | Low |
| Password hashing (bcrypt, 10 rounds) | Implemented | Low |
| Role-based access control (RBAC) | Partially Implemented | Medium |
| Session management | Partial (stateless JWT) | Medium |
| Multi-factor authentication | Not Implemented | High |
| Account lockout | Not Implemented | High |
| Password complexity enforcement | Implemented (12 chars, 3/4 classes) | Low |

### Findings

#### CRITICAL: No Multi-Factor Authentication (MFA)
- **Location**: `backend/src/services/auth.service.ts`
- **Risk**: Government systems handling financial data typically require MFA
- **Impact**: Non-compliant with NIST 800-53 IA-2(1) for privileged users
- **Recommendation**: Implement TOTP-based MFA or integrate with Azure AD (already stubbed)

#### HIGH: No Account Lockout Mechanism
- **Location**: `backend/src/controllers/auth.controller.ts:login()`
- **Risk**: Susceptible to brute force attacks
- **Current State**: No tracking of failed login attempts
- **Recommendation**: Implement progressive lockout (5 attempts = 15 min lockout, 10 = 1 hour)

#### HIGH: JWT Token Revocation Not Implemented
- **Location**: `backend/src/services/session.service.ts` (stub only)
- **Risk**: Compromised tokens remain valid until expiration
- **Current State**: `invalidateSessionsForUser()` is a no-op placeholder
- **Recommendation**: Implement token blacklist via Redis or database

#### MEDIUM: Long Token Expiration
- **Location**: `backend/src/config/index.ts:70`
- **Current Value**: 7 days (access token), 30 days (refresh token)
- **Government Standard**: 8-12 hours for access tokens
- **Recommendation**: Reduce access token expiry to 8 hours, refresh to 7 days

#### MEDIUM: Refresh Token Reuse Allowed
- **Location**: `backend/src/services/auth.service.ts:refreshToken()`
- **Risk**: Refresh token replay attacks possible
- **Recommendation**: Implement refresh token rotation with one-time use

### Code Evidence

```typescript
// backend/src/config/index.ts:70
expiresIn: process.env.JWT_EXPIRES_IN || '7d',  // FINDING: Too long for government systems

// backend/src/services/session.service.ts:15-17
export function invalidateSessionsForUser(_userId: string): void {
  // Phase 3 stub: No session infra yet; no-op
}
```

---

## 2. Input Validation & Injection Prevention

### Current Implementation

| Component | Status | Risk |
|-----------|--------|------|
| Zod schema validation | Implemented | Low |
| SQL injection prevention (Prisma ORM) | Implemented | Low |
| XSS prevention | Partial | Medium |
| CSRF protection | Token-based (implicit) | Low |
| Command injection prevention | Not Assessed | Medium |
| Path traversal prevention | Partial | Medium |

### Findings

#### LOW: Robust Input Validation Layer
- **Location**: `backend/src/validations/*.validation.ts` (16 files)
- **Strength**: Comprehensive Zod schemas for all API endpoints
- **Coverage**: Email format, UUID validation, numeric bounds, enum constraints, string lengths

#### LOW: SQL Injection Prevention
- **Location**: All service files use Prisma ORM
- **Strength**: Parameterized queries via Prisma Client
- **MSSQL**: Uses typed parameters in `backend/src/utils/mssql.ts`

#### MEDIUM: No Explicit XSS Sanitization
- **Location**: Backend relies on frontend (React) for XSS prevention
- **Risk**: If API responses are rendered in non-React contexts, XSS possible
- **Recommendation**: Add output encoding library (e.g., `he` or `DOMPurify` on server for email templates)

#### MEDIUM: File Upload Path Validation
- **Location**: `backend/src/config/features.ts:156`
- **Finding**: Hardcoded Windows path `C:\\Users\\jacksonjo\\PurchaseApp\\Attachments`
- **Risk**: Path traversal if user input affects file paths
- **Recommendation**: Validate uploaded filenames, use UUID-based storage names

### Code Evidence

```typescript
// backend/src/validations/attachment.validation.ts
export const createAttachmentSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileSize: z.number().max(50 * 1024 * 1024),  // 50MB limit
  mimeType: z.string().max(100),
  // ... comprehensive validation
});
```

---

## 3. API Security

### Current Implementation

| Component | Status | Risk |
|-----------|--------|------|
| Rate limiting | Implemented | Low |
| CORS configuration | Implemented | Low |
| Security headers (Helmet) | Implemented | Low |
| API versioning | Not Implemented | Low |
| Request size limits | Implemented (10MB) | Low |
| API authentication | Bearer JWT | Low |

### Findings

#### LOW: Rate Limiting Implemented
- **Location**: `backend/src/app.ts:128-141`
- **Configuration**: 100 requests per 15 minutes (configurable)
- **User-keyed**: Uses `user:{userId}` when authenticated, `ip:{ip}` otherwise
- **Note**: Disabled in development (acceptable)

#### LOW: Security Headers via Helmet
- **Location**: `backend/src/app.ts:72-78`
- **Headers Set**: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, etc.
- **Finding**: Content-Security-Policy disabled (`contentSecurityPolicy: false`)
- **Recommendation**: Enable CSP with appropriate directives for production

#### MEDIUM: CORS Origin Whitelist
- **Location**: `backend/src/config/index.ts:81-92`
- **Default**: `['http://localhost:3000', 'http://localhost:3001']`
- **Risk**: Production must be configured via `CORS_ORIGIN` env variable
- **Recommendation**: Document required production CORS configuration

#### MEDIUM: No API Versioning
- **Current State**: All routes under `/api/*` without version prefix
- **Risk**: Breaking changes affect all clients simultaneously
- **Recommendation**: Implement `/api/v1/*` versioning pattern

#### LOW: Swagger/OpenAPI Documentation
- **Location**: `/api-docs` endpoint with Bearer auth scheme
- **Strength**: All endpoints documented with security requirements
- **Note**: Consider restricting access in production

### Code Evidence

```typescript
// backend/src/app.ts:81-93
app.use(cors({
  origin: config.cors.origin,
  credentials: config.cors.credentials,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
```

---

## 4. Data Protection & Privacy

### Current Implementation

| Component | Status | Risk |
|-----------|--------|------|
| Data encryption at rest | Not Implemented | Critical |
| Data encryption in transit | TLS Required | Low |
| PII handling | Cleartext storage | High |
| Data retention policies | Soft delete only | Medium |
| Backup/recovery | Not Application-Level | Medium |

### Findings

#### CRITICAL: No Encryption at Rest for Sensitive Data
- **Location**: Database schema stores all data in cleartext
- **Affected Fields**:
  - `User.password` (hashed, acceptable)
  - `Vendor.taxId` (cleartext, **HIGH RISK**)
  - `PurchaseRequest.taxExemptNumber` (cleartext, **HIGH RISK**)
  - `Invoice.paymentReference` (cleartext, **MEDIUM RISK**)
  - `User.pushSubscription` (JSON, contains tokens)
- **Government Requirement**: NIST 800-53 SC-28 requires encryption of sensitive data
- **Recommendation**: Implement field-level encryption for PII/financial data

#### HIGH: MSSQL Connection Without Encryption
- **Location**: `backend/src/config/index.ts:52-53`
- **Finding**: `encrypt: false`, `trustServerCertificate: true`
- **Risk**: Data transmitted in cleartext between app and database
- **Recommendation**: Enable TLS for database connections

#### MEDIUM: Soft Delete Without Retention Policy
- **Location**: Schema uses `deletedAt` fields for soft delete
- **Finding**: No automated purge of soft-deleted records
- **Risk**: Data retained indefinitely, potential compliance issues
- **Recommendation**: Implement retention policy automation (e.g., 7-year purge for financial records)

#### MEDIUM: No Data Classification
- **Current State**: No formal classification of data sensitivity levels
- **Recommendation**: Implement data classification schema (Public, Internal, Confidential, Restricted)

### Code Evidence

```typescript
// backend/src/config/index.ts:52-53
options: {
  encrypt: false,  // CRITICAL: Should be true in production
  trustServerCertificate: true,  // CRITICAL: Should validate certs
}
```

---

## 5. Secrets Management

### Current Implementation

| Component | Status | Risk |
|-----------|--------|------|
| Environment variables | Implemented | Medium |
| Secrets in code | Development defaults present | High |
| .env files gitignored | Yes | Low |
| External vault integration | Not Implemented | High |
| Secret rotation | Not Implemented | High |

### Findings

#### HIGH: Hardcoded Development Secrets in Source Code
- **Location**: `backend/src/config/index.ts:66-69, 72-75`
- **Finding**: Fallback secrets in source code
  ```typescript
  'dev-jwt-secret-change-in-production'
  'dev-refresh-secret-change-in-production'
  ```
- **Risk**: Accidental use in production if env vars not set
- **Mitigation Present**: Production validation requires `JWT_SECRET` (32+ chars)
- **Recommendation**: Remove hardcoded fallbacks; fail fast in all environments

#### HIGH: No External Secrets Manager
- **Current State**: Relies entirely on environment variables
- **Government Requirement**: Typically requires HSM or vault-backed secrets
- **Recommendation**: Integrate Azure Key Vault (infrastructure exists)

#### HIGH: No Secret Rotation Mechanism
- **Current State**: JWT secrets static until manually changed
- **Risk**: Long-term key compromise undetected
- **Recommendation**: Implement key rotation with versioned secrets

#### MEDIUM: Default Password in Code
- **Location**: `backend/src/config/index.ts:178`
- **Finding**: `defaultUserPassword: process.env.DEFAULT_USER_PASSWORD || 'ChangeMe123!'`
- **Risk**: Weak default password if env var not set
- **Recommendation**: Generate random passwords, require immediate change

#### LOW: .env Files Properly Gitignored
- **Location**: Multiple `.gitignore` files exclude `.env*` patterns
- **Strength**: Prevents accidental credential commits

### Code Evidence

```typescript
// backend/src/config/index.ts:7-26
function validateEnv() {
  const requiredEnvVars = ['JWT_SECRET', 'DATABASE_URL'];
  if (process.env.NODE_ENV === 'production') {
    // ... validation exists but insufficient
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters long in production');
    }
  }
}
```

---

## 6. Dependency & Supply Chain Security

### Current Implementation

| Component | Status | Risk |
|-----------|--------|------|
| Lock files committed | Yes | Low |
| npm ci in CI/CD | Yes | Low |
| Dependabot enabled | Yes | Low |
| npm audit in CI | Not Implemented | Critical |
| SBOM generation | Not Implemented | High |
| Vulnerability remediation | Delayed | Critical |

### Findings

#### CRITICAL: Known Vulnerabilities Not Remediated

**Backend Vulnerabilities (16 total)**:
| Severity | Package | Vulnerability | CVE/GHSA |
|----------|---------|--------------|----------|
| Critical | form-data@4.0.0 | Unsafe random boundary | GHSA-fjxv-7rqg-78g4 |
| High | axios@1.10.0 | DoS via data size | GHSA-4hjh-wcwx-xvwj |
| High | multer@2.0.1 | DoS malformed request | GHSA-fjgf-rc76-4x9p |
| Moderate | nodemailer@7.0.6 | Email domain confusion | GHSA-mm7p-fcc7-pg87 |

**Frontend Vulnerabilities (7 total)**:
| Severity | Package | Vulnerability | CVE/GHSA |
|----------|---------|--------------|----------|
| Critical | form-data@4.0.0 | Unsafe random boundary | GHSA-fjxv-7rqg-78g4 |
| Critical | sha.js@<=2.4.11 | Hash rewind attack | GHSA-95m3-7q98-8xr5 |
| High | axios@1.10.0 | DoS via data size | GHSA-4hjh-wcwx-xvwj |
| High | glob@10.2.0 | Command injection | GHSA-5j98-mcp5-4vw2 |

#### CRITICAL: No npm audit in CI Pipeline
- **Location**: `.github/workflows/ci.yml`
- **Finding**: No `npm audit` step despite known vulnerabilities
- **Recommendation**: Add `npm audit --audit-level=high` to CI pipeline

#### HIGH: No Software Bill of Materials (SBOM)
- **Government Requirement**: Executive Order 14028 requires SBOM for government software
- **Recommendation**: Generate SBOM using `npm sbom` or CycloneDX

#### MEDIUM: Dual Password Libraries
- **Location**: Both `bcrypt` and `bcryptjs` in dependencies
- **Risk**: Increased attack surface, potential version confusion
- **Recommendation**: Standardize on `bcrypt` (native) or `bcryptjs` (pure JS)

### Remediation Commands

```bash
# Backend fixes
cd backend
npm update axios@latest  # Fixes HIGH DoS
npm audit fix --force    # Address remaining issues

# Frontend fixes
cd frontend
npm update axios@latest
npm audit fix
```

---

## 7. Logging & Audit Trail

### Current Implementation

| Component | Status | Risk |
|-----------|--------|------|
| Application logging | Implemented | Low |
| Audit trail | Feature-gated (disabled) | High |
| Log sanitization | Implemented | Low |
| Centralized logging | Not Implemented | Medium |
| Log retention | Not Defined | Medium |

### Findings

#### HIGH: Audit Logging Disabled by Default
- **Location**: `backend/src/config/index.ts:210`
- **Finding**: `auditLogsEnabled: FEATURES.auditLogsEnabled` (defaults to `false`)
- **Government Requirement**: All financial transactions must be auditable
- **Recommendation**: Enable `AUDIT_LOGS_ENABLED=true` in production

#### LOW: Sensitive Field Redaction in Logs
- **Location**: `backend/src/middleware/error.middleware.ts:35-51`
- **Strength**: Comprehensive redaction of 15+ sensitive field patterns
- **Fields Redacted**: password, authorization, cookie, token, session, secret, auth

#### MEDIUM: No Centralized Log Aggregation
- **Current State**: Logs written to local files (`app.log`)
- **Recommendation**: Implement ELK/Splunk/Azure Monitor integration

#### MEDIUM: No Log Integrity Protection
- **Risk**: Logs can be modified or deleted by compromised application
- **Recommendation**: Write logs to append-only storage or SIEM

### Audit Events to Capture (Currently Missing)

| Event | Captured | Required |
|-------|----------|----------|
| User login success | No | Yes |
| User login failure | No | Yes |
| Password change | Partial | Yes |
| Role assignment | No | Yes |
| Purchase request approval | No | Yes |
| Data export | No | Yes |
| Admin actions | Partial | Yes |

### Code Evidence

```typescript
// backend/src/middleware/error.middleware.ts:35-50
const SENSITIVE_KEYS = [
  'password', 'authorization', 'cookie', 'set-cookie',
  'refreshtoken', 'accesstoken', 'token',
  'x-auth-token', 'x-refresh-token', 'auth', 'session', 'secret',
];
```

---

## 8. Infrastructure Security

### Current Implementation

| Component | Status | Risk |
|-----------|--------|------|
| Docker multi-stage builds | Implemented | Low |
| Non-root container user | Implemented | Low |
| Health checks | Implemented | Low |
| Network segmentation | Docker Compose only | Medium |
| HTTPS/TLS | Not enforced in app | High |

### Findings

#### HIGH: No TLS Enforcement in Application
- **Location**: `backend/src/app.ts`
- **Finding**: Application listens on HTTP, relies on reverse proxy for TLS
- **Risk**: Internal network traffic unencrypted
- **Recommendation**: Document TLS termination requirements; consider end-to-end encryption

#### LOW: Secure Docker Configuration
- **Location**: `backend/Dockerfile`, `frontend/Dockerfile`
- **Strengths**:
  - Multi-stage builds (no dev dependencies in production)
  - Non-root user (`nodejs`)
  - `dumb-init` for proper signal handling
  - `npm ci` for deterministic installs

#### MEDIUM: Hardcoded Database Defaults in Docker Compose
- **Location**: `docker-compose.yml:10-15`
- **Finding**: Default credentials `aph_user:aph_pass`, `root_pass`
- **Risk**: Accidental production use with weak credentials
- **Recommendation**: Remove defaults; require explicit configuration

#### MEDIUM: No Network Policies in Production Compose
- **Location**: `docker-compose.prod.yml`
- **Finding**: Basic internal/external network separation only
- **Recommendation**: Implement strict network policies (database not internet-accessible)

### Code Evidence

```dockerfile
# backend/Dockerfile:49-53
USER nodejs
EXPOSE 5001
CMD ["dumb-init", "node", "dist/index.js"]
```

---

## 9. Frontend Security

### Current Implementation

| Component | Status | Risk |
|-----------|--------|------|
| httpOnly cookies | Implemented | Low |
| XSS prevention (React) | Implicit | Low |
| CSRF protection | Token-based | Low |
| Content Security Policy | Not Implemented | Medium |
| Subresource Integrity | Not Assessed | Medium |
| Secure cookie flags | Partial | Medium |

### Findings

#### LOW: httpOnly Cookie Storage for Tokens
- **Location**: `frontend/apps/web/src/lib/server/auth.ts:14-20`
- **Strength**: Tokens stored in httpOnly cookies (not accessible via JavaScript)
- **Note**: Backup localStorage storage for client-side hydration

#### LOW: React XSS Protection
- **Current State**: No `dangerouslySetInnerHTML` usage detected
- **Strength**: React's default JSX escaping prevents XSS

#### MEDIUM: Cookie Secure Flag Conditional
- **Location**: `frontend/apps/web/src/lib/server/auth.ts:16`
- **Finding**: `secure: process.env.NODE_ENV === 'production'`
- **Risk**: Development cookies sent over HTTP (acceptable for dev)

#### MEDIUM: No Content Security Policy
- **Location**: No CSP headers configured in Next.js
- **Recommendation**: Implement strict CSP via `next.config.ts` headers

#### LOW: Next.js Hardening Present
- **Location**: `frontend/apps/web/next.config.ts`
- **Finding**: `poweredByHeader: false` removes X-Powered-By header

### Recommended CSP Configuration

```typescript
// next.config.ts
headers: async () => [{
  source: '/(.*)',
  headers: [{
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.example.com"
  }]
}]
```

---

## 10. Compliance Gap Analysis

### NIST 800-53 Control Gaps

| Control | Description | Status | Gap |
|---------|-------------|--------|-----|
| AC-2 | Account Management | Partial | No automated deprovisioning |
| AC-7 | Unsuccessful Logon Attempts | Missing | No lockout mechanism |
| AU-2 | Audit Events | Partial | Feature-gated, disabled |
| AU-9 | Protection of Audit Information | Missing | Logs not integrity-protected |
| IA-2(1) | MFA for Privileged Users | Missing | No MFA implementation |
| IA-5(1) | Password-based Authentication | Partial | No password history |
| SC-8 | Transmission Confidentiality | Partial | Internal traffic unencrypted |
| SC-28 | Protection of Data at Rest | Missing | No field-level encryption |
| SI-10 | Information Input Validation | Complete | Zod schemas comprehensive |

### OWASP Top 10 (2021) Assessment

| Risk | Status | Notes |
|------|--------|-------|
| A01: Broken Access Control | Low Risk | RBAC implemented, missing audit |
| A02: Cryptographic Failures | High Risk | No encryption at rest, weak DB TLS |
| A03: Injection | Low Risk | Parameterized queries via Prisma |
| A04: Insecure Design | Medium Risk | No threat modeling documented |
| A05: Security Misconfiguration | Medium Risk | Hardcoded defaults, CSP disabled |
| A06: Vulnerable Components | Critical | 23 known vulnerabilities |
| A07: Auth Failures | High Risk | No MFA, no lockout |
| A08: Data Integrity Failures | Medium Risk | No SBOM, unsigned packages |
| A09: Logging Failures | Medium Risk | Audit logging disabled |
| A10: SSRF | Low Risk | No user-controlled URLs detected |

### Texas DIR Security Requirements (Typical)

| Requirement | Status |
|-------------|--------|
| Encryption of data in transit | Partial (requires TLS at proxy) |
| Encryption of data at rest | Not Met |
| Multi-factor authentication | Not Met |
| Annual penetration testing | N/A (process requirement) |
| Incident response plan | N/A (documentation requirement) |
| Vulnerability scanning | Not Met (no npm audit in CI) |

---

## 11. Prioritized Remediation Plan

### Phase 1: Critical (Immediate - Week 1)

| Priority | Item | Effort | Risk Reduction |
|----------|------|--------|----------------|
| P0 | Run `npm audit fix` for all packages | 2 hours | Critical |
| P0 | Enable audit logging in production | 1 hour | High |
| P0 | Add `npm audit --audit-level=high` to CI | 1 hour | Critical |
| P0 | Remove hardcoded JWT secrets from source | 2 hours | High |
| P0 | Enable MSSQL encryption (`encrypt: true`) | 1 hour | Critical |

### Phase 2: High (Week 2-3)

| Priority | Item | Effort | Risk Reduction |
|----------|------|--------|----------------|
| P1 | Implement account lockout mechanism | 8 hours | High |
| P1 | Reduce JWT token expiration to 8 hours | 1 hour | Medium |
| P1 | Implement refresh token rotation | 4 hours | Medium |
| P1 | Add login success/failure audit events | 4 hours | High |
| P1 | Implement password history (last 12) | 4 hours | Medium |
| P1 | Document TLS termination requirements | 2 hours | Medium |

### Phase 3: Medium (Week 4-6)

| Priority | Item | Effort | Risk Reduction |
|----------|------|--------|----------------|
| P2 | Implement MFA (TOTP or Azure AD) | 24 hours | Critical |
| P2 | Add field-level encryption for PII | 16 hours | High |
| P2 | Implement Content Security Policy | 4 hours | Medium |
| P2 | Generate SBOM in CI pipeline | 4 hours | Medium |
| P2 | Implement centralized logging (ELK/Azure Monitor) | 16 hours | Medium |
| P2 | Add API versioning (/api/v1/*) | 8 hours | Low |

### Phase 4: Low (Ongoing)

| Priority | Item | Effort | Risk Reduction |
|----------|------|--------|----------------|
| P3 | Implement data retention automation | 8 hours | Medium |
| P3 | Add XSS output encoding library | 4 hours | Low |
| P3 | Implement secret rotation mechanism | 16 hours | Medium |
| P3 | Azure Key Vault integration | 16 hours | High |
| P3 | Implement log integrity protection | 8 hours | Medium |

---

## Appendix A: Files Reviewed

### Backend Security-Critical Files
- `backend/src/middleware/auth.middleware.ts`
- `backend/src/middleware/admin.middleware.ts`
- `backend/src/middleware/adminOrFinance.middleware.ts`
- `backend/src/middleware/error.middleware.ts`
- `backend/src/middleware/validation.middleware.ts`
- `backend/src/middleware/rateLimit.middleware.ts`
- `backend/src/services/auth.service.ts`
- `backend/src/services/user.service.ts`
- `backend/src/services/audit.service.ts`
- `backend/src/config/index.ts`
- `backend/src/config/features.ts`
- `backend/src/app.ts`
- `backend/src/validations/*.validation.ts` (16 files)
- `backend/prisma/schema.prisma`

### Frontend Security-Critical Files
- `frontend/apps/web/src/lib/server/auth.ts`
- `frontend/apps/web/src/app/api/auth/session/route.ts`
- `frontend/packages/state/src/stores/useAuthStore.ts`
- `frontend/packages/data/src/lib/api/index.ts`
- `frontend/packages/ui-components/src/components/providers/AuthGuard.tsx`
- `frontend/apps/web/next.config.ts`

### Configuration Files
- `.github/workflows/ci.yml`
- `.github/dependabot.yml`
- `docker-compose.yml`
- `docker-compose.prod.yml`
- `backend/Dockerfile`
- `frontend/Dockerfile`
- `backend/.env.example`
- `backend/.env.production.example`

---

## Appendix B: Security Testing Recommendations

### Pre-Audit Testing Checklist

1. **Automated Scanning**
   - [ ] Run OWASP ZAP against staging environment
   - [ ] Run npm audit on frontend and backend
   - [ ] Run Snyk or Dependabot security scan
   - [ ] Run static analysis (SonarQube or CodeQL)

2. **Manual Testing**
   - [ ] Verify JWT token validation
   - [ ] Test session management (logout, expiration)
   - [ ] Test rate limiting effectiveness
   - [ ] Verify input validation across all endpoints
   - [ ] Test file upload security
   - [ ] Verify error messages don't leak information

3. **Configuration Review**
   - [ ] Verify production CORS configuration
   - [ ] Verify TLS configuration at proxy level
   - [ ] Verify database connection encryption
   - [ ] Verify log retention and access controls

---

**USER: Please review this security plan. Edit any section directly in this file, then confirm to proceed with implementation of the remediation items.**
