# Tutorial Shot Editor

Local authoring tool for step-by-step tutorial screenshots.

The editor keeps learner-facing tutorial image references in page-local `img/`
folders while moving the editable source of truth to:

- editable source image: `content/**/shots/*.raw.<source-extension>`
- shot manifest: `content/**/shots/*.shot.json`
- generated learner-facing image: `content/**/img/*.webp` for static UI screenshots and tested animated WebP uploads

## Why this exists

For Unreal tutorials, the main bottleneck is usually not taking the screenshot
itself but the follow-up editing work:

- cropping
- optionally marking one focal point with a box and, only when needed, a supporting arrow
- naming files
- rewriting images in the correct page-local folder
- checking whether the screenshot follows the focal-point annotation rules

This tool turns that into a deterministic pipeline:

`raw screenshot + crop + annotations -> generated WebP Action/Verify image`

## GUI pattern

Pattern: `hybrid-gui`

- Reused GUI subsystems:
  - `react-image-crop` for crop selection
  - `react-konva` / `konva` for box and arrow placement
  - `sharp` for deterministic policy-based image generation
- Custom glue:
  - scan `Action img="..."`
  - choose the learner-facing output path from the static-raster WebP policy
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
    - content/**/shots/*.raw.<source-extension>
  human_surface:
    - /dev/tutorial-shots
  ai_surface:
    - shot manifest JSON
    - MDX Action/Verify image references
  sync:
    direction: canonical_to_generated
    trigger:
      - Save Shot in the editor
      - future generate:tutorial-images CLI
  conflict_policy:
    - MDX stays authoritative for which Action/Verify image references exist
    - each Action/Verify reference is selected by its scanned source range and page revision, not by its image path
    - a stale page revision rejects the save before MDX or image artifacts are changed
    - saving one of several references to the same image branches only that reference to a collision-free `--<hex>.webp` path
    - shot manifest stays authoritative for crop/annotations
    - generated img/*.webp is overwritten from manifest on save for static UI screenshots and tested animated WebP uploads
    - legacy PNG Action/Verify references are rewritten to the policy WebP path on save
  validation:
    - client and server validation per annotation mode (focal: 0–1 box + 0–1 arrow; callout: N boxes, no arrows)
    - source-image imports accept browser-viewable PNG/APNG/JPEG/GIF/WebP/AVIF/SVG/BMP/ICO/CUR files
    - uploaded source images are decoded for validation, then persisted as the original accepted bytes and extension where supported
    - generated output is rendered from decoded pixels as lossless WebP by policy; raw files are never passed through as generated output
    - server path validation before read/write
    - repo tests for scan/save behavior
  generated_artifacts:
    - content/**/img/*.webp
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

| Scenario                    | Mode                       | Why                                                  |
| --------------------------- | -------------------------- | ---------------------------------------------------- |
| Click target / button       | Focal                      | One focal point is sufficient                        |
| Result confirmation         | Focal (no annotations)     | No callout needed                                    |
| Form with multiple settings | Callout                    | Splitting into N images would repeat the same dialog |
| Sequential UI interaction   | Focal (split into N shots) | Each shot shows one step                             |

Rule of thumb:

- focal image = WHERE (single point)
- callout image = WHERE (multiple numbered points)
- result-only image = STATE
- Action text = WHAT
- one image = one purpose

## Current Scope

MVP goals:

- detect existing `Action img="./img/...png"` / `Verify img="./img/...png"` references and migrate static UI output to WebP on save
- list repeated uses of the same image as independent editable references, including cross-page uses
- branch only the saved reference to an automatically suffixed image when its current image is shared
- bootstrap a raw source from the current output image when needed
- import source images through the upload button, drag-and-drop, or `Ctrl + V`
- save crop + annotations beside the page in `shots/`
- regenerate learner-facing static UI output as lossless WebP, and preserve frames for animated WebP raw uploads
- warn when screenshot text drifts away from tutorial-authoring rules
- allow a temporary local content-repo override when the site itself is running against a different source

Out of scope for the MVP:

- automatic Unreal capture
- animated GIF/APNG/AVIF preservation and SVG wrapper output
- video-to-frame inference
- multi-user conflict resolution UI
- publishing-ready asset review workflows
