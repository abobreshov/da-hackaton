# Design System Spec — The Kinetic Playground

**Status:** Active. Binding for all frontend work.
**Scope:** `app/src/frontend/` (React 19 + Tailwind). Shared UI primitives in `app/src/frontend/src/components/ui/`.

## 1. Overview & Creative North Star

**Creative North Star: The Kinetic Playground**

Departure from the sterile, rigid structures of traditional enterprise software. Aim: capture the fluid energy of a live conversation — bouncy, layered, deeply expressive.

Move away from "grid-of-boxes" thinking. Use intentional asymmetry, overlapping elements, and high-contrast typography scales. The layout should feel in motion — soft geometry that makes the space feel like a lounge, not a dashboard. Prioritize community and connection over system status and administrative clarity.

## 2. Colors & Surface Logic

Palette: vibrant purples + optimistic oranges, grounded by soft tinted neutrals.

### The "No-Line" Rule

**Static 1 px solid borders are strictly prohibited for sectioning.** Boundaries come from background colour shifts or subtle tonal transitions only. A `surface_container_low` section on a `surface` background provides all the definition needed. Keeps the UI breathable and modern.

### Surface Hierarchy & Nesting

Treat the UI as stacked sheets of frosted glass. Use `surface_container` tiers for depth:

- **Base layer:** `surface` (#fdf3ff)
- **Secondary areas:** `surface_container_low` (#f9ecff)
- **Interactive elements / cards:** `surface_container` (#f3e2ff) or `surface_container_highest` (#ecd4ff)

### The "Glass & Gradient" Rule

Inject soul via gradients + glassmorphism:

- **Signature gradients:** Primary CTAs and hero moments transition from `primary` (#6a37d4) to `primary_container` (#ae8dff).
- **Glassmorphism:** Floating overlays (nav bars, modals) use `surface_container_lowest` (#ffffff) at 70–80% opacity + 20 px backdrop blur. Lets brand colour bleed through, softens container edges.

## 3. Typography — Editorial Expression

Two typefaces — personality + readability.

- **Display & Headlines (Plus Jakarta Sans):** The "voice". Use `display-lg` and `headline-lg` with generous tracking for an editorial, premium feel. Geometric clarity reads optimistic and bold.
- **Body & Titles (Be Vietnam Pro):** The "ears". Built for high-volume reading in a social chat. Approachable, friendly, legible even at `body-sm`.

**Hierarchy Strategy:** extreme scale contrast. Pair a massive `display-md` headline with `body-md` text to anchor a view. Moves the app from utility to curated experience.

## 4. Elevation & Depth — Tonal Layering

Depth = relationship between colours, not a drop shadow.

- **Layering Principle:** Lift comes from stacking tiers. A `surface_container_lowest` card on a `surface_dim` background gives natural soft lift without heavy shadows.
- **Ambient Shadows:** When an element must float (FAB, detached menu), use extra-diffused shadows.
  - **Colour:** tinted with `on_surface` (#39264c) at 4–8% opacity.
  - **Blur:** large — 30 px to 60 px — to mimic natural ambient light.
- **Ghost Border Fallback:** If a11y demands a border, use `outline_variant` at 20% opacity. Never 100% opaque high-contrast lines.

## 5. Components & Interaction Patterns

### Buttons

- **Primary:** full rounded (`9999px`). Gradient `primary` → `primary_dim`. High-contrast `on_primary` text.
- **Secondary:** `secondary_container` bg, `on_secondary_container` text. No border.
- **Haptic Feel:** on hover, subtle scale (`1.02x`) rather than a colour swap — reinforces the "Playful" personality.

### Chat Bubbles (signature component)

- **Logic:** `primary` for "Me" bubbles, `surface_container_high` for "Them".
- **Shape:** asymmetric rounding — `xl` (3 rem) on three corners, `sm` (0.5 rem) on the corner nearest the user's avatar. Creates a speech-tail effect without literal triangles.

### Input Fields

- **Styling:** `surface_container_low` as field background.
- **States:** no border by default. On focus, transition to a `primary` ghost border at 20% opacity + soft ambient glow.
- **Typography:** labels use `label-md` in `on_surface_variant`.

### Lists & Feed Cards

- **No-Divider Rule:** divider lines forbidden. Separate list items with `md` (1.5 rem) vertical white space or alternating subtle background shifts (`surface` → `surface_container_low`).
- **Cards:** `lg` (2 rem) corner radius — maintains the friendly brand personality.

### Chips & Tags

- **Style:** pill-shaped (`full` roundedness).
- **Palette:** `tertiary_container` + `on_tertiary_container` for high-energy accents ("New Message", "Trending").

## 6. Do / Don't

### Do

- **Embrace asymmetry:** let avatars overlap card/header edges.
- **Pops of colour:** use `secondary` orange (#964300) for notification badges and "active" states — high-energy focal points.
- **Maximize roundness:** lean into `xl` (3 rem) and `full` tokens to keep the UI soft and safe.

### Don't

- **No 1 px dividers:** they break the fluid energy of the Kinetic Playground.
- **No pure grey:** always use tinted neutrals (e.g. `on_surface_variant`) to honour the vibrant brand promise.
- **No over-shadowing:** if tonal layering works, skip the shadow. Shadows only for temporary floating elements.
- **No rigid-grid alignment:** let some elements breathe and sit slightly off-axis for a human, organic feel.

## 7. Enforcement

- **Tailwind theme** (`app/src/frontend/tailwind.config.ts`) exposes every token above as CSS variables + utility classes (`bg-surface-container-low`, `text-on-surface`, `shadow-ambient`, `rounded-xl`, etc).
- **Components** in `app/src/frontend/src/components/ui/` consume tokens — never raw hex.
- **shadcn/ui pattern is the only UI-primitive source.** Primitives are *copy-pasted* into `src/components/ui/*`, not imported from an npm theme package. Radix primitives (`@radix-ui/react-*`) power behaviour; we own the surface and re-theme to match the tokens above. Do not run `npx shadcn add <comp>` blindly — it overwrites existing retheming. Pull new primitives on demand, then immediately strip default greys + borders and replace with tokens from §2–§5.
- **Variant API** — use `cva` (class-variance-authority) + `clsx` + `tailwind-merge` (already in devDeps). Public shape: `Button(variant: 'primary' | 'secondary' | 'ghost' | 'danger', size: 'sm' | 'md' | 'lg')`, `Input(variant: 'default' | 'error')`. Keep variants declarative and typed.
- **Review rule:** any PR that introduces a 1 px solid border for sectioning, an `<hr>`, a raw hex colour, a pure-grey shadow, a rigid grid alignment, or an npm-sourced themed component must be rejected.
- **Related spec:** `mng/specs/10-ui-shell.md` — feature-level UI requirements. This spec defines the *language*; `10-ui-shell.md` defines the *pages*.
