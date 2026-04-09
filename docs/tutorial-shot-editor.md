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
- adding boxes / arrows / short labels
- naming files
- rewriting images in the correct page-local folder
- checking whether screenshot text violates tutorial-authoring rules

This tool turns that into a deterministic pipeline:

`raw screenshot + crop + annotations -> generated Action image`

## GUI pattern

Pattern: `hybrid-gui`

- Reused GUI subsystems:
  - `react-image-crop` for crop selection
  - `react-konva` / `konva` for box, arrow, and label placement
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
    - client warnings for long labels / instruction-like text / dense annotations
    - server path validation before read/write
    - repo tests for scan/save behavior
  generated_artifacts:
    - content/**/img/*.png
  human_startup:
    - set COURSE_CONTENT_SOURCE to a local content repo
    - run npm run dev
    - open /dev/tutorial-shots
```

## Tutorial-Authoring Rules

The editor intentionally supports only a narrow annotation set:

- `box`
- `arrow`
- short `label`

It should not be used for long instruction sentences inside screenshots.

Rule of thumb:

- image = WHERE
- Action text = WHAT

If a label becomes a sentence, move that content back into the `Action` body.

## Current Scope

MVP goals:

- detect existing `Action img="./img/...png"` references without MDX migration
- bootstrap a raw source from the current output image when needed
- save crop + annotations beside the page in `shots/`
- regenerate the existing `img/*.png` file in place
- warn when screenshot text drifts away from tutorial-authoring rules

Out of scope for the MVP:

- automatic Unreal capture
- video-to-frame inference
- multi-user conflict resolution UI
- publishing-ready asset review workflows
