# Design System Spec — The Editorial Archive

**Status:** Active. Binding for all frontend work.
**Scope:** `app/src/frontend/` (React 19 + Tailwind). Shared UI primitives in `app/src/frontend/src/components/ui/`.

## 1. Overview & Creative North Star

**Creative North Star: The Precision Monolith**

This design system rejects the chaotic, "bubbly" aesthetics of consumer social media in favor of a sophisticated, high-density editorial environment. It is designed for the professional who manages vast streams of information. By utilizing intentional asymmetry, tonal layering, and authoritative typography, we transform a standard chat utility into a high-end digital workstation.

The aesthetic "breaks the template" by removing traditional structural lines. We do not use borders to define space; we use light and depth. The interface should feel like a series of meticulously carved architectural planes — sturdy, trustworthy, and calm, even with 300+ concurrent users.

## 2. Colors & Surface Logic

Palette is rooted in "Trustworthy Blues" and "Architectural Grays", utilizing a sophisticated Material Design token set to define hierarchy through luminance rather than lines.

- **The "No-Line" Rule:** 1 px solid borders are strictly prohibited for sectioning. To separate the three panes, use background shifts:
  - *Left Pane (Navigation):* `surface_container_low` (#eff4fc)
  - *Middle Pane (Chat Flux):* `surface` (#f7f9ff)
  - *Right Pane (Details / Metadata):* `surface_container_high` (#dee9f6)
- **Surface Hierarchy & Nesting:** Depth is achieved by "stacking" tiers. A message being composed should sit in a `surface_container_highest` (#d6e4f3) area to pull the user's focus, while the main message history rests on the base `surface`.
- **The "Glass & Gradient" Rule:** For floating admin modals or "New Message" toasts, use a Glassmorphism effect: `surface_variant` (#d6e4f3) at 70% opacity with a 12 px backdrop blur.
- **Signature Textures:** Main action buttons (e.g. "Start New Chat") use a subtle linear gradient from `primary` (#005db5) to `primary_dim` (#0052a0) at 135°. Adds soul and weight that flat fills lack.

## 3. Typography

Dual-font strategy — editorial authority + functional legibility.

- **Display & Headlines (Manrope):** All `display-`, `headline-`, and `title-` levels. Geometric structure → modern, "tech-premium" feel. Large-scale headers should use `display-sm` to create an asymmetric focal point in the sidebar or header.
- **The Workhorse (Inter):** All `body-` and `label-` scales. Optimized for the high-density requirements of 300+ users so long message histories stay legible.
- **Hierarchy via Scale:** `label-sm` (#6f7c89) for timestamps and read receipts; message body stays at `body-md` (#27343f).

## 4. Elevation & Depth

Depth = function of light, not ink.

- **Layering Principle:** A "card" (e.g. pinned message) uses a `surface_container_lowest` (#ffffff) card on a `surface_container` (#e7eff9) background. The subtle 2-point hex shift creates natural, sophisticated lift without borders.
- **Ambient Shadows:** Modals float with an extra-diffused shadow — `offset-y: 8px, blur: 24px, color: rgba(39, 52, 63, 0.08)`. Shadow takes the `on_surface` color → natural ambient occlusion.
- **Ghost Border Fallback:** High-density list items where tonal shifts aren't enough: `outline_variant` (#a6b3c2) at 15% opacity. Felt, not seen.
- **Glassmorphism:** Message input area uses `surface_container_lowest` at 80% opacity so history bleeds through while scrolling — grounds input in chat context.

## 5. Components

### Navigation Sidebars (Accordion-Style)

- **Active state:** `secondary_container` (#cbe6ff).
- **Interaction:** No chevrons where possible. Use font-weight shifts (`title-sm` → `title-md`) and `primary` left-accent bars (4 px wide, `round-xl`) to indicate focus.

### Message Containers

- **No-Bubble Approach:** Avoid heavy rounded bubbles. Use a gutter-based layout.
  - "Self" messages: subtle `primary_container` (#d6e3ff) background, `sm` (2 px) corner radius.
  - "Others" messages: transparent.
- **Status Indicators:**
  - **Online:** `primary` (#005db5) — brand blue for "active" maintains the professional tone.
  - **AFK:** `tertiary` (#5d5c78) — sophisticated muted purple-gray.
  - **Offline:** `outline` (#6f7c89).

### Input Fields & Toolbars

- **Structure:** `surface_container_highest` for the input container.
- **Focus state:** 2 px "Ghost Border" of `primary` at 40% opacity + subtle `surface_tint` glow. No thick blue border.
- **Attachments:** Small `surface_container_low` chips with `round-md` corners.

### Modal Dialogs (Admin Actions)

- **Backdrop:** `inverse_surface` (#0a0f13) at 40% opacity.
- **Container:** `surface_container_lowest`, `xl` (0.75 rem) rounding. No visible header lines — `headline-sm` with 24 px bottom padding creates a structural break.

## 6. Do / Don't

### Do

- **White space as separator:** 24 px vertical padding between message groups; keep individual messages at 4 px.
- **Leverage tonal transitions:** If a pane feels "stuck" to another, check whether a `surface_container` tier was skipped.
- **Prioritize typography:** In a chat app the text *is* the UI. `on_surface_variant` only for non-essential metadata.

### Don't

- **No 100% black:** Text uses `on_surface` (#27343f) — high-end, softer contrast.
- **No dividers:** No `<hr>`. A shift from `surface` to `surface_container_low` is the divider.
- **No over-rounding:** `DEFAULT` radius stays at `0.25rem`. Rounded corners feel intentional and "engineered", not bubbly or childish.
- **No pure-gray shadows:** Tint shadows with the `on_surface` blue-gray token so the "Trustworthy Blue" DNA continues through depth layers.

## 7. Enforcement

- **Tailwind theme** (`app/src/frontend/tailwind.config.ts`) must expose all tokens above as CSS variables + utility classes (`bg-surface-container-low`, `text-on-surface`, `shadow-ambient`, etc).
- **Components** in `app/src/frontend/src/components/ui/` must consume tokens, never hex literals.
- **Review rule:** Any PR that introduces a 1 px solid border for sectioning, a raw hex colour, or a pure-gray shadow must be rejected.
- **Related spec:** `mng/specs/10-ui-shell.md` (feature-level UI requirements). This spec defines the *language*; `10-ui-shell.md` defines the *pages*.
