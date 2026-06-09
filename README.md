# AIT Procedure Runner

Offline-first procedure checklist web app designed for the 600 x 600 Meta Display Glasses viewport and D-pad input.

## Features

- Three aerospace AIT procedure templates
- Sequential or flexible execution policy per template
- Step completion timestamps, notes, tags, and mock photo evidence
- Optional descriptive reference images on individual steps
- Persistent runs and generated exports in IndexedDB
- JSON and CSV export preview, download, and deletion
- Fully offline runtime after the service worker caches the app

## Repository Structure

```text
.
├── index.html
├── manifest.webmanifest
├── sw.js
├── src/
│   ├── app.js
│   ├── core.js
│   ├── storage.js
│   ├── styles.css
│   ├── templates.js
│   └── procedure-templates/
│       └── <template-id>/
│           ├── template.json
│           └── assets/
├── tests/
├── package.json
└── favicon.png
```

`index.html`, the manifest, and service worker remain at the repository root so the service worker can control the complete application scope. Runtime code and packaged procedure content live under `src/`.

## Run Locally

```bash
npm install
npm run serve
```

Open [http://127.0.0.1:4174/](http://127.0.0.1:4174/).

Use arrow keys to move focus, Enter to activate the focused control, and Escape to go back.

## Verification

```bash
npm test
npm run check
```

## Template Packages

Each template has its own folder. `template.json` contains template metadata, execution policy, and procedure steps. Assets referenced by that template stay in the adjacent `assets/` folder.

Every step declares an `images` array. Use `[]` when no descriptive media is needed; add multiple entries to attach several reference images to one step:

```json
{
  "id": "EP-010",
  "title": "Authorize ignition",
  "description": "Perform the authorized ignition sequence.",
  "images": [
    {
      "src": "assets/ion-thruster-plume.jpg",
      "alt": "Xenon ion thruster operating in a vacuum chamber.",
      "caption": "Reference view of a xenon ion engine operating under vacuum.",
      "credit": "NASA/JPL",
      "sourceUrl": "https://science.nasa.gov/photojournal/deep-space-1s-ion-engine-2/"
    }
  ]
}
```

The step detail UI renders the reference card only when `images` is non-empty. It is labeled `Image` for a single entry or `N images` for several, and the full-screen viewer pages through multiple images with the left and right controls.

## Reference Imagery

The demonstration images are locally optimized copies of NASA media and retain credit and source metadata in their template files:

- Electric propulsion chamber: NASA, [Journey to Space in a Vacuum Chamber](https://www.nasa.gov/image-article/journey-space-vacuum-chamber/)
- Space Environments Complex thermal-vacuum facility: NASA/Glenn Research Center, [Orion at the Space Environments Complex](https://images.nasa.gov/details/GRC-2020-C-03345)
- Ion thruster plume: NASA/JPL, [Deep Space 1's Ion Engine](https://science.nasa.gov/photojournal/deep-space-1s-ion-engine-2/)
- NEXT ion engine in vacuum chamber: NASA/Glenn Research Center, [NEXT Ion Engine Wear Test](https://images.nasa.gov/details/GRC-2003-C-00585)
- Imaging spectrometer TVAC installation: NASA/JPL-Caltech, [Imaging Spectrometer Inside Thermal Vacuum Chamber](https://science.nasa.gov/photojournal/imaging-spectrometer-inside-thermal-vacuum-chamber/)
- Coronagraph optical test chamber: NASA/JPL-Caltech, [Coronagraph Test Chamber](https://science.nasa.gov/photojournal/coronagraph-test-chamber/)
- Antenna prototype test: NASA/Langley, [Europa Clipper Antenna Prototype](https://science.nasa.gov/photojournal/europa-clipper-antenna-prototype/)
- High-gain antenna gimbal test: NASA/KSC, [Mars Reconnaissance Orbiter Antenna Test](https://images.nasa.gov/details/05pd1113)
- RF anechoic chamber: NASA/Chris Gunn, [Roman High-Gain Antenna Environmental Tests](https://www.nasa.gov/image-article/high-gain-antenna-nasas-roman-mission-clears-environmental-tests/)

NASA media use remains subject to the [NASA Brand Center and media guidelines](https://www.nasa.gov/nasa-brand-center/).

## Procedure Content

The included procedures are realistic engineering examples. Organizations should review identifiers, limits, approvals, configuration controls, and safety gates against their own released procedures before operational use.
