'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${cmd} ${args.join(' ')}`);
  }
}

function commandExists(cmd, args = ['--version']) {
  const result = spawnSync(cmd, args, { stdio: 'ignore' });
  return result.status === 0;
}

function findSystemPython() {
  if (process.platform === 'win32' && commandExists('py', ['-3', '--version'])) {
    return { cmd: 'py', baseArgs: ['-3'] };
  }
  if (commandExists('python', ['--version'])) {
    return { cmd: 'python', baseArgs: [] };
  }
  return null;
}

function resolveModelRepo(modelName) {
  const normalized = String(modelName || '').trim().toLowerCase();
  const known = new Set([
    'tiny',
    'tiny.en',
    'base',
    'base.en',
    'small',
    'small.en',
    'medium',
    'medium.en',
    'large-v1',
    'large-v2',
    'large-v3',
    'distil-large-v2',
    'distil-large-v3',
  ]);
  if (!known.has(normalized)) {
    throw new Error(
      `Unsupported WHISPER_BUNDLE_MODEL "${modelName}". Supported: ${Array.from(known).join(', ')}`
    );
  }
  return `Systran/faster-whisper-${normalized}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeText(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const serviceDir = path.join(repoRoot, 'local-whisper-service');
  const runtimeDir = path.join(serviceDir, 'runtime');
  const venvDir = path.join(runtimeDir, 'venv');
  const modelName = process.env.WHISPER_BUNDLE_MODEL || process.env.WHISPER_MODEL || 'small';
  const modelRepo = resolveModelRepo(modelName);
  const modelsRootDir = path.join(runtimeDir, 'models');
  const modelDir = path.join(runtimeDir, 'models', modelName);
  const manifestPath = path.join(runtimeDir, 'manifest.json');
  const defaultModelPath = path.join(runtimeDir, 'default_model.txt');
  const forceRebuild = process.env.LOCAL_WHISPER_FORCE_REBUILD === '1';

  if (process.env.LOCAL_WHISPER_SKIP_PREPARE === '1') {
    console.log('[prepare-local-whisper-runtime] LOCAL_WHISPER_SKIP_PREPARE=1, skipping runtime preparation.');
    return;
  }

  const python = findSystemPython();
  if (!python) {
    throw new Error(
      'Python 3.10+ is required to prepare bundled local-whisper runtime. Install Python and retry.'
    );
  }

  const bundledPython = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
  const bundledModelFile = path.join(modelDir, 'model.bin');
  const existingManifest = safeReadJson(manifestPath);

  if (
    !forceRebuild &&
    fs.existsSync(bundledPython) &&
    fs.existsSync(bundledModelFile) &&
    existingManifest?.modelName === modelName
  ) {
    console.log('[prepare-local-whisper-runtime] Existing bundled runtime detected. Reusing.');
    return;
  }

  console.log('[prepare-local-whisper-runtime] Preparing bundled runtime...');
  if (forceRebuild && fs.existsSync(runtimeDir)) {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
  ensureDir(runtimeDir);

  if (!fs.existsSync(bundledPython)) {
    run(python.cmd, [...python.baseArgs, '-m', 'venv', venvDir], {
      cwd: serviceDir,
    });
  }

  run(bundledPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
    cwd: serviceDir,
  });
  run(bundledPython, ['-m', 'pip', 'install', '-r', 'requirements.txt'], {
    cwd: serviceDir,
  });

  ensureDir(modelsRootDir);
  for (const entry of fs.readdirSync(modelsRootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === modelName) continue;
    fs.rmSync(path.join(modelsRootDir, entry.name), { recursive: true, force: true });
  }

  ensureDir(path.dirname(modelDir));
  const downloadScript = [
    'from huggingface_hub import snapshot_download',
    'import os, sys',
    'repo_id = sys.argv[1]',
    'target = sys.argv[2]',
    'os.makedirs(target, exist_ok=True)',
    'snapshot_download(repo_id=repo_id, local_dir=target)',
    'print(f"downloaded {repo_id} -> {target}")',
  ].join('\n');
  run(bundledPython, ['-c', downloadScript, modelRepo, modelDir], {
    cwd: serviceDir,
  });

  fs.rmSync(path.join(modelDir, '.cache'), { recursive: true, force: true });

  writeText(defaultModelPath, `${modelName}\n`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        preparedAt: new Date().toISOString(),
        modelName,
        modelRepo,
        runtimePython: path.relative(runtimeDir, bundledPython),
      },
      null,
      2
    ),
    'utf8'
  );

  console.log('[prepare-local-whisper-runtime] Done.');
}

try {
  main();
} catch (err) {
  console.error('[prepare-local-whisper-runtime] FAILED:', err?.message || err);
  process.exit(1);
}
