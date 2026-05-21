#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ORIGINAL_CLI = '/Users/konnsuki/.nvm/versions/node/v20.19.6/lib/node_modules/@playwright/cli/playwright-cli.js';
const DIST_DIR = '/Users/konnsuki/Desktop/Programs/playwright-human-cursor/dist';

const args = process.argv.slice(2);
const command = args[0];

// utility to pass-through arguments to the original playwright-cli
function runOriginal(extraArgs = args) {
  const result = spawnSync('node', [ORIGINAL_CLI, ...extraArgs], {
    stdio: 'inherit'
  });
  return result.status;
}

// utility to resolve ref (e.g. e15) to raw selector/locator expression
function resolveLocator(target) {
  if (!target) return '';
  const result = spawnSync('node', [ORIGINAL_CLI, 'generate-locator', target, '--raw'], {
    encoding: 'utf8'
  });
  const out = result.stdout.trim();
  // If output looks like an error message, return empty to trigger fallback
  if (!out || out.startsWith('###') || out.toLowerCase().startsWith('error')) return '';
  return out;
}

// utility to run code in the browser context via playwright-cli
function runCode(jsCode) {
  const result = spawnSync('node', [ORIGINAL_CLI, 'run-code', jsCode], {
    stdio: 'inherit'
  });
  return result.status;
}

// read esbuild bundle output
function getBundleCode(filename) {
  return fs.readFileSync(path.join(DIST_DIR, filename), 'utf8');
}

// Self-contained human-like mouse movement code (no external deps, no setTimeout)
// Uses only page.mouse.move() and page.waitForTimeout()
const HUMAN_MOUSE_CODE = `
async function humanMove(page, targetX, targetY, opts) {
  opts = opts || {};
  const steps = opts.steps || (30 + Math.floor(Math.random() * 25));
  const minDelay = opts.minDelay || 8;
  const maxDelay = opts.maxDelay || 22;

  // Get current mouse position from page (use stored position, fall back to random)
  const startX = opts.startX !== undefined ? opts.startX : (window.__lastMouseX ?? Math.random() * 800 + 100);
  const startY = opts.startY !== undefined ? opts.startY : (window.__lastMouseY ?? Math.random() * 400 + 100);

  // Generate two cubic bezier control points with human-like jitter
  const distX = targetX - startX;
  const distY = targetY - startY;
  const cp1x = startX + distX * (0.2 + Math.random() * 0.2) + (Math.random() - 0.5) * Math.abs(distX) * 0.3;
  const cp1y = startY + distY * (0.2 + Math.random() * 0.2) + (Math.random() - 0.5) * Math.abs(distY) * 0.5;
  const cp2x = startX + distX * (0.6 + Math.random() * 0.2) + (Math.random() - 0.5) * Math.abs(distX) * 0.3;
  const cp2y = startY + distY * (0.6 + Math.random() * 0.2) + (Math.random() - 0.5) * Math.abs(distY) * 0.5;

  for (let i = 1; i <= steps; i++) {
    // Ease-in-out progress (slow start, fast middle, slow end)
    const rawT = i / steps;
    const t = rawT < 0.5
      ? 2 * rawT * rawT
      : 1 - Math.pow(-2 * rawT + 2, 2) / 2;

    const mt = 1 - t;
    const x = mt*mt*mt*startX + 3*mt*mt*t*cp1x + 3*mt*t*t*cp2x + t*t*t*targetX;
    const y = mt*mt*mt*startY + 3*mt*mt*t*cp1y + 3*mt*t*t*cp2y + t*t*t*targetY;

    // Add micro-jitter near destination to simulate hand tremor
    const jitter = (1 - rawT) * 1.5;
    await page.mouse.move(
      x + (Math.random() - 0.5) * jitter,
      y + (Math.random() - 0.5) * jitter
    );

    // Variable speed: slower at start/end, faster in middle
    const speedFactor = rawT < 0.15 || rawT > 0.85 ? 1.8 : 0.7;
    const delay = Math.floor((minDelay + Math.random() * (maxDelay - minDelay)) * speedFactor);
    await page.waitForTimeout(delay);
  }

  // Final precise move to exact target
  await page.mouse.move(targetX, targetY);
}

async function humanClick(page, element) {
  const box = await element.boundingBox();
  if (!box) {
    await element.click();
    return;
  }
  // Land in a slightly random spot within the element (not always dead center)
  const targetX = box.x + box.width  * (0.3 + Math.random() * 0.4);
  const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

  await humanMove(page, targetX, targetY);

  // Brief hover pause before click (human micro-delay)
  await page.waitForTimeout(50 + Math.floor(Math.random() * 100));
  await page.mouse.down();
  await page.waitForTimeout(40 + Math.floor(Math.random() * 60));
  await page.mouse.up();
}

async function humanHover(page, element) {
  const box = await element.boundingBox();
  if (!box) return;
  const targetX = box.x + box.width  * (0.3 + Math.random() * 0.4);
  const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);
  await humanMove(page, targetX, targetY);
}
`;

