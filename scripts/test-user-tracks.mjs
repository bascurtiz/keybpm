import fs from 'node:fs';
import path from 'node:path';
import decode from 'audio-decode';
import { analyzeBeatGrid } from '../src/lib/dj/beatgrid.ts';

function toAudioBuffer(decoded) {
  const channels = decoded.channelData;
  const sampleRate = decoded.sampleRate;
  const length = channels[0].length;
  const duration = length / sampleRate;
  return {
    sampleRate, length, duration,
    numberOfChannels: channels.length,
    getChannelData(c) { return channels[c]; },
    copyFromChannel(dest, c, start = 0) {
      const src = channels[c];
      const copyLen = Math.min(dest.length, Math.max(0, src.length - start));
      for (let i = 0; i < copyLen; i++) dest[i] = src[start + i];
    }
  };
}

async function test(file) {
  console.log('Testing beatgrid.ts on:', path.basename(file));
  const buf = fs.readFileSync(file);
  const raw = await decode(buf);
  const audio = toAudioBuffer(raw);
  const grid = await analyzeBeatGrid(audio);
  console.log('Result:', { bpm: grid?.bpm, firstBar: grid?.firstBar, confidence: grid?.confidence });
}

async function run() {
  await test('D:/Music/keybpm-test/Fish Go Deep, Tracey K, Dennis Ferrer - The Cure & The Cause (Dennis Ferrer Remix).mp3');
  await test('D:/Music/keybpm-test/Nightcrawlers - Push The Feeling On (Mk Dub Revisited Edit).flac');
}
run();
