import fs from 'fs';

async function fetchOnlineTracks() {
  console.log('Fetching https://keybpm.info/assets/tracks-Cg53F-33.js...');
  const res = await fetch('https://keybpm.info/assets/tracks-Cg53F-33.js');
  if (!res.ok) throw new Error('Fetch failed: ' + res.status);
  let js = await res.text();
  console.log('Received JS file, length:', js.length);

  // The format is: const e=[{...}];export{e as r};
  // Let's strip prefix and suffix to parse JSON or eval
  const prefix = 'const e=';
  const suffix = ';export{e as r};';
  let jsonStr;
  if (js.startsWith(prefix) && js.endsWith(suffix)) {
    jsonStr = js.slice(prefix.length, js.length - suffix.length);
  } else {
    // regex match
    const m = js.match(/const\s+\w+\s*=\s*(\[[\s\S]*\]);\s*export/);
    if (m) jsonStr = m[1];
  }

  let onlineTracks;
  if (jsonStr) {
    try {
      onlineTracks = JSON.parse(jsonStr);
      console.log('Parsed JSON directly!');
    } catch (e) {
      console.log('JSON.parse failed, writing temp file to import as module...');
    }
  }

  if (!onlineTracks) {
    // Write as .mjs and dynamic import
    fs.writeFileSync('scripts/temp-online-tracks.mjs', js);
    const mod = await import('./temp-online-tracks.mjs');
    onlineTracks = mod.r || mod.default || Object.values(mod)[0];
    fs.unlinkSync('scripts/temp-online-tracks.mjs');
  }

  console.log('Online tracks count:', onlineTracks.length);

  // Compare with local
  const localTracks = JSON.parse(fs.readFileSync('data/tracks.json', 'utf8'));
  console.log('Local tracks count:', localTracks.length);

  // Check diff
  const localIds = new Set(localTracks.map(t => t.id));
  const newOnline = onlineTracks.filter(t => !localIds.has(t.id));
  console.log('Tracks in online that are not in local:', newOnline.length);

  const onlineIds = new Set(onlineTracks.map(t => t.id));
  const newLocal = localTracks.filter(t => !onlineIds.has(t.id));
  console.log('Tracks in local that are not in online:', newLocal.length);

  if (newOnline.length > 0) {
    console.log('Sample new online track:', newOnline[0]);
  }

  // Also check if we can save the updated online tracks to a file
  fs.writeFileSync('data/online-tracks.json', JSON.stringify(onlineTracks, null, 2));
  console.log('Saved data/online-tracks.json');
}

fetchOnlineTracks().catch(console.error);
