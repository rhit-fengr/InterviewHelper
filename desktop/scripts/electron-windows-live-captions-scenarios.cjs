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
const screenshotPath = path.join(artifactsDir, 'electron-wlc-mic-system.png');
const scenarioPath = path.join(artifactsDir, 'wlc-mic-system-scenario.json');

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

function buildScenario(fixtures) {
  const fixtureById = Object.fromEntries(fixtures.map((fixture) => [fixture.id, fixture]));
  return {
    name: 'windows-live-captions-mic-system-combined',
    fixtures,
    capture: {
      mic: {
        emissions: [],
      },
      system: {
        eager: true,
        emissions: [
          {
            fixtureId: fixtureById['system-question-stereo'].id,
            atMs: 320,
            delayMs: 30,
            text: fixtureById['system-question-stereo'].text,
          },
          {
            fixtureId: fixtureById['mic-answer-mono'].id,
            atMs: 1800,
            delayMs: 25,
            text: fixtureById['mic-answer-mono'].text,
          },
        ],
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
        { data: { text: 'Mocked answer from the WLC combined scenario.' }, delayMs: 60 },
        { data: { done: true } },
      ],
    },
  };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  run('node', ['scripts/generate-audio-fixtures.cjs']);
  run('npm.cmd', ['run', 'react-build']);

  const fixtures = JSON.parse(fs.readFileSync(fixtureManifestPath, 'utf8'));
  fs.writeFileSync(scenarioPath, `${JSON.stringify(buildScenario(fixtures), null, 2)}\n`, 'utf8');

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-helper-wlc-e2e-'));
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
      await page.getByRole('heading', { name: 'Caption Mode Setup' }).waitFor({ state: 'visible' });

      await page.getByLabel('Transcription Provider').selectOption('windows-live-captions');
      await page.locator('button.btn-primary').click();

      await page.getByRole('heading', { name: 'Session Settings' }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Mic + System' }).click();
      await page.locator('button.btn-primary').click();

      await page.getByRole('heading', { name: 'Standard Mode' }).waitFor({ state: 'visible' });
      await page.locator('button.btn-toggle').click();
      await page.getByRole('button', { name: 'Hide Live Captions' }).waitFor({ state: 'visible' });

      await waitForBodyText(page, 'Tell me about your biggest strength?');
      await waitForBodyText(page, 'My biggest strength is staying calm under pressure and creating clarity for the team.');

      const bodyText = await page.evaluate(() => document.body?.innerText || '');
      assert(bodyText.includes('Captions=windows-live-captions + mic-assist'), 'expected combined WLC label');
      assert(!bodyText.includes('Mic=openai -> local -> gemini'), 'WLC combined mode should not keep a separate mic cloud STT label');
      assert(!bodyText.includes('Rate limit reached while transcribing audio.'), 'WLC combined mode should not surface cloud STT rate limit warnings');
      assert(!bodyText.includes('Transcription request timed out repeatedly.'), 'WLC combined mode should not surface repeated timeout warnings');
      assert(!bodyText.includes('Please provide audio file'), 'WLC combined mode should not render backend audio validation errors as transcript text');
      assert(!bodyText.includes('请提供音频文件'), 'WLC combined mode should not render backend audio validation errors as transcript text');

      const transcriptEntries = page.locator('.transcript-entry');
      const entryCount = await transcriptEntries.count();
      assert(entryCount >= 2, 'expected multiple transcript entries from the combined WLC flow');

      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Electron Windows Live Captions combined scenario passed. Screenshot: ${screenshotPath}`);
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

async function waitForBodyText(page, text) {
  await page.waitForFunction((expectedText) => (
    document.body?.innerText?.includes(expectedText)
  ), text);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
