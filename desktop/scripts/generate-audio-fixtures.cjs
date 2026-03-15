const fs = require('node:fs');
const path = require('node:path');

const outputDir = path.resolve(__dirname, '../test-assets/audio');
const manifestPath = path.join(outputDir, 'manifest.json');

const FIXTURES = [
  {
    id: 'system-question-stereo',
    fileName: 'system-question-stereo.wav',
    durationMs: 1800,
    channelCount: 2,
    frequencies: [440, 554],
    description: 'Deterministic stereo system-audio question fixture.',
  },
  {
    id: 'mic-leakage-mono',
    fileName: 'mic-leakage-mono.wav',
    durationMs: 900,
    channelCount: 1,
    frequencies: [660],
    description: 'Mono microphone leakage fixture used to verify cross-source dedupe.',
  },
  {
    id: 'mic-answer-mono',
    fileName: 'mic-answer-mono.wav',
    durationMs: 1600,
    channelCount: 1,
    frequencies: [330],
    description: 'Mono microphone answer fixture.',
  },
  {
    id: 'system-followup-stereo',
    fileName: 'system-followup-stereo.wav',
    durationMs: 1200,
    channelCount: 2,
    frequencies: [392, 494],
    description: 'Deterministic stereo system-audio follow-up fixture.',
  },
];

function writeWavFile(filePath, {
  durationMs,
  channelCount,
  frequencies,
  sampleRate = 16000,
  amplitude = 0.22,
}) {
  const sampleCount = Math.max(1, Math.round(sampleRate * (durationMs / 1000)));
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = sampleCount * blockAlign;
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
  buffer.writeUInt16LE(bytesPerSample * 8, offset); offset += 2;
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const t = sampleIndex / sampleRate;
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const frequency = frequencies[channelIndex % frequencies.length];
      const envelope = Math.sin(Math.PI * Math.min(1, sampleIndex / (sampleRate * 0.08)));
      const raw = Math.sin(2 * Math.PI * frequency * t) * amplitude * envelope;
      const int16 = Math.max(-1, Math.min(1, raw)) * 32767;
      buffer.writeInt16LE(Math.round(int16), offset);
      offset += 2;
    }
  }

  fs.writeFileSync(filePath, buffer);
}

function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const manifest = FIXTURES.map((fixture) => {
    const filePath = path.join(outputDir, fixture.fileName);
    writeWavFile(filePath, fixture);
    return {
      ...fixture,
      filePath,
    };
  });

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Generated ${manifest.length} audio fixtures in ${outputDir}`);
}

main();
