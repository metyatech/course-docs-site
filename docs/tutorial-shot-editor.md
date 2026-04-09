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
- marking one focal point with a box and, only when needed, a supporting arrow
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
  - run tutorial-authoring warnings on image-internal text

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
    - client and server validation for one box, optional one arrow, and no labels
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

The editor intentionally supports only a narrow annotation set:

- `box`
- `arrow`

Every saved image must contain exactly one `box`. An `arrow` is optional and is
allowed only as a helper for that same focal point.

Rule of thumb:

- image = WHERE
- Action text = WHAT
- one image = one focal point

If you need to explain multiple places or multiple ordered actions, split the
image into separate tutorial shots instead of numbering many callouts in one
frame.

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
