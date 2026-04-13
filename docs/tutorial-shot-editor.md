# Tutorial Shot Editor

Local authoring tool for step-by-step tutorial screenshots.

The editor keeps learner-facing `Action img="./img/...png"` usage intact while
moving the editable source of truth to:

- raw screenshot: `content/**/shots/*.raw.png`
- shot manifest: `content/**/shots/*.shot.json`
- generated learner-facing image: `content/**/img/*.png`

## Why this exists

For Unreal tutorials, the main bottleneck is usually not taking the screenshot
itself but the follow-up editing work:

- cropping
- optionally marking one focal point with a box and, only when needed, a supporting arrow
- naming files
- rewriting images in the correct page-local folder
- checking whether the screenshot follows the focal-point annotation rules

This tool turns that into a deterministic pipeline:

`raw screenshot + crop + annotations -> generated Action image`

## GUI pattern

Pattern: `hybrid-gui`

- Reused GUI subsystems:
  - `react-image-crop` for crop selection
  - `react-konva` / `konva` for box and arrow placement
  - `sharp` for deterministic PNG generation
- Custom glue:
  - scan `Action img="..."`
  - keep output image paths stable
  - save shot manifests beside each tutorial page
  - validate when annotations are absent, box-led, or invalid

## Project Contract

```yaml
project-contract:
  system: tutorial-shot-editor
  actors:
    - human-author
    - ai-agent
  canonical_store:
    - content/**/index.mdx
    - content/**/shots/*.shot.json
    - content/**/shots/*.raw.png
    - content/**/shots/*.raw.jpg
    - content/**/shots/*.raw.webp
  human_surface:
    - /dev/tutorial-shots
  ai_surface:
    - shot manifest JSON
    - MDX Action image references
  sync:
    direction: canonical_to_generated
    trigger:
      - Save Shot in the editor
      - future generate:tutorial-images CLI
  conflict_policy:
    - MDX stays authoritative for which Action images exist
    - shot manifest stays authoritative for crop/annotations
    - generated img/*.png is overwritten from manifest on save
  validation:
    - client and server validation per annotation mode (focal: 0–1 box + 0–1 arrow; callout: N boxes, no arrows)
    - server path validation before read/write
    - repo tests for scan/save behavior
  generated_artifacts:
    - content/**/img/*.png
  human_startup:
    - set COURSE_CONTENT_SOURCE to a local content repo
    - run npm run dev
    - open /dev/tutorial-shots
    - if the site is running against a remote or different repo, choose a local override path inside the editor
```

## Tutorial-Authoring Rules

The editor supports two annotation modes:

### Focal mode (default)

For images that highlight a single click target or UI element.

- At most one `box` and one optional `arrow`.
- If an image only confirms a resulting state, save it without annotations.

### Callout mode

For images that show multiple settings or UI areas in a single dialog
(e.g. a project settings form with several fields).

- Multiple `box` annotations, each automatically numbered (①②③…).
- No `arrow` allowed — the number badge serves as the visual anchor.
- The numbered boxes map to a corresponding table in the Action text.

### Choosing a mode

| Scenario | Mode | Why |
|---|---|---|
| Click target / button | Focal | One focal point is sufficient |
| Result confirmation | Focal (no annotations) | No callout needed |
| Form with multiple settings | Callout | Splitting into N images would repeat the same dialog |
| Sequential UI interaction | Focal (split into N shots) | Each shot shows one step |

Rule of thumb:

- focal image = WHERE (single point)
- callout image = WHERE (multiple numbered points)
- result-only image = STATE
- Action text = WHAT
- one image = one purpose

## Current Scope

MVP goals:

- detect existing `Action img="./img/...png"` references without MDX migration
- bootstrap a raw source from the current output image when needed
- save crop + annotations beside the page in `shots/`
- regenerate the existing `img/*.png` file in place
- warn when screenshot text drifts away from tutorial-authoring rules
- allow a temporary local content-repo override when the site itself is running against a different source

Out of scope for the MVP:

- automatic Unreal capture
- video-to-frame inference
- multi-user conflict resolution UI
- publishing-ready asset review workflows
