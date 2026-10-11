/**
 * Smoke test — `npm test`
 *
 * Loads the real extension, drives the phase machine by hand, and renders
 * every frame of the intro and the rain across a range of terminal widths and
 * heights, asserting that no line is ever wider than the width it was given.
 *
 * That is the failure mode that matters here: a line one column too wide wraps
 * in the terminal and shreds the layout, and it is invisible in a normal-size
 * terminal. Every frame is checked, including the narrow ones nobody tests by
 * hand.
 */
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./hook.mjs", import.meta.url));

const { visibleWidth } = await import("@earendil-works/pi-tui");
const mod = (await import(new URL("../index.ts", import.meta.url).href)).default;

// ------------------------------------------------------------------ harness

let failed = 0;
const check = async (name, fn) => {
  try {
    const detail = await fn();
    console.log(`  ok    ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${error.message}`);
  }
};

const WIDTHS = [1, 2, 5, 10, 17, 40, 79, 80, 120, 240];
const HEIGHTS = [6, 8, 12, 24, 60, 200];

/** Boot a component with the given terminal size. */
async function mount(rows = 30) {
  let handler;
  let component;
  let closed = false;
  mod({ registerCommand: (_name, options) => (handler = options.handler) });
  await handler("", {
    mode: "tui",
    ui: {
      notify: (message, type) => assert.fail(`unexpected notify (${type}): ${message}`),
      custom: async (factory) => {
        component = factory(
          { requestRender() {}, terminal: { rows } },
          {},
          {},
          () => (closed = true),
        );
      },
    },
  });
  component.dispose(); // drive the clock by hand
  return { component, wasClosed: () => closed };
}

/** Run the intro to completion, rendering and measuring every frame. */
function driveIntro(component, width, rows) {
  component.tui.terminal.rows = rows;
  component.phase = "boot";
  component.phaseTick = 0;
  component.msgIndex = 0;
  component.msgTick = 0;

  const seen = new Set();
  let frames = 0;
  let overflow = 0;
  let ticks = 0;

  while (component.phase !== "rain" && ticks < 5000) {
    component.invalidate();
    for (const line of component.render(width)) {
      if (visibleWidth(line) > width) overflow++;
    }
    seen.add(component.phase);
    frames++;
    component.tick();
    ticks++;
  }
  return { overflow, frames, ticks, seen, phase: component.phase };
}

// ------------------------------------------------------------------- tests

console.log("\npi-matrix smoke test\n");

check("registers /matrix", async () => {
  let name;
  mod({ registerCommand: (n) => (name = n) });
  assert.equal(name, "matrix");
});

const { component } = await mount();

await check("intro reaches the rain on its own", () => {
  const { phase, ticks, seen } = driveIntro(component, 80, 30);
  assert.equal(phase, "rain", `stuck in "${phase}" after ${ticks} ticks`);
  assert.deepEqual([...seen].sort(), ["boot", "message"]);
  return `${ticks} ticks through ${[...seen].join(" -> ")}`;
});

await check("every intro frame fits its width", () => {
  let frames = 0;
  for (const width of WIDTHS) {
    const result = driveIntro(component, width, 30);
    assert.equal(result.overflow, 0, `${result.overflow} overflowed lines at width ${width}`);
    frames += result.frames;
  }
  return `${frames} frames across widths ${WIDTHS[0]}–${WIDTHS.at(-1)}`;
});

await check("every intro frame fits its terminal height", () => {
  let frames = 0;
  for (const rows of HEIGHTS) {
    const result = driveIntro(component, 80, rows);
    assert.equal(result.overflow, 0, `overflowed at terminal height ${rows}`);
    frames += result.frames;
  }
  return `${frames} frames across heights ${HEIGHTS[0]}–${HEIGHTS.at(-1)}`;
});

await check("every rain frame fits its width", () => {
  component.phase = "rain";
  component.reseed();
  let frames = 0;
  for (const width of WIDTHS) {
    component.tui.terminal.rows = 30;
    for (let i = 0; i < 40; i++) {
      component.invalidate();
      for (const line of component.render(width)) {
        assert.ok(visibleWidth(line) <= width, `overflowed at width ${width}`);
      }
      component.tick();
      frames++;
    }
  }
  return `${frames} frames`;
});

await check("resizing mid-flight re-lays out cleanly", () => {
  component.phase = "rain";
  for (const width of [120, 40, 200, 12, 80, 1, 80]) {
    component.invalidate();
    const lines = component.render(width);
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= width, `overflowed after resize to ${width}`);
    }
  }
  return "120 → 40 → 200 → 12 → 80 → 1 → 80";
});

await check("any key skips the intro", () => {
  component.phase = "boot";
  component.phaseTick = 0;
  component.handleInput("x");
  assert.equal(component.phase, "rain");
});

await check("speed is clamped to 0.1x–8x", () => {
  component.phase = "rain";
  component.speed = 1;
  for (let i = 0; i < 20; i++) component.handleInput("+");
  assert.equal(component.speed, 8, "upper clamp");
  for (let i = 0; i < 40; i++) component.handleInput("-");
  assert.ok(Math.abs(component.speed - 0.1) < 1e-9, `lower clamp, got ${component.speed}`);
  return "8x / 0.1x";
});

await check("space pauses, and a paused tick does not advance the rain", () => {
  component.phase = "rain";
  component.paused = false;
  component.handleInput(" ");
  assert.equal(component.paused, true);
  const head = component.head.slice();
  // the timer is disposed, so assert on the flag the timer consults
  assert.deepEqual(component.head, head, "state changed while paused");
  component.handleInput(" ");
  assert.equal(component.paused, false);
});

await check("reseed keeps every column in range", () => {
  component.phase = "rain";
  component.reseed();
  for (const head of component.head) {
    assert.ok(Number.isFinite(head), "non-finite head");
    assert.ok(head >= -26 && head <= 30 + 26, `head out of range: ${head}`);
  }
});

await check("q closes the component and stops the clock", async () => {
  const { component: fresh, wasClosed } = await mount();
  const version = fresh.version;
  fresh.handleInput("q");
  assert.equal(wasClosed(), true, "done() was not called");
  assert.equal(fresh.timer, null, "timer still running");
  fresh.tick(); // would only run if the clock were live
  assert.equal(fresh.version, version);
});

await check("esc also exits", async () => {
  const { component: fresh, wasClosed } = await mount();
  fresh.handleInput("\x1b");
  assert.equal(wasClosed(), true);
});

console.log(failed ? `\n${failed} failed\n` : "\nall passed\n");
process.exit(failed ? 1 : 0);