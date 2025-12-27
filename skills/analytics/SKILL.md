---
name: analytics
description: Analytics Documentation and Best Practices. To be used when working with Datafa.st or Umami or other Analytics Tools.
---
# Analytics Integration (Umami & DataFast)

This project uses **Umami** for server-side analytics API queries and **DataFast** for client-side event tracking and revenue attribution. This skill documents implementation patterns and best practices for both platforms.

---

## DataFast (Client-Side Event Tracking)

### Overview

**Context7 Library ID**: `/websites/datafa_st`
**Documentation**: https://datafa.st/docs

DataFast tracks user actions, scroll events, and revenue attribution. It's optimized for identifying which marketing channels drive conversions.

### Script Installation

Add to your root layout (`app/layout.tsx`):

```tsx
// Queue script in <head> - ensures events capture before main script loads
<script
  id="datafast-queue"
  dangerouslySetInnerHTML={{
    __html: `
      window.datafast = window.datafast || function() {
        window.datafast.q = window.datafast.q || [];
        window.datafast.q.push(arguments);
      };
    `,
  }}
/>

// Main tracking script at end of <body>
<Script
  strategy="afterInteractive"
  data-website-id="your_website_id"
  data-domain="yourdomain.com"
  src="/js/script.js"
/>
```

**Proxy Required**: Use Next.js rewrites to proxy `/js/script.js` → `datafa.st/js/script.js`. See "DataFast Next.js Proxy Setup" section below.

### Three Tracking Methods

#### Method 1: JavaScript (Recommended for Complex Events)

```typescript
// TypeScript declaration
declare global {
  interface Window {
    datafast?: (goal: string, params?: Record<string, string>) => void;
  }
}

// Simple event
window?.datafast?.("signup");

// Event with parameters
window?.datafast?.("pricing_cta_clicked", {
  location: "pricing_section",
  plan: "pro",
  price: "39",
  discount: "launch_offer",
});
```

#### Method 2: HTML Data Attributes (Simplest)

```html
<!-- Simple -->
<button data-fast-goal="initiate_checkout">Buy Now</button>

<!-- With parameters (kebab-case → snake_case) -->
<button
  data-fast-goal="initiate_checkout"
  data-fast-goal-product-id="prod_123"
  data-fast-goal-price="49">
    Buy Now
</button>
```

#### Method 3: Server-Side API (Most Reliable)

Best for critical conversions. Requires API key from Website Settings → API tab.

### Goal Naming Rules

- **Goal names**: lowercase, numbers, underscores `_`, hyphens `-`, max 64 characters
- **Parameter names**: same rules, max 64 characters
- **Parameter values**: any string, max 255 characters
- **Max parameters**: 10 per event

### Scroll Tracking Pattern

Use Intersection Observer for section visibility tracking. The hook supports an optional callback for triggering actions (like iframe preloading) when user scrolls past the hero section.

```typescript
// lib/hooks/use-datafast-scroll-tracking.tsx
"use client";

import { useEffect, useRef } from "react";

interface ScrollTrackingSection {
  id: string;
  goalName: string;
}

const SECTIONS: ScrollTrackingSection[] = [
  { id: "hero", goalName: "section_hero_viewed" },
  { id: "features", goalName: "section_features_viewed" },
  { id: "pricing", goalName: "section_pricing_viewed" },
];

interface UseDataFastScrollTrackingOptions {
  onScrollPastHero?: () => void; // Callback when user scrolls past hero
}

export function useDataFastScrollTracking(options?: UseDataFastScrollTrackingOptions) {
  const trackedSections = useRef<Set<string>>(new Set());
  const hasTriggeredScrollPastHero = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.3) {
            const section = SECTIONS.find((s) => s.id === entry.target.id);

            if (section && !trackedSections.current.has(section.id)) {
              trackedSections.current.add(section.id);

              window?.datafast?.(section.goalName, {
                section_id: section.id,
                timestamp: new Date().toISOString(),
                scroll_depth: Math.round(
                  (window.scrollY / document.documentElement.scrollHeight) * 100
                ).toString(),
              });

              // Trigger callback when user scrolls past hero (reaches any other section)
              if (
                section.id !== "hero" &&
                !hasTriggeredScrollPastHero.current &&
                options?.onScrollPastHero
              ) {
                hasTriggeredScrollPastHero.current = true;
                options.onScrollPastHero();
              }
            }
          }
        });
      },
      { threshold: 0.3 }
    );

    SECTIONS.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, []);
}
```

