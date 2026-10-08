# AGENTS.md

## Project: KeyDB

Build a modern, fast, open music **Key & BPM database** inspired by the useful parts of Duuzu's Google Sheet, but significantly improved as a dedicated DJ-oriented web application.

The goal is **not** to make another generic admin dashboard or spreadsheet clone.

The goal is to create a polished, fast, dark, DJ-friendly music database where users can:

- Search tracks
- Browse tracks
- Filter by BPM
- Filter by musical key
- Filter by Camelot key
- Filter by genre
- Filter by year
- Filter by label
- View detailed track information
- Find tracks that mix well with another track
- Understand key relationships visually
- Eventually contribute/correct data
- Eventually consume the underlying dataset from other tools

The underlying data should remain portable and preferably live in a GitHub repository as JSON/CSV.

---

# 1. Product Philosophy

The application should feel like a combination of:

- A professional DJ library
- Discogs-style music metadata browsing
- Rekordbox-style track preparation
- A very fast searchable database
- A better-designed version of Duuzu's key/BPM Google Sheet

It should NOT feel like:

- An enterprise admin dashboard
- A generic SaaS template
- An overly animated startup landing page
- A spreadsheet with CSS applied
- A card-heavy mobile app

Prioritize:

1. Speed
2. Clarity
3. Useful music information
4. Excellent search/filtering
5. DJ workflow
6. Clean visual hierarchy
7. Data portability
8. Maintainability

Keep the UI minimal and sophisticated.

---

# 2. Target Users

Primary users:

- DJs
- Producers
- Music collectors
- Remixers
- Music researchers
- People preparing DJ sets
- People looking for tracks by BPM/key
- Developers building music-analysis tools

The interface should work particularly well for users who already understand:

- BPM
- Musical keys
- Camelot notation
- Relative major/minor keys
- DJ mixing
- Labels/releases

Do not over-explain basic DJ concepts in the primary UI.

---

# 3. Core Data Model

The initial data model should support at least:

```json
{
  "id": "unique-id",
  "artist": "Example Artist",
  "title": "Example Track",
  "bpm": 128.0,
  "key": "F# minor",
  "camelot": "11A",
  "genre": "House",
  "label": "Example Records",
  "release": "Example EP",
  "year": 2026,
  "duration": 342,
  "source": "community",
  "confidence": 0.98,
  "lastVerified": "2026-10-06"
}
```

Design the schema so it can be expanded later.

Potential future fields:

```text
catalogNumber
releaseDate
isrc
mix
version
remixer
energy
danceability
loudness
sourceUrl
sourceType
submittedBy
verifiedBy
keySource
bpmSource
keyConfidence
bpmConfidence
analysisVersion
```

Do not unnecessarily implement every future field now.

---

# 4. Multiple Sources for BPM and Key

The architecture should allow multiple values/sources for BPM and key.

For example:

```text
BPM
128.00

Sources:
- MusicalKeyCNN
- Beatport
- Manual
- Community
```

and:

```text
KEY
F# minor

Camelot
11A

Sources:
- MusicalKeyCNN
- Mixed In Key
- Beatport
- Manual
```

Do not hard-code the assumption that one source is always correct.

The database should eventually be capable of showing:

- detected value
- normalized value
- source
- confidence
- verification status

This is especially important because automated music analysis can disagree with metadata sources.

---

# 5. Main Application Layout

Desktop-first, but responsive.

Preferred overall layout:

```text
┌───────────────────────────────────────────────────────────────┐
│ KEYDB                         Search tracks...          ☾ ⚙    │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  BROWSE                                                        │
│                                                               │
│  [ BPM ]       [ KEY ]       [ GENRE ]       [ YEAR ]         │
│                                                               │
│  FILTERS                                                       │
│  BPM      [120 ─────────●── 140]                              │
│  KEY      [All ▼]          CAMELOT [All ▼]                    │
│  GENRE    [All ▼]          LABEL   [All ▼]                    │
│  YEAR     [2020 ─────────●── 2026]                            │
│                                                               │
│  12,482 tracks                                                 │
│                                                               │
│  TRACK TABLE                                                    │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

Use a persistent top navigation/header.

Possible navigation:

```text
Browse
Mix Finder
Key Wheel
About
```

Do not add navigation items that do not have meaningful functionality.

---

# 6. Homepage

The homepage should immediately communicate what the application does.

Suggested structure:

```text
KEYDB

