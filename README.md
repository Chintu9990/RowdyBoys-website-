# ROWDY BOYS — Esports Tournament Platform

Full-stack esports tournament management platform.

## Stack
- Node.js + Express
- SQLite (better-sqlite3) — file DB, zero setup
- Vanilla JS frontend (multi-page)
- Sessions + bcrypt admin auth
- Multer for logo uploads

## Setup

```bash
cp .env.example .env
npm install
npm start
```

Open http://localhost:3000

Default admin (change in .env):
- username: 
- password: 

Admin panel: `/admin`

## Features
- Multi-tournament (solo / duo / squad)
- Dynamic registration form
- Team pages, player pages
- Match management (UPCOMING / LIVE / COMPLETED / CANCELLED / POSTPONED)
- Player-level kill stats
- **Automatic points table** recomputed from match results (never duplicated)
- Configurable scoring (win/draw/loss/kill points + rank order)
- Prize + rules system
- Bracket stage field on matches
- Audit logs
- Search & filters
- Mobile-first dark esports UI
