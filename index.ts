/**
 * Matrix digital rain — `/matrix`
 *
 * Opens with a trace-program boot, types the four messages, dissolves them,
 * then settles into the rain.
 *
 *   any key          skip the intro
 *   space            pause / resume the rain
 *   ↑ / ↓  or + / -  speed
 *   r                reseed the columns
 *   q / esc          exit
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const KATA = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ";
const POOL = [...(KATA + KATA + "ABCDEFGHIJKLMNOPQRSTUVWXYZ" + "0123456789")];
const pick = (): string => POOL[(Math.random() * POOL.length) | 0];

const TICK_MS = 55;
const TRAIL = 26;

const RESET = "\x1b[0m";
const BG = "\x1b[48;2;0;0;0m"; // paint the screen black, whatever the theme is
const DIM = "\x1b[38;2;0;120;52m";
const FG = "\x1b[38;2;0;220;96m";
const BRIGHT = "\x1b[1;38;2;205;255;222m";

const BOOT_LINE_TICKS = 2;
const BOOT_HOLD = 8;
const MSG_HOLD = 6;
const MSG_DISSOLVE = 10;

const BOOT = [
  "trace program: running",
  "  scanning carrier ................ ok",
  "  decrypting stream ............... ok",
  "  locating identity ............... 1 match",
  "",
  "identity: THOMAS A. ANDERSON",
  "status:   RESIDENT, MEGACITY",
  "anomaly:  RESIDUAL SELF IMAGE",
];

const MESSAGES = [
  "Wake up, Neo...",
  "The Matrix has you...",
  "Follow the white rabbit.",
  "Knock, knock, Neo.",
];

/** distance-behind-head -> ANSI style, precomputed once. */
const RAMP: string[] = (() => {
  const head = [
    "\x1b[1;38;2;228;255;242m", // 0  head, near-white
    "\x1b[38;2;160;255;200m",
    "\x1b[38;2;60;255;140m",
    "\x1b[38;2;0;230;100m",
    "\x1b[38;2;0;196;82m",
    "\x1b[38;2;0;166;70m",
    "\x1b[38;2;0;138;58m",
    "\x1b[38;2;0;112;47m",
    "\x1b[38;2;0;88;37m",
    "\x1b[38;2;0;66;28m",
    "\x1b[38;2;0;48;20m",
  ];
  const out = [...head];
  for (let d = head.length; d < TRAIL; d++) {
    const t = (d - head.length + 1) / (TRAIL - head.length);
    const g = Math.max(0, Math.round(34 * (1 - t)));
    out.push(`\x1b[38;2;0;${g};${Math.round(g * 0.45)}m`);
  }
  return out;
})();

type Phase = "boot" | "message" | "rain";

class MatrixRain {
  private timer: ReturnType<typeof setInterval> | null = null;

  private phase: Phase = "boot";
  private phaseTick = 0;
  private msgIndex = 0;
  private msgTick = 0;

  private cols = 0;
  private rows = 0;
  private head: number[] = []; // float row of each column's leading glyph
  private vel: number[] = []; // rows per tick
  private hot: number[] = []; // 1 = extra-bright column
  private glyph: string[] = []; // rows*cols, flat

  private paused = false;
  private speed = 1;
  private version = 0;

  private cached: string[] = [];
  private cachedW = -1;
  private cachedV = -1;

  constructor(
    private tui: { requestRender: () => void; terminal?: { rows: number } },
    private done: () => void,
  ) {
    this.timer = setInterval(() => {
      if (!this.paused) {
        this.tick();
        this.version++;
      }
      this.tui.requestRender();
    }, TICK_MS);
  }

  // ---------------------------------------------------------------- geometry

  private ensure(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.glyph = new Array(cols * rows);
    for (let i = 0; i < this.glyph.length; i++) this.glyph[i] = pick();
    this.head = new Array(cols);
    this.vel = new Array(cols);
    this.hot = new Array(cols);
    for (let c = 0; c < cols; c++) this.seed(c, true);
    this.cachedW = -1;
  }

  private seed(c: number, initial: boolean): void {
    // on open, spread heads from above the top to the bottom so the screen
    // is already full of rain instead of filling in from an empty top edge
    this.head[c] = initial
      ? Math.random() * (this.rows + TRAIL) - TRAIL
      : -Math.random() * this.rows * 0.6;
    this.vel[c] = 0.25 + Math.random() * 1.15;
    this.hot[c] = Math.random() < 0.14 ? 1 : 0;
  }

  private reseed(): void {
    for (let c = 0; c < this.cols; c++) this.seed(c, true);
  }

  private cursorOn(): boolean {
    return Math.floor(this.phaseTick / 3) % 2 === 0;
  }

  // ------------------------------------------------------------------- ticks

  private tick(): void {
    this.phaseTick++;
    if (this.phase === "boot") {
      if (this.phaseTick >= (BOOT.length + 1) * BOOT_LINE_TICKS + BOOT_HOLD) {
        this.phase = "message";
        this.phaseTick = 0;
        this.msgIndex = 0;
        this.msgTick = 0;
      }
      return;
    }
    if (this.phase === "message") {
      this.msgTick++;
      const msg = MESSAGES[this.msgIndex];
      if (this.msgTick >= msg.length + MSG_HOLD + MSG_DISSOLVE) {
        if (this.msgIndex + 1 < MESSAGES.length) {
          this.msgIndex++;
          this.msgTick = 0;
        } else {
          this.phase = "rain";
          this.phaseTick = 0;
          this.reseed();
        }
      }
      return;
    }
    this.tickRain();
  }