The open music Key & BPM database

[ Search artist, title, BPM, key, Camelot... ]

[ Browse Tracks ]
[ Mix Finder ]
[ Key Wheel ]

100,000+ tracks
25,000+ artists
5,000+ labels
```

Avoid a huge marketing hero.

The product itself is the hero.

---

# 7. Search

Search is one of the most important features.

It should support normal text:

```text
fred again
```

and preferably understand music-oriented queries:

```text
128 11A
```

```text
F#m 125-130
```

```text
house 128
```

```text
fred again 127
```

The parser does not need to be perfect initially.

At minimum:

- Full-text search artist/title
- BPM matching
- Key matching
- Camelot matching
- Genre matching
- Label matching

Search should feel instant.

Prefer client-side filtering for an initial static dataset if performance remains good.

---

# 8. Track Table

The main track browser should use a dense, professional table.

Recommended columns:

```text
ARTIST
TITLE
BPM
KEY
CAM
GENRE
LABEL
YEAR
```

Example:

```text
Fred again..     adore u                 127.0   F#m   11A   House    ...  2023
Peggy Gou        (It Goes Like) Nanana   130.0   Bm    10A   House    ...  2023
Fisher           Losing It               125.0   F#m   11A   Tech     ...  2018
```

Allow:

- Column sorting
- Filtering
- Pagination or virtualization
- Row hover
- Click row → track detail
- Copy useful values

Do not turn every row into a card.

Tables are appropriate here.

---

# 9. BPM Presentation

BPM should be displayed prominently but compactly.

Examples:

```text
128
127.5
124.0
```

Preserve decimal BPM internally.

Do not unnecessarily round all values to integers.

Support BPM range filtering:

```text
120 ─────────●──── 140
```

Eventually support:

```text
±1 BPM
±2 BPM
±4 BPM
±6 BPM
```

---

# 10. Key Presentation

Normalize key names consistently.

Example:

```text
F# minor
```

Camelot:

```text
11A
```

The UI can show:

```text
F#m   11A
```

Avoid inconsistent combinations such as:

```text
F#min
F-sharp minor
Gb minor
11A
```

unless the user explicitly chooses an alternate notation.

The underlying model should support normalization.

---

# 11. Camelot / Key Visualization

Create a visual Key Wheel page.

The wheel should show:

- Camelot numbers
- Major/minor distinction
- Adjacent compatible keys
- Current selected key

Example concept:

```text
             10A

       9A          11A

   8A                  12A

       9B          11B

             10B
```

A more polished circular Camelot wheel is preferred.

Clicking a key should filter the track database.

Example:

```text
11A
F# minor

Compatible:
10A
12A
11B
```

Do not overcomplicate the mathematics.

Use standard Camelot compatibility as the initial model.

---

# 12. Mix Finder

This is one of the main differentiating features.

A user selects a track:

```text
Current track

128 BPM
F# minor
11A
```

Then:

```text
Find tracks compatible with this track
```

Controls:

```text
BPM tolerance
[ ±4 BPM ]

Key compatibility
[x] Same key
[x] Adjacent Camelot
[x] Relative major/minor

Genre
[ Any ]

Label
[ Any ]
```

Results:

```text
TRACK                    BPM     KEY     CAM     Δ BPM
--------------------------------------------------------
Track A                  126     A       10A      -2
Track B                  128     F#m     11A       0
Track C                  129     F#      11B      +1
Track D                  130     C#m     12A      +2
```

Sort results by compatibility.

Potential future scoring:

```text
Mix Score: 94%
```

Do not pretend this score is scientifically meaningful unless the algorithm is explicitly defined.

Initially, show understandable reasons:

```text
Same key
+1 BPM
Adjacent Camelot
```

---

# 13. Track Detail Page

Clicking a track should open a dedicated detail view.

Example:

```text
← Back

