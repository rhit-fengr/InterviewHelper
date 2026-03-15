const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const outputDir = path.resolve(__dirname, '../test-assets/audio');
const manifestPath = path.join(outputDir, 'manifest.json');

const FIXTURES = [
  {
    id: 'system-question-stereo',
    fileName: 'system-question-stereo.wav',
    text: 'Tell me about your biggest strength?',
    channelCount: 2,
    gain: 1,
    description: 'Stereo system-audio interview question spoken with built-in TTS.',
  },
  {
    id: 'mic-leakage-mono',
    fileName: 'mic-leakage-mono.wav',
    text: 'Tell me about your biggest strength?',
    channelCount: 1,
    gain: 0.42,
    description: 'Mono microphone leakage fixture used to verify cross-source dedupe.',
  },
  {
    id: 'mic-answer-mono',
    fileName: 'mic-answer-mono.wav',
    text: 'My biggest strength is staying calm under pressure and creating clarity for the team.',
    channelCount: 1,
    gain: 1,
    description: 'Mono microphone answer fixture spoken with built-in TTS.',
  },
  {
    id: 'system-followup-stereo',
    fileName: 'system-followup-stereo.wav',
    text: 'How do you handle ambiguity on a fast-moving team?',
    channelCount: 2,
    gain: 1,
    description: 'Stereo system-audio follow-up question spoken with built-in TTS.',
  },
];

function runPowerShell(command) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command,
  ], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`PowerShell command failed with exit code ${result.status}`);
  }
}

function toPowerShellLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function synthesizeSpeechToWave(outputPath, text) {
  const command = [
    'Add-Type -AssemblyName System.Speech',
    `$path = ${toPowerShellLiteral(outputPath)}`,
    `$text = ${toPowerShellLiteral(text)}`,
    '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    '$synth.Rate = 0',
    '$synth.Volume = 100',
    '$synth.SetOutputToWaveFile($path)',
    '$synth.Speak($text)',
    '$synth.SetOutputToDefaultAudioDevice()',
    '$synth.Dispose()',
  ].join('; ');
  runPowerShell(command);
}

function parsePcmWave(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Unsupported WAV file format.');
  }

  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;

    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkDataOffset),
        channelCount: buffer.readUInt16LE(chunkDataOffset + 2),
        sampleRate: buffer.readUInt32LE(chunkDataOffset + 4),
        bitsPerSample: buffer.readUInt16LE(chunkDataOffset + 14),
      };
    }

    if (chunkId === 'data') {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!fmt || dataOffset < 0) {
    throw new Error('WAV file is missing fmt or data chunk.');
  }

  return {
    fmt,
    data: buffer.slice(dataOffset, dataOffset + dataSize),
  };
}

function writePcmWave({
  filePath,
  pcmData,
  channelCount,
  sampleRate,
  bitsPerSample,
}) {
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length;
  const buffer = Buffer.alloc(44 + dataSize);

  let offset = 0;
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4;
  buffer.writeUInt16LE(1, offset); offset += 2;
  buffer.writeUInt16LE(channelCount, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;
  pcmData.copy(buffer, offset);

  fs.writeFileSync(filePath, buffer);
}

function applyGainAndChannels(sourceBuffer, targetChannelCount, gain = 1) {
  const parsed = parsePcmWave(sourceBuffer);
  const { channelCount, sampleRate, bitsPerSample, audioFormat } = parsed.fmt;
  if (audioFormat !== 1 || bitsPerSample !== 16) {
    throw new Error('Only PCM 16-bit WAV files are supported for fixture post-processing.');
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameCount = parsed.data.length / (channelCount * bytesPerSample);
  const output = Buffer.alloc(frameCount * targetChannelCount * bytesPerSample);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const samples = [];
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sampleOffset = (frameIndex * channelCount + channelIndex) * bytesPerSample;
      samples.push(parsed.data.readInt16LE(sampleOffset));
    }

    for (let channelIndex = 0; channelIndex < targetChannelCount; channelIndex += 1) {
      const sourceSample = samples[Math.min(channelIndex, samples.length - 1)] || samples[0] || 0;
      const amplified = Math.max(-32768, Math.min(32767, Math.round(sourceSample * gain)));
      const outputOffset = (frameIndex * targetChannelCount + channelIndex) * bytesPerSample;
      output.writeInt16LE(amplified, outputOffset);
    }
  }

  return {
    pcmData: output,
    channelCount: targetChannelCount,
    sampleRate,
    bitsPerSample,
    durationMs: Math.round((frameCount / sampleRate) * 1000),
  };
}

function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const manifest = FIXTURES.map((fixture) => {
    const filePath = path.join(outputDir, fixture.fileName);
    const tempMonoPath = path.join(outputDir, `${fixture.id}.mono.tmp.wav`);
    synthesizeSpeechToWave(tempMonoPath, fixture.text);

    const processed = applyGainAndChannels(
      fs.readFileSync(tempMonoPath),
      fixture.channelCount,
      fixture.gain,
    );
    writePcmWave({
      filePath,
      ...processed,
    });
    fs.rmSync(tempMonoPath, { force: true });

    return {
      ...fixture,
      filePath,
      durationMs: processed.durationMs,
    };
  });

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Generated ${manifest.length} audio fixtures in ${outputDir}`);
}

main();