### Using Scroll Tracking for Iframe Preloading

The `onScrollPastHero` callback is ideal for preloading heavy iframes (like checkout modals) before the user reaches CTAs:

```tsx
// components/datafast-tracker.tsx
"use client";

import { useDataFastScrollTracking } from "~/lib/hooks/use-datafast-scroll-tracking";
import { usePolarCheckout } from "~/providers/polar-checkout";

export function DataFastTracker() {
  const { preloadCheckout } = usePolarCheckout();

  // Preload checkout iframe when user scrolls past hero
  useDataFastScrollTracking({
    onScrollPastHero: preloadCheckout,
  });

  return null;
}
```

**Why This Works**:
- User scrolls from hero → features → checkout preloads in background
- By the time user reaches pricing section, checkout is ready
- No Lighthouse impact (scroll events don't trigger during audits)

### Click Tracking Pattern

Use JavaScript handlers for reliable tracking:

```tsx
"use client";

declare global {
  interface Window {
    datafast?: (goal: string, params?: Record<string, string>) => void;
  }
}

export function CTAButton() {
  const handleClick = () => {
    window?.datafast?.("cta_clicked", {
      location: "header",
      plan: "pro",
    });
  };

  return (
    <button
      onClick={handleClick}
      data-fast-goal="cta_clicked"
      data-fast-goal-location="header"
    >
      Get Started
    </button>
  );
}
```

### Client Component Architecture

- **Landing pages**: Server components for SEO
- **Tracker components**: Client component wrappers for event handling
- **Pattern**: Wrap tracking hooks in dedicated client components

```tsx
// components/datafast-tracker.tsx
"use client";

import { useDataFastScrollTracking } from "~/lib/hooks/use-datafast-scroll-tracking";

export function DataFastTracker() {
  useDataFastScrollTracking();
  return null;
}

// In server component page
import { DataFastTracker } from "~/components/datafast-tracker";

export default function LandingPage() {
  return (
    <>
      <DataFastTracker />
      {/* page content */}
    </>
  );
}
```

### Billing Considerations

Custom goals count toward monthly usage. Current implementation tracks:
- Navigation events (reusable per session)
- CTA click events (per conversion attempt)
- Section scroll events (once per session)

### Testing & Debugging

```javascript
// In browser console - verify DataFast is loaded
console.log(typeof window.datafast); // "function"
console.log(window.datafast.q); // array if events queued

// Intercept events for debugging
const originalDatafast = window.datafast;
window.datafast = function(...args) {
  console.log('DataFast Event:', { goal: args[0], params: args[1] || {} });
  return originalDatafast?.apply(this, args);
};
```

### Common Issues

**Events not firing:**
1. Check browser console for errors
2. Verify script loaded (check Network tab)
3. Check ad blockers
4. Ensure components are client components
5. Verify `window.datafast` exists before calling

**Build errors with "use client":**
- Separate tracker logic into dedicated client components
- Keep pages as server components for static generation

---

## Umami (Server-Side Analytics API)

### Environment Variables

```env
# Server-side (for API calls)
UMAMI_API_KEY="your-api-key"
UMAMI_WEBSITE_ID="your-website-id"

# Client-side (for tracking script)
NEXT_PUBLIC_UMAMI_WEBSITE_ID="your-website-id"
NEXT_PUBLIC_UMAMI_DOMAINS="yourdomain.com"
NEXT_PUBLIC_UMAMI_URL="/_proxy/umami"
```

Get from Umami dashboard:
- API Key: Settings → API Keys → Create
- Website ID: Settings → Websites → Click website → Copy UUID

**Important**:
- `NEXT_PUBLIC_UMAMI_DOMAINS` prevents tracking on localhost/preview deployments
- `NEXT_PUBLIC_UMAMI_URL` should point to your proxy (e.g., `/_proxy/umami`) for ad-blocker bypass, or directly to Umami (e.g., `https://cloud.umami.is`)

### Service Layer Pattern

```typescript
// services/umami.ts
import wretch from "wretch"
import { env } from "~/env"

// CRITICAL: Pass full path to preserve auth header
// DO NOT use .url() chaining - it loses the Bearer token
export const getUmamiApi = (path: string) => {
  return wretch(`https://api.umami.is/v1${path}`)
    .auth(`Bearer ${env.UMAMI_API_KEY}`)
    .headers({ "Content-Type": "application/json" })
}
```

**Critical Pattern**: Always pass the complete path including query params to `getUmamiApi()`. Using `.url()` after creating the wretch instance will lose the auth header.

### API Usage

```typescript
import { getUmamiApi } from "~/services/umami"

