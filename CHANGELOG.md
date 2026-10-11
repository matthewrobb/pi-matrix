# Changelog

## 1.0.0

Initial release.

- `/matrix` opens a trace-program boot, types four messages, dissolves them into
  glyphs, then settles into full-screen rain
- per-column head and velocity with a precomputed distance-to-head color ramp,
  so trails fade without per-cell color math
- glyph mutation at the head plus ambient flicker in the tails
- `boot → message → rain` phase machine; the rain is frozen during the intro so
  heads are pre-spread and the screen is full the moment it starts
- `any key` skips the intro, `space` pauses, `↑`/`↓` change speed, `r` reseeds
- smoke test checking every intro and rain frame across terminal widths 1–240
  and heights 6–200