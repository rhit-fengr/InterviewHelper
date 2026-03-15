const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { _electron: electron } = require('playwright');

const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..');
const artifactsDir = path.join(repoRoot, 'output', 'playwright');
const screenshotPath = path.join(artifactsDir, 'electron-audio-overlap.png');
const scenarioPath = path.join(artifactsDir, 'audio-overlap-scenario.json');
const fixtureManifestPath = path.join(desktopDir, 'test-assets', 'audio', 'manifest.json');
const answerText = 'Stay calm, prioritize the signal, and explain tradeoffs clearly while I execute.';

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
    name: 'dual-source-overlap',
    fixtures: fixtures.map((fixture) => ({
      ...fixture,
      fileUrl: pathToFileURL(fixture.filePath).href,
    })),
    capture: {
      system: {
        emissions: [
          {
            fixtureId: fixtureById['system-question-stereo'].id,
            atMs: 350,
            delayMs: 80,
            channelCount: fixtureById['system-question-stereo'].channelCount,
            text: 'Tell me about your biggest strength?',
          },
          {
            fixtureId: fixtureById['system-followup-stereo'].id,
            atMs: 2200,
            delayMs: 40,
            channelCount: fixtureById['system-followup-stereo'].channelCount,
            text: 'How do you handle ambiguity on a fast-moving team?',
          },
        ],
      },
      mic: {
        emissions: [
          {
            fixtureId: fixtureById['mic-leakage-mono'].id,
            atMs: 650,
            delayMs: 20,
            channelCount: fixtureById['mic-leakage-mono'].channelCount,
            text: 'Tell me about your biggest strength?',
          },
          {
            fixtureId: fixtureById['mic-answer-mono'].id,
            atMs: 1400,
            delayMs: 25,
            channelCount: fixtureById['mic-answer-mono'].channelCount,
            text: 'My biggest strength is staying calm under pressure and creating clarity for the team.',
          },
        ],
      },
    },
    detectQuestion: [
      {
        contains: 'Tell me about your biggest strength?',
        question: 'Tell me about your biggest strength?',
      },
      {
        contains: 'How do you handle ambiguity on a fast-moving team?',
        question: 'How do you handle ambiguity on a fast-moving team?',
      },
    ],
    answer: {
      events: [
        { data: { text: answerText.slice(0, 38) }, delayMs: 80 },
        { data: { text: answerText.slice(38) }, delayMs: 60 },
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

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-helper-audio-e2e-'));
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

    await page.getByLabel('Transcription Provider').selectOption('openai');
    await page.locator('button.btn-primary').click();

    await page.getByRole('heading', { name: 'Session Settings' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Mic + System' }).click();
    await page.locator('button.btn-primary').click();

    await page.getByRole('heading', { name: 'Standard Mode' }).waitFor({ state: 'visible' });
    await page.locator('button.btn-toggle').click();

    await waitForBodyText(page, 'Tell me about your biggest strength?');
    await waitForBodyText(page, 'My biggest strength is staying calm under pressure and creating clarity for the team.');
    await waitForBodyText(page, 'How do you handle ambiguity on a fast-moving team?');
    await waitForBodyText(page, answerText);

    await page.waitForTimeout(1200);

    const transcriptEntries = page.locator('.transcript-entry');
    await assertHasSingleQuestionEntry(transcriptEntries);
    await assertSourceTags(page);

    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Electron audio scenario passed. Screenshot: ${screenshotPath}`);
  } finally {
    await electronApp?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function assertHasSingleQuestionEntry(transcriptEntries) {
  const entryCount = await transcriptEntries.count();
  let occurrences = 0;
  for (let index = 0; index < entryCount; index += 1) {
    const text = await transcriptEntries.nth(index).innerText();
    if (text.includes('Tell me about your biggest strength?')) {
      occurrences += 1;
    }
  }
  assert.equal(occurrences, 1, 'system question should appear once after cross-source dedupe');
}

async function assertSourceTags(page) {
  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  assert(bodyText.includes('SYSTEM'), 'expected at least one System transcript source tag');
  assert(bodyText.includes('MIC'), 'expected at least one Mic transcript source tag');
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
