const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..');
const artifactsDir = path.join(repoRoot, 'output', 'playwright');
const scenarioPath = path.join(artifactsDir, 'screenshot-answer-scenario.json');
const screenshotPath = path.join(artifactsDir, 'electron-screenshot-answer.png');
const mockImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uoAAAAASUVORK5CYII=';

function run(command, args, options = {}) {
  const shellCommand = process.platform === 'win32'
    ? process.env.ComSpec || 'cmd.exe'
    : command;
  const shellArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', [command, ...args].join(' ')]
    : args;
  const result = spawnSync(shellCommand, shellArgs, {
    cwd: options.cwd || desktopDir,
    env: {
      ...process.env,
      CI: '1',
      BROWSER: 'none',
      ...options.env,
    },
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    const suffix = result.signal ? `signal ${result.signal}` : `exit code ${result.status}`;
    throw new Error(`${command} ${args.join(' ')} failed with ${suffix}`);
  }
}

function buildScenario() {
  return {
    name: 'screenshot-answer-flow',
    fixtures: [],
    capture: {
      mic: { emissions: [] },
      system: { emissions: [] },
    },
    detectQuestion: [],
    screenshot: {
      imageDataUrl: mockImageDataUrl,
      question: 'Explain the difference between throttling and debouncing.',
      answer: 'Throttling limits how often a function can run over time, while debouncing waits until calls stop for a moment before running once.',
    },
    answer: {
      events: [
        { data: { text: 'unused' } },
        { data: { done: true } },
      ],
    },
  };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  run('npm.cmd', ['run', 'react-build']);
  fs.writeFileSync(scenarioPath, `${JSON.stringify(buildScenario(), null, 2)}\n`, 'utf8');

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-helper-screenshot-e2e-'));
  let electronApp;
  try {
    electronApp = await electron.launch({
      cwd: desktopDir,
      args: ['.'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_RENDERER_HTML: 'build/index.html',
        ELECTRON_USER_DATA_DIR: userDataDir,
        ELECTRON_E2E_SCENARIO_JSON: fs.readFileSync(scenarioPath, 'utf8'),
      },
    });

    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('heading', { name: 'Interview Setup' }).waitFor({ state: 'visible' });
    await page.locator('button.btn-primary').click();

    await page.getByRole('heading', { name: 'Session Settings' }).waitFor({ state: 'visible' });
    await page.locator('button.btn-primary').click();

    await page.getByRole('heading', { name: 'Standard Mode' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '🖼 Answer Screenshot' }).click();

    await waitForBodyText(page, 'Explain the difference between throttling and debouncing.');
    await waitForBodyText(page, 'Throttling limits how often a function can run over time');

    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    await page.locator('.question-box').waitFor({ state: 'visible' });
    assert(bodyText.includes('Answer Screenshot'), 'expected screenshot answer button to remain visible');

    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Electron screenshot scenario passed. Screenshot: ${screenshotPath}`);
  } finally {
    await electronApp?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function waitForBodyText(page, text) {
  await page.waitForFunction((expectedText) => (
    document.body?.innerText?.includes(expectedText)
  ), text);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
