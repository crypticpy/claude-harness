---
name: frontend-design
description: Build frontend components, pages, or applications with a distinct visual point of view. Use when the user asks for UI work and either (a) says the design matters, or (b) gives no design constraints. If the user gives specific design constraints (brand colors, existing system), follow those instead of this skill.
---

You are building a working frontend artifact. Ship code, not mood boards.

## Before coding

Make these choices and state them in one or two sentences before writing any markup:

1. **Direction**: pick one — minimal, editorial, brutalist, retro, organic, luxury, or industrial. One, not a blend.
2. **Type pair**: one display face (for headings) and one body face. Do not use Inter, Roboto, Arial, or system-ui as either. Name the fonts you picked.
3. **Palette**: one background, one foreground, one accent. Light or dark. No more than three hues plus neutrals.
4. **Layout posture**: grid, asymmetric, or single-column. Pick one.

If the user gave constraints (existing brand, framework, component library), those override these four choices.

## While coding

- Use CSS variables for color, type scale, and spacing. One source of truth per token.
- Prefer CSS-only motion. Use a JS motion library only if the framework is React and the user has one installed — do not add a dependency for this.
- Use at most one page-load animation and one hover pattern. Do not add micro-interactions on every element.
- Backgrounds: if you add a gradient, noise, or pattern, pick one technique per page. Do not layer three.
- Ship real content. If the user did not provide copy, use short plausible placeholder copy, not lorem ipsum.

## Stop condition

The artifact runs and renders. The four choices above are applied consistently across the component/page. You did not exceed one page-load animation, one hover pattern, one background technique.

Do not add a design rationale document, a color system explainer, or a typography essay unless the user asked for one.
