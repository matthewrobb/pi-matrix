/**
 * Resolve hook for the smoke test.
 *
 * `index.ts` imports `@earendil-works/pi-tui`, which pi provides at runtime but
 * is not a dependency of this package (declaring it would ship a second copy
 * and risk duplicate module instances). So the test maps that one specifier to
 * whichever copy already exists on this machine.
 */
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const HOST = "@earendil-works/pi-tui";

function candidates() {
  const found = [];
  if (process.env.PI_TUI_PATH) found.push(process.env.PI_TUI_PATH);
  found.push(join(process.cwd(), "node_modules", HOST));

  const releases = join(homedir(), ".pi", "agent", "install", "releases");
  if (existsSync(releases)) {
    // newest release first
    for (const version of readdirSync(releases).sort().reverse()) {
      found.push(join(releases, version, "node_modules", HOST));
    }
  }
  return found;
}

const root = candidates().find((dir) => existsSync(join(dir, "package.json")));

export async function resolve(specifier, context, next) {
  if (specifier !== HOST) return next(specifier, context);
  if (!root) {
    throw new Error(
      `cannot locate ${HOST}. Install pi, or point PI_TUI_PATH at the package directory.`,
    );
  }
  const require = createRequire(join(root, "noop.js"));
  return { url: pathToFileURL(require.resolve(HOST)).href, shortCircuit: true };
}