FRED AGAIN..
adore u

127 BPM
F# minor
11A

Release
Actual Life 3

Label
Atlantic

Year
2023
```

Then:

```text
MIXABLE WITH THIS TRACK

126 BPM   10A
128 BPM   11A
129 BPM   11B
130 BPM   12A
```

Also show provenance:

```text
DATA

BPM: 127
Source: Beatport
Verified: 2026-10-06

Key: F# minor
Source: MusicalKeyCNN
Confidence: 0.98
```

Potential actions:

```text
Find Mixes
Copy BPM
Copy Key
Copy Camelot
Suggest Correction
```

---

# 14. Similar / Mixable Tracks

Every track detail page should eventually be able to show:

```text
SIMILAR / MIXABLE TRACKS
```

Prioritize:

1. Compatible key
2. BPM proximity
3. Same/related genre
4. Optional release/year proximity

Do not use opaque AI recommendations in the first version.

Deterministic recommendations are easier to understand and validate.

---

# 15. Database Mode

Provide an optional "Database" view for power users.

This should feel more like Duuzu's spreadsheet.

Dense table.

Potential columns:

```text
Artist
Title
Release
Label
BPM
Key
Camelot
Genre
Year
Source
Confidence
Verified
```

Users should be able to:

- Sort
- Filter
- Search
- Copy
- Export

CSV export should eventually be supported.

---

# 16. BPM × Key Explorer

Add an exploratory visualization.

Concept:

```text
                 BPM

        120 122 124 126 128 130 132

  8A      •   •       •••
  9A          •  ••
 10A      •       ••• •
 11A          •   •••••
 12A              ••
  1A      •       ••
```

Each point/cell represents tracks.

Clicking a cell should filter the database.

This is a secondary feature, not the main interface.

---

# 17. Data Provenance

Trust is important.

Every track should eventually be able to expose:

```text
SOURCE
Community
Beatport
Manual
MusicalKeyCNN
etc.

CONFIDENCE
98%

LAST VERIFIED
06 Oct 2026
```

Potential statuses:

```text
Verified
Community
Auto-detected
Needs review
Conflicting sources
```

Do not present uncertain data as absolute truth.

---

# 18. Contributions

The architecture should eventually support community contributions.

Potential flow:

```text
Suggest correction

Artist:
Title:
BPM:
Key:
Camelot:
Source:
Comment:
```

Initially this could simply create:

- GitHub issue
- Pull request
- JSON change request

There is no need to build a complicated account system initially.

---

# 19. Data Architecture

Prefer static data initially.

Recommended architecture:

```text
GitHub
│
├── data/
│   ├── tracks.json
│   └── tracks.csv
│
├── src/
│
├── public/
│
└── README.md
       │
       ▼
Cloudflare Pages / GitHub Pages
       │
       ▼
Web application
```

The website should not require a backend/database server for the initial version.

Keep the dataset portable.

The same data should eventually be usable by:

- Python scripts
- Audio analysis tools
- DJ utilities
- OrpheusDL-related tooling
- Other websites
- API consumers

---

# 20. Technology

Choose a modern, lightweight web stack.

Preferred:

- React
- TypeScript
- Vite
- Tailwind CSS or similarly lightweight styling
- A suitable table/virtualization library if needed

Do not introduce a backend unless genuinely required.

Avoid unnecessary dependencies.

The application should build into static assets.

The exact stack may be changed if there is a compelling technical reason, but simplicity and portability matter more than novelty.

---

# 21. Performance

Performance is a first-class requirement.

The application should feel instant when:

- Typing search queries
- Filtering BPM
- Selecting keys
- Sorting tables
- Opening track details

If the dataset becomes large:

- Use indexed search
- Use table virtualization
- Lazy-load secondary views
- Avoid rendering thousands of DOM rows
- Consider pre-generated search indexes

Do not prematurely introduce a server/database.

---

# 22. Responsive Design

Desktop is the primary target.

Still support:

- Laptop
- Tablet
- Mobile

On mobile, the track table can become a compact list.

Do not simply shrink the desktop table until it becomes unusable.

Example mobile row:

```text
Fred again..
adore u

