import fs from 'node:fs';
import path from 'node:path';
import decode from 'audio-decode';
import { analyzeBeatGrid, detectMixxxBpmFromPcm } from '../src/lib/dj/beatgrid.ts';

function toAudioBuffer(decoded, forceSr) {
  const channels = decoded.channelData;
  const sampleRate = forceSr || decoded.sampleRate;
  let ch0 = channels[0];
  let ch1 = channels[1] || ch0;

  if (forceSr && forceSr !== decoded.sampleRate) {
    // Resample
    const ratio = forceSr / decoded.sampleRate;
    const len = Math.floor(ch0.length * ratio);
    const r0 = new Float32Array(len);
    const r1 = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const src = i / ratio;
      const i0 = Math.floor(src);
      const i1 = Math.min(i0 + 1, ch0.length - 1);
      const frac = src - i0;
      r0[i] = ch0[i0] + (ch0[i1] - ch0[i0]) * frac;
      r1[i] = ch1[i0] + (ch1[i1] - ch1[i0]) * frac;
    }
    ch0 = r0;
    ch1 = r1;
  }

  const length = ch0.length;
  const duration = length / sampleRate;
  const chs = [ch0, ch1];
  return {
    sampleRate, length, duration,
    numberOfChannels: chs.length,
    getChannelData(c) { return chs[c]; },
    copyFromChannel(dest, c, start = 0) {
      const src = chs[c];
      const copyLen = Math.min(dest.length, Math.max(0, src.length - start));
      for (let i = 0; i < copyLen; i++) dest[i] = src[start + i];
    }
  };
}

async function test(file) {
  console.log('====================================');
  console.log('Testing beatgrid.ts on:', path.basename(file));
  const buf = fs.readFileSync(file);
  const raw = await decode(buf);

  // Test at native sample rate (44100)
  const audio44 = toAudioBuffer(raw);
  const grid44 = await analyzeBeatGrid(audio44);
  console.log('Native (44.1kHz):', { bpm: grid44?.bpm, firstBar: grid44?.firstBar });

  // Test at 48000 Hz (Windows audio context default)
  const audio48 = toAudioBuffer(raw, 48000);
  const grid48 = await analyzeBeatGrid(audio48);
  console.log('Simulated 48kHz (Windows):', { bpm: grid48?.bpm, firstBar: grid48?.firstBar });
}

async function run() {
  await test('D:/Music/keybpm-test/Fish Go Deep, Tracey K, Dennis Ferrer - The Cure & The Cause (Dennis Ferrer Remix).mp3');
  await test('D:/Music/keybpm-test/Nightcrawlers - Push The Feeling On (Mk Dub Revisited Edit).flac');
  await test('D:/Music/keybpm-test/Catscan - Smeerpijp.flac');
}
run();
