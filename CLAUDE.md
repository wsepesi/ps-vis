# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pokémon Showdown Replay Summarizer - A Next.js web application that takes Pokémon Showdown replay URLs and generates compact, sprite-based turn summaries formatted for easy copying into Google Docs. The app fetches replay JSON data, parses battle logs, and renders both HTML and plain text summaries with Pokémon sprites.

## Development Commands

```bash
# Start development server with Turbopack
npm run dev

# Build for production with Turbopack
npm run build

# Start production server
npm start

# Run ESLint
npm run lint
```

## Architecture

### Core Flow
1. User submits replay URL via form (`src/app/page.tsx`)
2. Client POSTs to `/api/summary` endpoint (`src/app/api/summary/route.ts`)
3. API fetches replay JSON from Pokémon Showdown (appends `.json` to URL)
4. Parser processes battle log and generates summary (`src/lib/parser.ts`)
5. Client displays HTML preview and plain text, with clipboard copy functionality

### Key Files

**`src/lib/parser.ts`** (760 lines) - Core parsing logic
- `summarizeReplay(url)`: Main entry point that fetches and parses replay
- `parseReplayData(data)`: Converts replay JSON to summary
- `parseLog(ctx, log)`: Stateful parser that processes battle log line-by-line
- Tracks Pokémon state (HP, status, species, nicknames) throughout battle
- Builds turn-by-turn action summaries with icons and details
- Handles switch, move, status, damage, ability, item, field, and weather events
- Detects winners, losers, and forfeit conditions

**`src/lib/utils.ts`** - Helper utilities
- `toId()`: Normalizes text to lowercase alphanumeric IDs
- `parseHPStatus()` / `formatHPStatus()`: Parse and display HP/status strings
- `prettifyMove()`: Capitalizes move names
- `simplifyBracketText()`: Cleans up bracketed metadata from battle log

**`src/app/api/summary/route.ts`** - API endpoint
- POST handler validates URL and calls `summarizeReplay()`
- Returns `{ html, text, meta }` or error response

**`src/app/page.tsx`** - Client UI
- React form for URL input
- Fetches summary from API
- Displays result metadata (players, format, winner/loser)
- Copy button writes both HTML and plain text to clipboard using ClipboardItem
- HTML preview uses `dangerouslySetInnerHTML`

### State Management

The parser uses a `ParseContext` object that tracks:
- Players (p1/p2 names)
- Current turn and all turns
- Pokémon map (ref → species, HP, status, nickname, icon ID)
- Team composition for both sides
- Winner/loser/result note
- Current action being processed

### Rendering

- **Icons**: Fetched from `https://play.pokemonshowdown.com/sprites/gen5/{iconId}.png`
- **Turn format**: `T{n}` for regular turns, `Lead` for turn 0
- **Actions**: Actor icon + verb + target icons, followed by details (HP changes, status, effects)
- **HTML output**: Inline styles, sprite images, structured divs
- **Text output**: Parallel plain text version for clipboard

## TypeScript Configuration

- Uses path alias `@/*` → `./src/*`
- Strict mode enabled
- Target: ES2017
- Module resolution: bundler

## Framework: Next.js 15.5.4

- App Router (not Pages Router)
- React 19.1.0
- Turbopack enabled for dev and build
- Tailwind CSS v4 with PostCSS

## Testing

No test framework currently configured. No test files in `src/`.
- use the test-replay script to confirm your changes: `npx tsx test-replay.ts <replay-url>`