  private tickRain(): void {
    const { cols, rows } = this;
    if (!cols) return;

    for (let c = 0; c < cols; c++) {
      this.head[c] += this.vel[c] * this.speed;
      const hr = Math.floor(this.head[c]);
      // the head flips its glyph as it falls
      if (hr >= 0 && hr < rows && Math.random() < 0.55) {
        this.glyph[hr * cols + c] = pick();
      }
      if (hr - TRAIL > rows) this.seed(c, false);
    }

    // ambient flicker in the tail
    const muts = Math.max(1, Math.floor(cols * rows * 0.012));
    for (let i = 0; i < muts; i++) {
      const c = (Math.random() * cols) | 0;
      const r = Math.floor(this.head[c]) - ((Math.random() * 6) | 0);
      if (r >= 0 && r < rows) this.glyph[r * cols + c] = pick();
    }
  }

  // ----------------------------------------------------------------- renders

  render(width: number): string[] {
    // The component is hosted in the editor container, so leave room for the
    // header, footer and a sliver of transcript.
    const termRows = this.tui.terminal?.rows ?? process.stdout.rows ?? 40;
    const rows = Math.max(6, Math.min(termRows - 6, 50));
    const cols = Math.max(1, width);
    this.ensure(cols, rows);

    if (width === this.cachedW && this.version === this.cachedV) return this.cached;

    const lines =
      this.phase === "rain"
        ? this.renderRain(width, cols, rows)
        : this.renderIntro(width, rows);

    this.cached = lines;
    this.cachedW = width;
    this.cachedV = this.version;
    return lines;
  }

  private pad(line: string, width: number): string {
    return line + " ".repeat(Math.max(0, width - visibleWidth(line))) + RESET;
  }

  private renderRain(width: number, cols: number, rows: number): string[] {
    const lines: string[] = [];
    for (let r = 0; r < rows; r++) {
      let line = BG;
      let cur = "";
      for (let c = 0; c < cols; c++) {
        const d = Math.floor(this.head[c]) - r;
        let st = "";
        let ch = " ";
        if (d >= 0 && d < TRAIL) {
          st = RAMP[d];
          ch = this.glyph[r * cols + c] ?? " ";
          // hot columns keep a pure-white head; others share the top of the ramp
          if (d === 0 && !this.hot[c]) st = RAMP[1];
        }
        if (st !== cur) {
          line += RESET + BG + st;
          cur = st;
        }
        line += ch;
      }
      lines.push(line + RESET);
    }

    const state = this.paused ? "paused" : `${this.speed.toFixed(2)}x`;
    lines.push(
      truncateToWidth(
        `${BG}${DIM}  WAKE UP  \x1b[2m ${state} · space pause · ↑↓ speed · r reseed · q exit${RESET}`,
        width,
      ),
    );
    return lines;
  }

  private renderIntro(width: number, rows: number): string[] {
    const out: string[] = [];
    const hint = "any key to skip";

    // the bottom row is always the skip hint during the intro
    for (let r = 0; r < rows - 1; r++) {
      let line = BG;

      if (this.phase === "boot") {
        const shown = Math.floor(this.phaseTick / BOOT_LINE_TICKS);
        const i = r - 1; // one blank line at the top
        if (i >= 0 && i < shown && i < BOOT.length) {
          line += truncateToWidth((i >= 5 ? FG : DIM) + "  " + BOOT[i], width);
        } else if (i === shown && shown <= BOOT.length && this.cursorOn()) {
          line += truncateToWidth(FG + "  █", width);
        }
      } else {
        const msg = MESSAGES[this.msgIndex];
        const typed = Math.min(msg.length, this.msgTick);
        const dissolveStart = msg.length + MSG_HOLD;
        const dp =
          this.msgTick > dissolveStart
            ? Math.min(1, (this.msgTick - dissolveStart) / MSG_DISSOLVE)
            : 0;

        if (r === Math.max(1, Math.floor(rows * 0.4))) {
          let text = "";
          for (let i = 0; i < typed; i++) {
            const p = i / msg.length;
            if (dp > 0 && p < dp) continue; // eaten by the dissolve
            if (dp > 0 && p < dp + 0.22) {
              text += pick(); // shimmer band
              continue;
            }
            text += msg[i];
          }
          const caret = this.msgTick < msg.length && this.cursorOn() ? "█" : "";
          const left = Math.max(2, Math.floor((width - msg.length) / 2));
          line += truncateToWidth(BRIGHT + " ".repeat(left) + text + caret, width);
        }
      }

      out.push(this.pad(line, width));
    }

    const left = Math.max(0, width - visibleWidth(hint) - 2);
    out.push(truncateToWidth(BG + DIM + " ".repeat(left) + hint, width) + RESET);
    return out;
  }

  // ------------------------------------------------------------------- input

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q" || data === "Q") {
      this.dispose();
      this.done();
      return;
    }

    // during the intro, any other key drops straight into the rain
    if (this.phase !== "rain") {
      this.phase = "rain";
      this.phaseTick = 0;
      this.reseed();
      this.version++;
      this.tui.requestRender();
      return;
    }

    if (data === " ") {
      this.paused = !this.paused;
    } else if (matchesKey(data, "up") || data === "+" || data === "=") {
      this.speed = Math.min(8, this.speed * 1.5);
    } else if (matchesKey(data, "down") || data === "-" || data === "_") {
      this.speed = Math.max(0.1, this.speed / 1.5);
    } else if (data === "r" || data === "R") {
      this.reseed();
    }
    this.version++;
    this.tui.requestRender();
  }

  invalidate(): void {
    this.cachedW = -1;
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("matrix", {
    description: "Digital rain in your terminal",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("Matrix needs interactive mode", "error");
        return;
      }
      await ctx.ui.custom((tui, _theme, _kb, done) => {
        return new MatrixRain(tui, () => done(undefined));
      });
    },
  });
}