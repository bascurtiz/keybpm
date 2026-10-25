import fs from 'node:fs';
import zlib from 'node:zlib';
import { intervalToRoman, SHARP_NOTES } from './lib/roman.mjs';

function slugify(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[''’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function cleanArtist(artist) {
  return artist
    .replace(/\s+(?:ft\.?|feat\.?|featuring|vs\.?|x)\s+.+$/i, '')
    .replace(/\s*\(.*?\)\s*/g, '')
    .trim();
}

function cleanTitle(title) {
  return title
    .replace(/\s*\(.*?(?:remix|mix|edit|version|feat|ft).*?\)\s*/gi, '')
    .replace(/\s*\[.*?(?:remix|mix|edit|version|feat|ft).*?\]\s*/gi, '')
    .trim();
}

function intervalsToQuality(intervals) {
  if (!intervals || intervals.length === 0) return { quality: 'major', ext: '' };
  const first = intervals[0];
  const second = intervals[1];
  const third = intervals[2];

  if (first === 4 && second === 3) {
    if (third === 3) return { quality: 'major', ext: '7' };
    if (third === 4) return { quality: 'major', ext: 'maj7' };
    return { quality: 'major', ext: '' };
  }
  if (first === 3 && second === 4) {
    if (third === 3) return { quality: 'minor', ext: '7' };
    return { quality: 'minor', ext: '' };
  }
  if (first === 3 && second === 3) {
    if (third === 3) return { quality: 'diminished', ext: '7' };
    if (third === 4) return { quality: 'diminished', ext: 'ø7' };
    return { quality: 'diminished', ext: '°' };
  }
  if (first === 4 && second === 4) {
    return { quality: 'augmented', ext: '+' };
  }
  if (first === 5 || second === 5) {
    return { quality: 'sus', ext: 'sus4' };
  }
  if (first === 2 || second === 2) {
    return { quality: 'sus', ext: 'sus2' };
  }
  return { quality: first === 3 ? 'minor' : 'major', ext: '' };
}

function parseHarmony(ann) {
  if (!ann || !ann.keys || !ann.harmony || !ann.harmony.length) return null;
  const keyInfo = ann.keys[0];
  const tonicPc = keyInfo.tonic_pitch_class;
  const isMinor = keyInfo.scale_degree_intervals && keyInfo.scale_degree_intervals[1] === 1;

  const progression = [];
  const chords = [];

  for (const h of ann.harmony) {
    const rootPc = h.root_pitch_class;
    const interval = (rootPc - tonicPc + 12) % 12;
    const { quality, ext } = intervalsToQuality(h.root_position_intervals);

    let roman = intervalToRoman(interval, quality, isMinor) + ext;
    if (h.inversion === 1) roman += '6';
    if (h.inversion === 2) roman += '64';

    const rootName = SHARP_NOTES[rootPc];
    const chordName = `${rootName}${quality === 'minor' ? 'm' : ''}${ext}`;

    if (progression.length === 0 || progression[progression.length - 1] !== roman) {
      progression.push(roman);
      chords.push(chordName);
    }
  }

  if (progression.length === 0) return null;

  return {
    key: `${SHARP_NOTES[tonicPc]} ${isMinor ? 'minor' : 'major'}`,
    roman: progression.join(' – '),
    chords: chords.join(' – '),
  };
}

async function matchAll() {
  console.log('Loading Hooktheory dataset...');
  const buf = fs.readFileSync('data/Hooktheory.json.gz');
  const htData = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
  console.log(`Loaded ${Object.keys(htData).length} Hooktheory clips.`);

  // Build index: `${artistSlug}/${songSlug}` -> list of progressions
  const htIndex = new Map();
  for (const [id, entry] of Object.entries(htData)) {
    if (!entry.hooktheory || !entry.annotations) continue;
    const artistSlug = entry.hooktheory.artist?.toLowerCase();
    const songSlug = entry.hooktheory.song?.toLowerCase();
    if (!artistSlug || !songSlug) continue;

    const harm = parseHarmony(entry.annotations);
    if (!harm) continue;

    const key = `${artistSlug}/${songSlug}`;
    if (!htIndex.has(key)) {
      htIndex.set(key, {
        artistSlug,
        songSlug,
        url: entry.hooktheory.urls?.song,
        clips: [],
      });
    }

    const item = htIndex.get(key);
    // Don't add duplicate progressions
    if (!item.clips.some(c => c.roman === harm.roman)) {
      item.clips.push({
        clipId: id,
        key: harm.key,
        roman: harm.roman,
        chords: harm.chords,
      });
    }
  }
  console.log(`Indexed ${htIndex.size} unique Hooktheory songs.`);

  // Load KeyDB tracks
  console.log('Loading KeyDB tracks...');
  const tracks = JSON.parse(fs.readFileSync('data/tracks.json', 'utf8'));
  console.log(`Loaded ${tracks.length} KeyDB tracks.`);

  let matchedDirect = 0;
  let matchedSlug = 0;
  let matchedClean = 0;
  let matchedFuzzy = 0;
  const enrichedMap = {};

  // Build map: artistSlug -> Map of songSlug -> item
  const artistToSongs = new Map();
  for (const [key, item] of htIndex.entries()) {
    if (!artistToSongs.has(item.artistSlug)) {
      artistToSongs.set(item.artistSlug, new Map());
    }
    artistToSongs.get(item.artistSlug).set(item.songSlug, item);
  }

  for (const track of tracks) {
    let htMatch = null;

    // 1. Direct match via track.sources (if present)
    if (track.sources) {
      const htSource = track.sources.find(s => s.id === 'hooktheory');
      if (htSource?.url) {
        const match = htSource.url.match(/theorytab\/view\/([^/#]+)\/([^/#]+)/);
        if (match) {
          const directKey = `${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
          if (htIndex.has(directKey)) {
            htMatch = htIndex.get(directKey);
            matchedDirect++;
          }
        }
      }
    }

    // 2. Exact slug match
    if (!htMatch) {
      const slugKey = `${slugify(track.artist)}/${slugify(track.title)}`;
      if (htIndex.has(slugKey)) {
        htMatch = htIndex.get(slugKey);
        matchedSlug++;
      }
    }

    // 3. Cleaned artist/title slug match
    if (!htMatch) {
      const cArtist = cleanArtist(track.artist);
      const cTitle = cleanTitle(track.title);
      const cleanKey = `${slugify(cArtist)}/${slugify(cTitle)}`;
      if (htIndex.has(cleanKey)) {
        htMatch = htIndex.get(cleanKey);
        matchedClean++;
      }
    }

    // 4. Substring/prefix title match for known artist
    if (!htMatch) {
      const a1 = slugify(track.artist);
      const a2 = slugify(cleanArtist(track.artist));
      const songMap = artistToSongs.get(a1) || artistToSongs.get(a2);
      if (songMap) {
        const tSlug = slugify(track.title);
        for (const [sSlug, item] of songMap.entries()) {
          if (
            tSlug.startsWith(sSlug + '-') ||
            tSlug.endsWith('-' + sSlug) ||
            tSlug.includes('-' + sSlug + '-')
          ) {
            htMatch = item;
            matchedFuzzy++;
            break;
          }
        }
      }
    }

    if (htMatch) {
      enrichedMap[track.id] = {
        artist: track.artist,
        title: track.title,
        key: track.key,
        bpm: track.bpm,
        url: htMatch.url,
        progressions: htMatch.clips.map(c => ({
          roman: c.roman,
          chords: c.chords,
          sourceKey: c.key,
        })),
      };
    }
  }

  const totalMatched = matchedDirect + matchedSlug + matchedClean + matchedFuzzy;
  console.log('\n=== Matching Results ===');
  console.log(`Direct URL matches:   ${matchedDirect}`);
  console.log(`Exact slug matches:   ${matchedSlug}`);
  console.log(`Cleaned slug matches: ${matchedClean}`);
  console.log(`Fuzzy title matches:  ${matchedFuzzy}`);
  console.log(`Total tracks matched: ${totalMatched} / ${tracks.length} (${((totalMatched / tracks.length) * 100).toFixed(1)}%)`);

  // Save to data/chord-progressions.json
  const outPath = 'data/chord-progressions.json';
  fs.writeFileSync(outPath, JSON.stringify(enrichedMap, null, 2));
  console.log(`\nSaved ${Object.keys(enrichedMap).length} enriched track chord progressions to ${outPath}!`);

  // Sample check
  const sampleIds = Object.keys(enrichedMap).slice(0, 5);
  console.log('\nSample enriched tracks:');
  for (const id of sampleIds) {
    const item = enrichedMap[id];
    console.log(`- ${item.artist} - ${item.title} (Key: ${item.key})`);
    for (const p of item.progressions) {
      console.log(`    ${p.roman}  [${p.chords}]`);
    }
  }
}

matchAll().catch(console.error);
