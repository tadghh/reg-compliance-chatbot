# Frontend UI Architecture

This document lists the UI elements currently implemented in this project.

## Application Entry

- `frontend/src/main.tsx`
  - Mounts the React app into `#root`
  - Loads global styles from `frontend/src/index.css`
  - Renders `App` as the top-level UI screen

## Top-Level Screen

- `frontend/src/App.tsx`
  - Single-page chat interface for the Regulatory Compliance Chatbot
  - Uses a two-column layout:
    - Main chat area
    - Demo questions side panel

## Page Sections (App Layout)

- **Decorative background layers**
  - Two blurred circular gradient accents behind content
- **Header section**
  - Title: "Regulatory Compliance Chatbot"
  - Subtitle/description text
- **Main content grid**
  - Left: chat workspace card
  - Right: demo questions card

## Chat Workspace UI Elements

- **Chat card container**
  - `Card`, `CardHeader`, `CardContent`
- **Header controls**
  - `New conversation` button (with plus icon)
  - Conversation tab list
- **Conversation tabs**
  - Tab button (switch active conversation)
  - Delete tab button (cross icon)
  - Active/inactive visual states
- **Jurisdiction selector**
  - Label + select dropdown
  - Options:
    - Federal
    - Manitoba (Province)
- **Message history panel**
  - Empty-state prompt when there are no messages
  - User message bubbles
  - Assistant message bubbles
  - Loading indicator row ("Generating response...")
- **Message metadata**
  - Sender badge (`You` or `Assistant`)
  - Jurisdiction badge when available
- **Assistant response rendering**
  - Markdown-to-HTML rendering via `react-markdown`
  - GFM support via `remark-gfm`
  - Styled markdown blocks:
    - Paragraphs
    - Ordered/unordered lists
    - Links
    - Inline code and preformatted code blocks
    - Tables (`table`, `th`, `td`)
- **Sources section (assistant only)**
  - Section divider
  - "Sources" label
  - Empty state ("No sources provided.")
  - Numbered source links with external-link icon
- **Composer area**
  - Message label
  - Multiline textarea input
  - Send button (with send icon)

## Demo Questions Panel UI Elements

- **Demo questions card**
  - Title: "Demo Questions"
  - Description text
- **Question items list**
  - Each item displays one prompt
  - `Use` button to copy prompt into active composer
  - `Copy` button to copy prompt to clipboard
  - Transient `Copied` label state per item

## Shared UI Component Library

Located in `frontend/src/components/ui/`:

- `button.tsx`
  - Variants: `default`, `outline`, `secondary`, `ghost`
  - Sizes: `default`, `sm`, `lg`, `icon`
- `card.tsx`
  - `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`
- `badge.tsx`
  - Variants: `default`, `secondary`, `outline`
- `label.tsx`
  - Accessible form labels (Radix label primitive)
- `select.tsx`
  - Styled native `<select>` with chevron icon
- `separator.tsx`
  - Horizontal/vertical divider line
- `textarea.tsx`
  - Styled multiline text input
- `input.tsx`
  - Styled single-line text input component (currently not used in `App.tsx`)

## Icons Used

From `lucide-react` in the current UI:

- `Plus` (new conversation)
- `X` (delete conversation tab)
- `Send` (send message)
- `Loader2` (loading state spinner)
- `Copy` (copy demo prompt)
- `ExternalLink` (source links)

## Styling System

- Global design tokens and theme variables in `frontend/src/index.css`
  - Colors: background, foreground, primary, secondary, muted, accent, border, ring
  - Radius token
  - Body-level gradient background
- Utility-first styling with Tailwind classes across all components
