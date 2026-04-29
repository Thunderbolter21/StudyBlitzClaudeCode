// config.js — Supabase credentials and app-wide constants

export const SUPA_URL  = import.meta.env.VITE_SUPABASE_URL;
export const SUPA_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const KEYS = {
  memory:  'sb_memory_v1',
  decks:   'sb_decks_v1',
  classes: 'sb_classes_v1',
  highscores: 'sb_highscores_v1',
  recentDeck: 'sb_recent_deck',
  pendingDeck: 'sb_pending_deck',
  apiKey: 'sb_apikey_v1',
};

export const DECK_COLORS = ['#ff3f6c','#ffc94a','#00e5a0','#38b2ff','#b57bee','#ff8c42','#06d6a0','#ef476f'];
