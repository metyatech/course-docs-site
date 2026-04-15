import fs from 'node:fs';
import path from 'node:path';
import { visit, EXIT } from 'unist-util-visit';
import type { Node } from 'unist';

/**
 * Remark plugin that automatically injects a `<Concept>` legend before the
 * first `<Action img="./img/<name>.png">` whose corresponding
 * `./shots/<name>.shot.json` contains a mix of `"verify"` and `"action"`
 * annotation roles.
 *
 * Purpose: when a tutorial-shot image uses redundant visual coding (white
 * dashed boxes for verify items, orange solid boxes for action items), the
 * learner needs the legend exactly once per page — before the first such
 * shot. Authors must not repeat the colour description in every Action text
 * (Redundancy principle) and must not write the legend manually per page
 * (DRY). This plugin is the single source of truth for the auto-legend.
 *
 * Visual description constants:
 *   VERIFY_VISUAL / ACTION_VISUAL — update these when the stroke colours
 *   or line styles in tutorial-shots-shared.mjs (course-docs-site) change.
 */

// Single source of truth for legend text. When the visual style changes in
// tutorial-shots-shared.mjs, update VERIFY_VISUAL and ACTION_VISUAL here too.
const VERIFY_VISUAL = '白い破線';
const ACTION_VISUAL = 'オレンジの実線';

type MdxAttributeValue = string | null | { type: 'mdxJsxAttributeValueExpression'; value?: string };

type MdxAttribute = {
  type: 'mdxJsxAttribute';
  name: string;
  value: MdxAttributeValue;
};

type MdxJsxElement = Node & {
  type: 'mdxJsxFlowElement' | 'mdxJsxTextElement';
  name: string | null;
  attributes: MdxAttribute[];
  children: Node[];
};

type Parent = Node & { children: Node[] };

type ShotAnnotation = {
  role?: 'verify' | 'action';
};

type ShotManifest = {
  annotations?: ShotAnnotation[];
};

const getStringAttr = (node: MdxJsxElement, attrName: string): string | undefined => {
  const attr = node.attributes?.find((a) => a?.name === attrName);
  if (!attr) return undefined;
  if (typeof attr.value === 'string') return attr.value;
  return undefined;
};

// Derives the shot.json path from the img attribute value.
// Expects: "./img/<stem>.png" → "<mdxDir>/shots/<stem>.shot.json"
const deriveShotJsonPath = (mdxDir: string, imgAttr: string): string | null => {
  const m = /^\.\/img\/(.+)\.png$/.exec(imgAttr);
  if (!m) return null;
  return path.join(mdxDir, 'shots', `${m[1]}.shot.json`);
};

// True if the shot has at least one "verify" and at least one "action" role.
const isMixedRoleShot = (manifest: ShotManifest): boolean => {
  const anns = manifest.annotations ?? [];
  return anns.some((a) => a.role === 'verify') && anns.some((a) => a.role === 'action');
};

// Builds a paragraph AST node with a leading bold segment and a plain-text tail.
const boldParagraph = (bold: string, rest: string): Node =>
  ({
    type: 'paragraph',
    children: [
      { type: 'strong', children: [{ type: 'text', value: bold }] },
      { type: 'text', value: rest },
    ],
  }) as Node;

// Builds the <Concept> MDX AST node containing the verify/action legend.
const buildLegendNode = (): Node =>
  ({
    type: 'mdxJsxFlowElement',
    name: 'Concept',
    attributes: [
      {
        type: 'mdxJsxAttribute',
        name: 'title',
        value: '画像のボックスの見方',
      },
    ],
    children: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'text',
            value:
              'この手順では、画像のボックスの線の種類で「確認する項目」と「操作する項目」を区別しています。',
          },
        ],
      },
      {
        type: 'list',
        ordered: false,
        spread: false,
        children: [
          {
            type: 'listItem',
            spread: false,
            children: [
              boldParagraph(
                VERIFY_VISUAL,
                'のボックス → 確認項目（画像と同じ状態になっているか見比べます）',
              ),
            ],
          },
          {
            type: 'listItem',
            spread: false,
            children: [
              boldParagraph(
                ACTION_VISUAL,
                'のボックス → 操作項目（実際に入力またはクリックします）',
              ),
            ],
          },
        ],
      },
    ],
  }) as Node;

export default function remarkInjectTutorialShotLegend() {
  return (tree: Node, vfile: { path?: string }): void => {
    if (!vfile.path) return;
    const mdxDir = path.dirname(vfile.path);

    visit(
      tree,
      'mdxJsxFlowElement',
      (node: Node, index: number | undefined, parent: Parent | undefined) => {
        const jsx = node as MdxJsxElement;
        if (jsx.name !== 'Action') return;
        if (index == null || !parent) return;

        const imgAttr = getStringAttr(jsx, 'img');
        if (!imgAttr) return;

        const shotPath = deriveShotJsonPath(mdxDir, imgAttr);
        if (!shotPath || !fs.existsSync(shotPath)) return;

        let manifest: ShotManifest;
        try {
          manifest = JSON.parse(fs.readFileSync(shotPath, 'utf-8')) as ShotManifest;
        } catch {
          return;
        }

        if (!isMixedRoleShot(manifest)) return;

        // Inject once before the first mixed-role Action found.
        (parent.children as Node[]).splice(index, 0, buildLegendNode());
        return EXIT;
      },
    );
  };
}
