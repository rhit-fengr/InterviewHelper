const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..');
const artifactsDir = path.join(repoRoot, 'output', 'playwright');
const fixtureManifestPath = path.join(desktopDir, 'test-assets', 'audio', 'manifest.json');

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

function buildScenario(fixtures, mode = 'local') {
  const fixtureById = Object.fromEntries(fixtures.map((fixture) => [fixture.id, fixture]));
  const useWindowsLiveCaptions = mode === 'windows-live-captions';

  return {
    name: `mic-only-${mode}`,
    fixtures,
    capture: {
      mic: {
        emissions: useWindowsLiveCaptions
          ? []
          : [
            {
              fixtureId: fixtureById['mic-answer-mono'].id,
              atMs: 320,
              delayMs: 30,
              text: fixtureById['mic-answer-mono'].text,
            },
          ],
      },
      system: {
        eager: useWindowsLiveCaptions,
        emissions: useWindowsLiveCaptions
          ? [
            {
              fixtureId: fixtureById['system-question-stereo'].id,
              atMs: 320,
              delayMs: 30,
              text: fixtureById['system-question-stereo'].text,
            },
          ]
          : [],
      },
    },
    detectQuestion: [
      {
        contains: fixtureById['system-question-stereo'].text,
        question: fixtureById['system-question-stereo'].text,
      },
    ],
    answer: {
      events: [
        { data: { text: 'Mocked answer for mic-only scenario.' }, delayMs: 50 },
        { data: { done: true } },
      ],
    },
  };
}

async function runCase({ mode, providerLabel, expectedText, screenshotName }) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const fixtures = JSON.parse(fs.readFileSync(fixtureManifestPath, 'utf8'));
    const scenarioPath = path.join(artifactsDir, `mic-only-${mode}.json`);
    const screenshotPath = path.join(artifactsDir, screenshotName);
    fs.writeFileSync(scenarioPath, `${JSON.stringify(buildScenario(fixtures, mode), null, 2)}\n`, 'utf8');

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `interview-helper-mic-${mode}-`));
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
      await page.getByLabel('Transcription Provider').selectOption(mode);
      await page.locator('button.btn-primary').click();

      await page.getByRole('heading', { name: 'Session Settings' }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Mic only' }).click();
      await page.locator('button.btn-primary').click();

      await page.getByRole('heading', { name: 'Standard Mode' }).waitFor({ state: 'visible' });
      await page.locator('button.btn-toggle').click();

      await page.waitForFunction((text) => document.body?.innerText?.includes(text), expectedText);
      await page.waitForFunction((provider) => document.body?.innerText?.includes(provider), providerLabel);
      const bodyText = await page.evaluate(() => document.body?.innerText || '');
      assert(!bodyText.includes('Mic=webspeech'), 'Mic only should no longer be hard-wired to webspeech in Electron');
      assert(
        !bodyText.includes('Windows Live Captions is running, but no readable subtitle text was captured yet.'),
        'Mic only transcript should not show the empty Windows Live Captions warning once text is captured.'
      );

      await page.screenshot({ path: screenshotPath, fullPage: true });
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= 2) {
        throw error;
      }
    } finally {
      await electronApp?.close().catch(() => {});
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  }
  throw lastError;
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  run('node', ['scripts/generate-audio-fixtures.cjs']);
  run('npm.cmd', ['run', 'react-build']);

  await runCase({
    mode: 'local',
    providerLabel: 'Mic=local',
    expectedText: 'My biggest strength is staying calm under pressure and creating clarity for the team.',
    screenshotName: 'electron-mic-only-local.png',
  });

  await runCase({
    mode: 'windows-live-captions',
    providerLabel: 'Mic=windows-live-captions + mic-assist',
    expectedText: 'Tell me about your biggest strength?',
    screenshotName: 'electron-mic-only-windows-live-captions.png',
  });

  console.log('Electron mic-only scenarios passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
