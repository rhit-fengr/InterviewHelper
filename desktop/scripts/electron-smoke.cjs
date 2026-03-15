const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..');
const artifactsDir = path.join(repoRoot, 'output', 'playwright');
const screenshotPath = path.join(artifactsDir, 'electron-smoke.png');
const question = 'Tell me about your biggest strength.';
const mockedAnswer = 'I focus on calm execution under pressure, turning ambiguous problems into clear steps.';

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
    const suffix = result.signal
      ? `signal ${result.signal}`
      : `exit code ${result.status}`;
    throw new Error(`${command} ${args.join(' ')} failed with ${suffix}`);
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  run('npm.cmd', ['run', 'react-build']);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-helper-e2e-'));
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
      },
    });

    const page = await electronApp.firstWindow();

    await page.route('http://localhost:4000/api/ai/answer', async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          'access-control-allow-origin': '*',
          'cache-control': 'no-cache',
          'content-type': 'text/event-stream; charset=utf-8',
        },
        body: [
          `data: ${JSON.stringify({ text: mockedAnswer.slice(0, 45) })}`,
          '',
          `data: ${JSON.stringify({ text: mockedAnswer.slice(45) })}`,
          '',
          `data: ${JSON.stringify({ done: true })}`,
          '',
        ].join('\n'),
      });
    });

    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('h2');
    await expectHeading(page, 'Interview Setup');

    const aiProvider = page.getByLabel('AI Provider');
    await assertValue(aiProvider, 'openai', 'default AI provider should be OpenAI');

    const englishCheckbox = page.getByRole('checkbox', { name: 'English (US)' });
    const chineseCheckbox = page.getByRole('checkbox', { name: 'Chinese (Mandarin)' });

    assert.equal(await englishCheckbox.isChecked(), true, 'English should be selected by default');
    await chineseCheckbox.check();
    assert.equal(await chineseCheckbox.isChecked(), true, 'Chinese should be selectable');

    await englishCheckbox.uncheck();
    assert.equal(await englishCheckbox.isChecked(), false, 'English should uncheck when another language remains');
    assert.equal(await chineseCheckbox.isChecked(), true, 'Chinese should remain checked');

    await chineseCheckbox.click();
    assert.equal(await chineseCheckbox.isChecked(), true, 'last selected language should stay locked on');

    await page.getByLabel('Additional Instructions').fill('Focus on backend and system design examples.');
    await page.getByRole('button', { name: 'Continue to Session Settings →' }).click();

    await expectHeading(page, 'Session Settings');
    const autoAnswerSwitch = page.getByRole('switch', { name: 'Auto Answer' });
    await autoAnswerSwitch.click();
    await expectAriaChecked(autoAnswerSwitch, 'false');

    await page.getByRole('button', { name: '🎙️ Start Interview (Standard)' }).click();
    await expectHeading(page, 'Standard Mode');

    const input = page.getByLabel('Manual question input');
    await input.fill(question);
    await page.getByRole('button', { name: '→' }).click();

    await page.getByText('Detected Question').waitFor({ state: 'visible' });
    await page.getByText(question, { exact: true }).waitFor({ state: 'visible' });
    await page.getByText('Answer').waitFor({ state: 'visible' });
    await page.getByText(mockedAnswer, { exact: true }).waitFor({ state: 'visible' });
    await page.getByText('Conversation History').waitFor({ state: 'visible' });

    await page.getByRole('button', { name: 'Collapse' }).click();
    await page.getByText('turn(s) kept in memory').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Hide' }).click();
    await page.getByText('History panel hidden.').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Show' }).click();
    await page.getByText(`Q: ${question}`).waitFor({ state: 'visible' });

    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Electron smoke test passed. Screenshot: ${screenshotPath}`);
  } finally {
    await electronApp?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function expectHeading(page, name) {
  await page.getByRole('heading', { name }).waitFor({ state: 'visible' });
}

async function assertValue(locator, expected, message) {
  assert.equal(await locator.inputValue(), expected, message);
}

async function expectAriaChecked(locator, expected) {
  await locator.waitFor({ state: 'visible' });
  assert.equal(await locator.getAttribute('aria-checked'), expected);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
