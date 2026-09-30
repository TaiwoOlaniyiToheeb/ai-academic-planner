# 🤖 AI Academic Planner

Turns a student's **available time + academic needs** into a realistic study
timetable — then validates it before showing it.

Pure static site. No build step, no dependencies.

## The 10-step model

| # | Step | Where |
|---|------|-------|
| 1 | Collect availability | Step 2 — Availability |
| 2 | Collect preferences | Step 3 — Preferences |
| 3 | Retrieve academic data | Step 1 — Academics |
| 4 | Calculate topic priorities | `scoreTopic()` in `src/app.js` |
| 5 | Generate plan | `generatePlan()` |
| 6 | Validate with scheduling rules | `validatePlan()` + repair loop |
| 7 | Show timetable (accept / modify / regenerate) | Step 4 — Study Plan |
| 8 | Connect sessions to learning content | `[data-open]` click handler |
| 9 | Track results | *not yet implemented* |
| 10 | Adapt automatically | *not yet implemented* |

This repo covers **MVP steps 1–7**.

## Run locally

```bash
git clone https://github.com/<you>/ai-academic-planner.git
cd ai-academic-planner
npm run dev          # http://localhost:5173