// Correct - path includes all query params
const { data, error } = await tryCatch(
  getUmamiApi(`/websites/${env.UMAMI_WEBSITE_ID}/pageviews?startAt=${startAt}&endAt=${endAt}&unit=day`)
    .get()
    .json<UmamiPageviewsResponse>(),
)

// WRONG - DO NOT DO THIS (loses auth header)
// getUmamiApi().url(`/websites/...`).get()
```

### API Endpoints

#### Get Page Stats
```typescript
type UmamiStatsResponse = {
  pageviews: { value: number; prev: number }
  visitors: { value: number; prev: number }
  visits: { value: number; prev: number }
  bounces: { value: number; prev: number }
  totaltime: { value: number; prev: number }
}

const stats = await getUmamiApi(
  `/websites/${websiteId}/stats?startAt=${startAt}&endAt=${endAt}&url=${encodeURIComponent(page)}`
).get().json<UmamiStatsResponse>()
```

#### Get Pageviews Over Time
```typescript
type UmamiPageviewsResponse = {
  pageviews: { x: string; y: number }[]  // x = date, y = count
  sessions: { x: string; y: number }[]
}

const data = await getUmamiApi(
  `/websites/${websiteId}/pageviews?startAt=${startAt}&endAt=${endAt}&unit=day`
).get().json<UmamiPageviewsResponse>()
```

### Date Range Parameters

- `startAt`: Unix timestamp in milliseconds
- `endAt`: Unix timestamp in milliseconds
- `unit`: `hour`, `day`, `week`, `month`, `year`

```typescript
const days = 30
const endAt = Date.now()
const startAt = endAt - days * 24 * 60 * 60 * 1000
```

### Proxy Configuration (Recommended)

Add to `next.config.ts` to bypass ad-blockers (~15-30% more accurate data):

```typescript
async rewrites() {
  return [
    // Umami proxy (bypasses ad-blockers)
    {
      source: "/_proxy/umami/:path*",
      destination: "https://cloud.umami.is/:path*",
    },
  ]
}
```

Then set `NEXT_PUBLIC_UMAMI_URL="/_proxy/umami"` in your `.env` file.

For self-hosted Umami, change the destination to your analytics server (e.g., `https://analytics.yourdomain.com/:path*`).

### Tracking Script

```tsx
import Script from "next/script"
import { env } from "~/env"

<Script
  defer
  data-website-id={env.NEXT_PUBLIC_UMAMI_WEBSITE_ID}
  data-domains={env.NEXT_PUBLIC_UMAMI_DOMAINS}
  src={`${env.NEXT_PUBLIC_UMAMI_URL}/script.js`}
/>
```

**Key attributes**:
- `data-domains`: Comma-separated list of domains to track (prevents localhost/preview tracking)
- `data-website-id`: Your Umami website UUID
- `src`: Points to proxy for ad-blocker bypass

### Error Handling Pattern

```typescript
const { data, error } = await tryCatch(
  getUmamiApi(`/path`).get().json<ResponseType>(),
)

if (error) {
  console.error("Analytics error:", error)
  return { results: [], totalVisitors: 0, averageVisitors: 0 }
}
```