127 BPM · F#m · 11A
2023 · Atlantic
```

---

# 23. Visual Design

Preferred style:

- Dark theme first
- Minimal
- Professional
- Modern
- DJ/software aesthetic
- High information density
- Excellent typography
- Subtle borders
- Restrained use of color
- Strong hover/focus states

Avoid:

- Huge gradients
- Excessive rounded cards
- Excessive shadows
- Glassmorphism everywhere
- Animated backgrounds
- Giant marketing text
- Excessive icons
- "AI startup" visual language

The application should look like serious music software.

---

# 24. Color Usage

Use color primarily to communicate music information.

Potential uses:

- Camelot key families
- Compatible keys
- BPM warnings
- Confidence
- Verification status

Do not color every table row.

Color should have semantic meaning.

---

# 25. Accessibility

Support:

- Keyboard navigation
- Visible focus states
- Semantic HTML
- Accessible table headers
- Proper labels
- Sufficient contrast
- Reduced motion preferences

Do not rely on color alone to communicate key information.

---

# 26. Dark / Light Mode

Dark mode should be the default.

Support light mode eventually.

Persist user preference.

Do not make dark mode simply "black everything".

Use several levels of surface/background contrast.

---

# 27. URLs / Routing

Tracks should have stable URLs.

Example:

```text
/track/fred-again-adore-u
```

Key:

```text
/key/11A
```

Camelot:

```text
/camelot/11A
```

Mix finder:

```text
/mix/11A/128
```

This makes pages shareable and searchable.

---

# 28. SEO

For public track pages:

- Proper title
- Meta description
- Open Graph metadata
- Canonical URLs
- Semantic HTML

Example:

```text
Fred again.. – adore u | 127 BPM | F# minor | 11A
```

Do not generate thousands of meaningless pages solely for SEO.

---

# 29. Export

Eventually provide:

```text
Export CSV
Export JSON
```

Potential future:

```text
Download filtered results
```

For example:

```text
128 BPM ±2
11A compatible
House
```

→ export only matching tracks.

---

# 30. Future API

Keep the data structure API-friendly.

Potential future endpoints:

```text
/tracks
/tracks/:id
/search
/key/:camelot
/bpm/:bpm
/mix/:id
```

Do not build a full API now unless needed.

The static JSON should be considered the first public data interface.

---

# 31. Important Future Integration

The creator also works with Python audio-analysis tooling and MusicalKeyCNN.

The project should therefore avoid locking key/BPM information into the website UI.

Eventually the database could contain analysis metadata such as:

```text
keySource: MusicalKeyCNN
keyConfidence: 0.94
bpmSource: beat-analysis
bpmConfidence: 0.99
analysisVersion: ...
```

This could eventually allow automatically analyzed tracks to enter the database.

Do not implement deep integration in v1.

Design for it.

---

# 32. Initial MVP

Do NOT attempt to build everything at once.

The first working version should contain:

### Must have

- Dark responsive UI
- Homepage
- Search
- Track table
- BPM filter
- Key filter
- Camelot filter
- Genre filter
- Year filter
- Sorting
- Track detail page
- Static JSON dataset
- Clean URL routing
- CSV/JSON data structure
- GitHub-ready project
- Build/deploy instructions

### Should have

- Key Wheel
- Mix Finder
- CSV export
- Source/confidence display

### Later

- User submissions
- GitHub integration
- BPM × Key visualization
- Multiple data sources
- Automated analysis
- Public API
- Accounts
- Advanced recommendations

---

# 33. Seed Data

For development, create a small realistic seed dataset.

At least 50–100 records.

Include:

- Different genres
- Different BPM ranges
- Major and minor keys
- Multiple Camelot positions
- Duplicate artists
- Duplicate labels
- Different years
- Decimal BPM values
- A few records with missing optional fields
- A few records with different confidence levels

Do NOT use fake famous-track data and present it as factual production data.

Clearly label development seed data.

---

# 34. Component Structure

Prefer reusable components.

Possible structure:

```text
src/
├── components/
│   ├── Header
│   ├── SearchBar
│   ├── FilterBar
│   ├── TrackTable
│   ├── TrackRow
│   ├── TrackDetail
│   ├── KeyBadge
│   ├── CamelotBadge
│   ├── BpmBadge
│   ├── KeyWheel
│   ├── MixFinder
│   └── EmptyState
│
├── data/
│   └── tracks.json
│
├── pages/
│   ├── Home
│   ├── Browse
│   ├── Track
│   ├── Key
│   └── MixFinder
│
├── lib/
│   ├── search
│   ├── key
│   ├── camelot
│   └── mix
│
└── types/
    └── track.ts