async function main() {
  if (command === 'open') {
    // 1. Run the original open command
    const status = runOriginal();
    if (status === 0) {
      // 2. Automatically inject high-quality visual mouse helper
      const mouseHelperCode = getBundleCode('mouse-helper.js');
      const injectCode = `async (page) => {
        const exports = {};
        const module = { exports };
        ${mouseHelperCode}
        await (module.exports.installMouseHelper || exports.installMouseHelper)(page);
      }`;
      runCode(injectCode);
    }
    process.exit(status || 0);
  }

  if (command === 'click' || command === 'hover' || command === 'move') {
    const target = args[1];
    if (!target) {
      process.exit(runOriginal());
    }

    const resolvedLocator = resolveLocator(target);
    if (!resolvedLocator) {
      process.exit(runOriginal());
    }

    const isClick = command === 'click';
    const actionFn = isClick ? 'humanClick' : 'humanHover';

    const injectCode = `async (page) => {
      ${HUMAN_MOUSE_CODE}

      const locatorExpr = ${JSON.stringify(resolvedLocator)};
      let elem;
      if (locatorExpr.startsWith('getBy') || locatorExpr.startsWith('locator(')) {
        const loc = eval('page.' + locatorExpr);
        elem = await loc.elementHandle();
      } else {
        elem = await page.$(locatorExpr);
      }

      if (!elem) throw new Error('Element not found: ' + locatorExpr);
      await ${actionFn}(page, elem);
    }`;

    const status = runCode(injectCode);
    process.exit(status || 0);
  }

  if (command === 'type' || command === 'fill') {
    const target = args[1];
    const textArgs = args.slice(2);
    const submitIdx = textArgs.indexOf('--submit');
    const isSubmit = submitIdx !== -1;
    if (isSubmit) textArgs.splice(submitIdx, 1);
    const text = textArgs.join(' ');

    if (!target) {
      process.exit(runOriginal());
    }

    const resolvedLocator = resolveLocator(target);
    if (!resolvedLocator) {
      process.exit(runOriginal());
    }

    const injectCode = `async (page) => {
      ${HUMAN_MOUSE_CODE}

      const locatorExpr = ${JSON.stringify(resolvedLocator)};
      const textVal = ${JSON.stringify(text)};
      const doSubmit = ${isSubmit};
      let elem;
      let locator;
      if (locatorExpr.startsWith('getBy') || locatorExpr.startsWith('locator(')) {
        locator = eval('page.' + locatorExpr);
        elem = await locator.elementHandle();
      } else {
        elem = await page.$(locatorExpr);
        locator = page.locator(locatorExpr);
      }

      if (!elem) throw new Error('Element not found: ' + locatorExpr);

      // Move to element with human-like curve, then click to focus
      await humanClick(page, elem);
      await page.waitForTimeout(80 + Math.floor(Math.random() * 80));

      // Type character by character with human-like delays
      await locator.fill('');
      for (const char of textVal) {
        await page.keyboard.type(char);
        await page.waitForTimeout(40 + Math.floor(Math.random() * 80));
      }

      if (doSubmit) {
        await page.waitForTimeout(100 + Math.floor(Math.random() * 150));
        await page.keyboard.press('Enter');
      }
    }`;

    const status = runCode(injectCode);
    process.exit(status || 0);
  }

  // Pass-through all other commands to original playwright-cli
  process.exit(runOriginal());
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