### Cache Invalidation

```typescript
import { revalidateTag } from "next/cache"

// In server actions
revalidateTag("analytics")
```

### Common Issues

**"No API key specified" Error**
- Cause: Using `.url()` chaining loses auth header
- Fix: Pass complete path to `getUmamiApi(path)` directly

**Data not updating**
- Cause: Aggressive caching
- Fix: Use `revalidateTag()` or shorter cache life

### Free Tier Limits
- 10,000 events/month
- Unlimited websites
- 6 month data retention

For higher limits, consider self-hosting Umami.

---

## When to Use Each Platform

| Use Case | Platform | Reason |
|----------|----------|--------|
| Revenue attribution | DataFast | Native Stripe/Polar/LemonSqueezy integration |
| Custom events (clicks, scrolls) | DataFast | Better predictions with more events |
| Server-side analytics queries | Umami | Robust API with auth |
| Dashboard/admin analytics | Umami | Better for data visualization |
| Marketing channel analysis | DataFast | Core feature |
| Privacy-focused pageviews | Either | Both are privacy-focused |

---

## Implementation Checklist

### DataFast Setup
- [ ] Add queue script to `<head>`
- [ ] Add main tracking script (proxied)
- [ ] Create TypeScript declarations
- [ ] Implement scroll tracking hook
- [ ] Add click handlers to CTAs
- [ ] Test with browser console debugging

### Umami Setup
- [ ] Set environment variables (including DOMAINS and URL)
- [ ] Configure proxy rewrites in next.config.ts
- [ ] Create service layer with auth pattern
- [ ] Implement API calls with error handling
- [ ] Add tracking script with data-domains
- [ ] Set up cache invalidation
- [ ] Test ad-blocker bypass with proxy

---

## Code Locations (ClaudeFast)

```
/apps/web/
├── src/
│   ├── app/
│   │   └── layout.tsx                              # DataFast queue + tracking scripts
│   ├── components/
│   │   ├── common/layout/header/
│   │   │   ├── controls.tsx                        # Header CTA tracking
│   │   │   └── nav/
│   │   │       ├── nav.tsx                         # Desktop nav tracking
│   │   │       └── mobile-nav.tsx                  # Mobile nav tracking
│   │   └── home/
│   │       ├── datafast-tracker.tsx                # Client wrapper for scroll tracking
│   │       ├── changelog-popup.tsx                 # Changelog tracking
│   │       └── pricing/pricing.tsx                 # Pricing CTA tracking
│   ├── lib/
│   │   └── hooks/
│   │       └── use-datafast-scroll-tracking.tsx    # Scroll tracking hook
│   └── services/
│       └── umami.ts                                # Umami API service
```

---

## DataFast Next.js Proxy Setup (Required)

DataFast requires proxy setup to bypass ad-blockers. Use Next.js rewrites (recommended by DataFast docs).

### next.config.js Rewrites

Add to your `next.config.js`:

```javascript
module.exports = {
  async rewrites() {
    return [
      {
        source: "/js/script.js",
        destination: "https://datafa.st/js/script.js",
      },
      {
        source: "/api/events",
        destination: "https://datafa.st/api/events",
      },
    ];
  },
};
```

### Script Tag Implementation

Add to your root layout:

```tsx
import Script from "next/script";

<Script
  strategy="afterInteractive"
  data-website-id="your_website_id"
  data-domain="yourdomain.com"
  src="/js/script.js"
/>
```

**Note**: Next.js automatically handles IP forwarding with rewrites.

### Why Proxy is Required

- Bypasses ad-blockers (~30% more accurate data)
- Keeps analytics running when third-party scripts are blocked
- Official DataFast recommendation: https://datafa.st/docs/nextjs-proxy

### Alternative: Nginx Proxy (for VPS/EasyPanel)

If using Nginx (EasyPanel, VPS), add to your config:

```nginx
location /js/script.js {
    proxy_pass https://datafa.st/js/script.js;
    proxy_set_header Host datafa.st;
    proxy_cache_valid 200 1y;
    add_header Cache-Control "public, max-age=31536000";
}

location /api/events {
    proxy_pass https://datafa.st/api/events;
    proxy_set_header Host datafa.st;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_method POST;
    proxy_pass_request_body on;
}
```

---

## DataFast + Polar Revenue Attribution (CRITICAL)

When using Polar checkout in an iframe, DataFast cannot attribute purchases to visitor sessions by default because the checkout happens on a different domain (`buy.polar.sh`). This section documents the best practice solution.

### The Problem

| What Works | What Doesn't Work |
|------------|-------------------|
| DataFast shows purchase in revenue graph | Customer journey attribution (traffic source, referrer) |
| Purchase amount tracked | Which campaign drove the sale |
| Transaction recorded | Which page the customer came from |

### The Solution: API-Based Checkout with Success URL

Create checkout sessions via Polar API with a `success_url` that redirects back to your domain after payment.

**Architecture**:
```
User clicks CTA
  → /api/checkout creates Polar session with success_url
  → Checkout loads in iframe
  → User pays
  → Polar redirects iframe to /checkout-success?checkout_id=xxx
  → Your domain loads (same cookies as DataFast)
  → DataFast reads checkout_id → Full attribution!
```

### Implementation

**1. API Route** (`/api/checkout`):
```typescript
const response = await fetch("https://api.polar.sh/v1/checkouts/", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    products: [env.POLAR_PRODUCT_ID],
    success_url: `${publicUrl}/checkout-success?checkout_id={CHECKOUT_ID}`,
    allow_discount_codes: true,
  }),
});
```

**2. Success Page** (`/checkout-success`):
- Simple thank-you page that loads in iframe after payment
- DataFast automatically reads `checkout_id` from URL
- No additional code needed - just having the page on your domain is enough

**3. Environment Variables**:
```
POLAR_ACCESS_TOKEN=polar_oat_xxxxx
POLAR_PRODUCT_ID=your-product-uuid
```

### Why This Works

- `{CHECKOUT_ID}` is replaced by Polar with the actual checkout ID
- After payment, iframe redirects to YOUR domain with the checkout_id
- DataFast matches this to the visitor's existing session/cookies
- Full customer journey attribution restored

### Key Points

- Success page MUST be on your domain (not Polar's)
- `checkout_id` in URL is how DataFast matches the purchase
- API approach also provides fresh checkout sessions (no stale URLs)
- See `polar-integration` skill for full implementation code

---

## Best Practices: Analytics-Driven Preloading

Scroll tracking events trigger API-based checkout preloading for instant UX without impacting Lighthouse scores.

### Smart Preloading Triggers

| Trigger | When | Action |
|---------|------|--------|
| **Scroll** | User scrolls past hero section | API creates checkout, iframe preloads |
| **Hover** | User hovers CTA button | API creates checkout (if not already loaded) |

### Implementation

```typescript
// datafast-tracker.tsx
const { preloadCheckout } = usePolarCheckout();

useDataFastScrollTracking({
  onScrollPastHero: preloadCheckout, // Calls Polar API to create checkout
});
```

The `preloadCheckout` function calls the `/api/checkout` endpoint which creates a Polar checkout session with the attribution-enabled `success_url`.

### User Journey

```
1. User lands on page (hero) → No preload yet, clean Lighthouse
2. User scrolls to features → API creates checkout, iframe preloads in background
3. User hovers CTA → Backup preload if scroll didn't trigger
4. User clicks CTA → INSTANT checkout (already loaded)
5. Payment completes → Redirect to success page
6. DataFast captures checkout_id → Full attribution
```

### Key Points

- Each preload trigger calls the Polar API (not just toggling iframe visibility)
- The checkout URL is cached for the entire page session (not cleared on close)
- Multiple modal opens = instant checkout (URL stays cached)
- Fresh URL on page reload (React state resets)
- This combines instant UX with revenue attribution
- Lighthouse scores stay high (no auto-preload on page load)