```

Adjust this structure if the chosen framework requires it.

---

# 35. Camelot Logic

Implement Camelot relationships explicitly.

For a given key:

```text
Same key
+1 Camelot
-1 Camelot
Relative major/minor
```

The exact compatibility rules should be isolated in one utility/module.

Do not scatter Camelot logic throughout UI components.

Example conceptual API:

```ts
getCompatibleKeys("11A")
```

returns:

```ts
["10A", "11A", "12A", "11B"]
```

---

# 36. Mix Score

If implemented, keep it explainable.

Example:

```text
score = keyCompatibility + bpmProximity + optionalGenreMatch
```

Do not create a mysterious ML score.

Display reasons:

```text
✓ Same key
✓ BPM within 1 BPM
✓ Same genre
```

rather than simply:

```text
97.43%
```

---

# 37. Error Handling

Handle:

- Missing data
- Invalid BPM
- Unknown key
- Unknown Camelot
- Missing label
- Missing year
- Malformed JSON

 gracefully.

Never crash the entire application because one track has malformed optional data.

---

# 38. Developer Experience

The repository should contain:

```text
README.md
AGENTS.md
package.json
```

README should explain:

- What KeyDB is
- How to install
- How to run locally
- How to build
- How to deploy
- Data schema
- How to add tracks

Provide:

```bash
npm install
npm run dev
npm run build
```

or equivalent.

---

# 39. GitHub / Deployment

The application should be deployable for free.

Preferred options:

1. Cloudflare Pages
2. GitHub Pages

The architecture should not require paid infrastructure.

Ideally:

```text
git push
   ↓
automatic build
   ↓
automatic deployment
```

Keep deployment configuration in the repository.

---

# 40. Do Not Overengineer

This is important.

Do not add:

- Authentication
- PostgreSQL
- Redis
- GraphQL
- Kubernetes
- Microservices
- Complex backend
- Paid APIs

unless a real requirement appears.

The first version should be capable of being hosted entirely as a static site.

---

# 41. Implementation Strategy

Build in this order:

## Phase 1

Create the project and visual shell.

Implement:

- Header
- Navigation
- Dark theme
- Homepage
- Search bar
- Basic track table

## Phase 2

Implement the actual data layer.

- Track type
- JSON dataset
- Search
- Sorting
- Filters
- Pagination/virtualization

## Phase 3

Implement track details.

- Track route
- Metadata
- Key/Camelot presentation
- Provenance

## Phase 4

Implement DJ functionality.

- Camelot compatibility
- Key Wheel
- Mix Finder

## Phase 5

Polish.

- Responsive design
- Accessibility
- Performance
- Empty states
- Loading states
- URL sharing
- Export

Do not move to Phase 5 until Phases 1–4 actually work.

---

# 42. Definition of Done for v1

The application is considered successful when a user can:

1. Open the website.
2. Search for an artist or track.
3. Filter by BPM.
4. Filter by key.
5. Filter by Camelot.
6. Sort the results.
7. Open a track.
8. See BPM, key and Camelot clearly.
9. See compatible keys.
10. Find compatible tracks.
11. Navigate directly to a track using its URL.
12. Use the site comfortably on desktop.
13. Understand where the data came from.
14. Run the entire project locally without a backend.
15. Deploy it for free.

---

# 43. Design Principle

When choosing between two implementations, prefer the one that makes the application feel more like **professional DJ software** and less like a generic website.

The database is the product.

The UI should get out of the way and make the music data exceptionally easy to explore.