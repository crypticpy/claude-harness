# Password Reset / Invitation Email Flow Implementation Plan

## Overview

Implement a secure password setup flow where:
1. Admin creates user → System **automatically** sends "Set your password" email
2. User clicks secure link → Sets their own password
3. "Forgot password" flow for existing users who need to reset

**Decision:** Invitation emails are sent automatically when admin creates a user (no manual button needed).

## Database Changes

### Prisma Schema (User model)

Add two new fields to the `User` model:

```prisma
model User {
  // ... existing fields
  passwordResetToken    String?   @db.VarChar(255)
  passwordResetExpires  DateTime?
}
```

**Migration:** `npx prisma migrate dev --name add_password_reset_token`

## Backend Implementation

### 1. Auth Service Changes (`backend/src/services/auth.service.ts`)

Add these methods:

```typescript
// Generate secure token (crypto.randomBytes)
generatePasswordResetToken(): { token: string; hash: string }

// Request password reset - generates token, stores hash, sends email
requestPasswordReset(email: string): Promise<void>

// Validate token (find user, check expiry, compare hash)
validatePasswordResetToken(token: string): Promise<User>

// Reset password with token (validates token, sets new password, clears token)
resetPasswordWithToken(token: string, newPassword: string): Promise<void>
```

**Token Strategy:**
- Generate 32-byte random token with `crypto.randomBytes(32).toString('hex')`
- Store SHA-256 hash in database (not the raw token)
- Token expires in 24 hours
- One-time use (cleared after password set)

### 2. Auth Controller (`backend/src/controllers/auth.controller.ts`)

Add endpoints:

```typescript
// POST /auth/forgot-password
// Body: { email: string }
// Response: { success: true, message: "If email exists, reset link sent" }
// Note: Always returns success (no email enumeration)
forgotPassword()

// POST /auth/reset-password
// Body: { token: string, newPassword: string }
// Response: { success: true, message: "Password updated successfully" }
resetPassword()
```

### 3. Auth Routes (`backend/src/routes/auth.routes.ts`)

```typescript
router.post('/forgot-password', rateLimiter, authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
```

Rate limit: 3 requests per 15 minutes per IP

### 4. Validation Schema (`backend/src/validations/auth.validation.ts`)

```typescript
export const forgotPasswordSchema = z.object({
  email: z.string().email()
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[a-z]/, 'Must contain lowercase')
    .regex(/[0-9]/, 'Must contain number')
});
```

### 5. Email Template (`backend/src/notifications/templates.ts`)

Add `password-reset` template:

```typescript
'password-reset': {
  subject: 'Set Your APH Purchase Request Password',
  render: (vars) => ({
    subject: 'Set Your APH Purchase Request Password',
    body: `Click here to set your password: ${vars.resetUrl}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2>Welcome to APH Purchase Request System</h2>
        <p>Hi ${vars.userName},</p>
        <p>Click the button below to set your password:</p>
        <a href="${vars.resetUrl}" style="...button styles...">
          Set Your Password
        </a>
        <p>This link expires in 24 hours.</p>
      </div>
    `
  })
}
```

### 6. User Service Enhancement (`backend/src/services/user.service.ts`)

Modify `createUser()` to optionally send invitation email:

```typescript
async createUser(data, options?: { sendInvitation?: boolean }) {
  const user = await this.prisma.user.create({...});

  if (options?.sendInvitation) {
    await authService.requestPasswordReset(user.email);
  }

  return user;
}
```

## Frontend Implementation

### 1. Forgot Password Page

**Location:** `/frontend/apps/web/src/app/forgot-password/`

Files:
- `page.tsx` - Server wrapper
- `ForgotPasswordClient.tsx` - Client component

**UI:**
- Simple form with email input
- Submit button "Send Reset Link"
- Success message: "If an account exists, you'll receive an email"
- Link back to login page

### 2. Reset Password Page

**Location:** `/frontend/apps/web/src/app/reset-password/[token]/`

Files:
- `page.tsx` - Server wrapper (extracts token from params)
- `ResetPasswordClient.tsx` - Client component

**UI:**
- Password input with requirements indicator
- Confirm password input
- Submit button "Set Password"
- On success: Redirect to login with success message
- On invalid/expired token: Show error with link to request new reset

### 3. API Service (`frontend/packages/data/src/lib/api/services/auth.ts`)

Add methods:

```typescript
forgotPassword: async (email: string) => {
  return apiService.post('/auth/forgot-password', { email });
}

resetPassword: async (token: string, newPassword: string) => {
  return apiService.post('/auth/reset-password', { token, newPassword });
}
```

### 4. Login Page Enhancement

Add "Forgot Password?" link below the password field:

```tsx
<Link href="/forgot-password">Forgot Password?</Link>
```

## File Changes Summary

### Backend (7 files)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `passwordResetToken`, `passwordResetExpires` to User |
| `src/services/auth.service.ts` | Add token generation, validation, reset methods |
| `src/controllers/auth.controller.ts` | Add `forgotPassword`, `resetPassword` handlers |
| `src/routes/auth.routes.ts` | Add `/forgot-password`, `/reset-password` routes |
| `src/validations/auth.validation.ts` | Add schemas |
| `src/notifications/templates.ts` | Add `password-reset` template |
| `src/services/user.service.ts` | Add optional invitation email on create |

### Frontend (5 files)

| File | Change |
|------|--------|
| `apps/web/src/app/forgot-password/page.tsx` | New page wrapper |
| `apps/web/src/app/forgot-password/ForgotPasswordClient.tsx` | New client component |
| `apps/web/src/app/reset-password/[token]/page.tsx` | New page wrapper |
| `apps/web/src/app/reset-password/[token]/ResetPasswordClient.tsx` | New client component |
| `packages/data/src/lib/api/services/auth.ts` | Add API methods |
| `apps/web/src/app/login/LoginClient.tsx` | Add "Forgot Password?" link |

## Security Considerations

1. **No email enumeration** - Always return success message regardless of email existence
2. **Token hashing** - Store SHA-256 hash, not raw token
3. **Short expiry** - 24 hours maximum
4. **One-time use** - Clear token after successful password set
5. **Rate limiting** - Prevent abuse of forgot password endpoint
6. **HTTPS only** - Reset links must use HTTPS in production
7. **Password complexity** - Enforce same rules as existing password change

## Implementation Order

1. Database migration (add fields)
2. Backend auth service methods
3. Backend validation schemas
4. Backend controller and routes
5. Email template
6. Frontend API service methods
7. Frontend forgot password page
8. Frontend reset password page
9. Login page "Forgot Password?" link
10. Test end-to-end flow

## Testing Plan

1. Request password reset for existing email → Email sent with valid link
2. Request password reset for non-existent email → Same success message (no enumeration)
3. Click reset link → Valid token shows password form
4. Click expired/invalid link → Shows error with retry option
5. Set new password → Success, can login with new password
6. Try same link again → Invalid (one-time use)
7. Rate limiting → Block after 3 requests per 15 minutes
