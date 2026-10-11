# pi-matrix

Matrix digital rain for the [pi](https://pi.dev) coding agent.

Opens with a trace-program boot, types the four messages, dissolves them into
glyphs, then settles into full-screen rain — all inside your terminal, in
truecolor phosphor green.

```
  trace program: running
    scanning carrier ................ ok
    decrypting stream ............... ok
    locating identity ............... 1 match

  identity: THOMAS A. ANDERSON
  status:   RESIDENT, MEGACITY
  anomaly:  RESIDUAL SELF IMAGE
```

→ `Wake up, Neo...` → `The Matrix has you...` → `Follow the white rabbit.` →
`Knock, knock, Neo.` → rain.

## Install

```bash
pi install git:github.com/<you>/pi-matrix
```

Or from a local checkout:

```bash
pi install ./pi-matrix
```

Or try it for a single run without touching your settings:

```bash
pi -e ./pi-matrix
```

Then run `/matrix` in pi.

## Controls

| Key | Action |
| --- | --- |
| `any key` | skip the intro |
| `space` | pause / resume the rain |
| `↑` / `↓` or `+` / `-` | speed, 0.1× – 8× |
| `r` | reseed the columns |
| `q` / `esc` | exit |

## Tuning

All near the top of `index.ts`:

| Constant | Default | Effect |
| --- | --- | --- |
| `TICK_MS` | `55` | frame interval (~18 fps) |
| `TRAIL` | `26` | trail length, in rows |
| `BOOT_LINE_TICKS` | `2` | ticks per boot line |
| `BOOT_HOLD` | `8` | pause after the boot finishes |
| `MSG_HOLD` | `6` | pause after a message finishes typing |
| `MSG_DISSOLVE` | `10` | dissolve duration per message |
| `BOOT` | — | boot lines, printed one per row |
| `MESSAGES` | — | the typed messages |

To jump straight to the rain, set the initial `phase` to `"rain"` in the
`MatrixRain` constructor, or just press any key.

## How it works

- Each column has a float head position and its own velocity. A row's color
  comes from a precomputed 26-step distance-to-head ramp, so trails fade
  without any alpha blending or per-cell color math at render time.
- Glyphs mutate at the head as it falls, plus ambient flicker in the tails.
  ~14% of columns get a hot near-white head.
- The intro is a `boot → message → rain` phase machine on the same tick. The
  rain doesn't advance during the intro, so heads are pre-spread and the
  screen is already full the moment it starts.
- Every line is prefixed with a black background, so the effect looks right
  even on a light theme.
- Styles are coalesced into runs per row rather than one escape per character.
- Height is derived from `tui.terminal.rows - 6`, because pi hosts custom
  components in the editor container; room is left for the header, footer and
  a sliver of transcript.

## Requirements

- pi in interactive (TUI) mode. `/matrix` reports an error in non-interactive
  modes rather than failing silently.
- A terminal with truecolor support for the intended look. Output degrades to
  whatever your terminal does with 24-bit SGR sequences.

## License

Not yet chosen.