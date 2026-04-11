# StudyBlitz

Adaptive exam engine with SM-2 spaced repetition. Vite + vanilla JS ESM.

## Getting started

```bash
npm install
npm run dev          # local dev at http://localhost:5173
npm run build        # production build → dist/
npm run preview      # serve dist/ locally
npm test             # run Vitest unit tests
```

## Deploy to Netlify

- Build command: `npm run build`
- Publish directory: `dist`

## Project structure

```
src/
  engine/       core logic — memory (SM-2), quiz state, decks, classes, storage
  components/   reusable UI pieces — DeckCard, Modals, Navigation
  pages/        per-route render functions — Dashboard, Classes, etc.
  styles/       CSS split by concern — main, quiz, exam, classes
  assets/       logo.png (extracted from the original single-file HTML)
  config.js     Supabase URL + anon key
  main.js       boot sequence, event wiring, toast, refreshAll
index.html      shell markup only — pages, modals, overlays
tests/          Vitest suites (memory engine coverage)
```

Original single-file version preserved at `C:\Users\matth\OneDrive\StudyBlitz\StudyBlitz April.html`.
