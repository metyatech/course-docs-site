import type { Node } from 'unist';

/**
 * Remark plugin that walks the MDX tree and, for every `<Section>` JSX element,
 *
 * 1. injects a markdown heading node as its first child, with depth derived
 *    from how many enclosing depth-contributing ancestors the node has (top-
 *    level Section becomes h2, its child becomes h3, ..., capped at h6); and
 * 2. attaches a numeric `depth` attribute to the Section element so the
 *    runtime component can render depth-aware styles without needing React
 *    Context (which would force the component to become a client boundary).
 *
 * Both `<Section>` and `<Exercise>` contribute to the depth counter. Treating
 * `<Exercise>` as a depth boundary lets extension-style exercises contain a
 * guided walkthrough (a nested `<Section>`) without the inner heading
 * colliding with, or overtaking, the exercise's own heading.
 *
 * The injected headings are normal `heading` AST nodes, so Nextra's downstream
 * `remark-headings` plugin picks them up automatically and they appear in the
 * page TOC and get anchor links from the themed heading components.
 *
 * The Section component itself is responsible for rendering the goal banner
 * after the first child (which is the heading injected here).
 */

type MdxAttribute = {
  type: 'mdxJsxAttribute';
  name: string;
  value: string | { type: string; value?: string } | null;
};

type MdxJsxFlowElement = Node & {
  type: 'mdxJsxFlowElement';
  name: string | null;
  attributes: MdxAttribute[];
  children: Node[];
};

type Parent = Node & { children: Node[] };

const isSection = (node: Node): node is MdxJsxFlowElement =>
  node.type === 'mdxJsxFlowElement' && (node as MdxJsxFlowElement).name === 'Section';

const isExercise = (node: Node): node is MdxJsxFlowElement =>
  node.type === 'mdxJsxFlowElement' && (node as MdxJsxFlowElement).name === 'Exercise';

const hasChildren = (node: Node): node is Parent => Array.isArray((node as Parent).children);

const getStringAttribute = (node: MdxJsxFlowElement, name: string): string | undefined => {
  const attr = node.attributes?.find((a) => a?.name === name);
  if (!attr) return undefined;
  if (typeof attr.value === 'string') return attr.value;
  return undefined;
};

const SECTION_HEADING_MARK = Symbol.for('course-docs.sectionHeadingInjected');

const isInjectedHeading = (node: Node): boolean =>
  node.type === 'heading' &&
  Boolean(
    (node as { data?: Record<string | symbol, unknown> }).data?.[
      SECTION_HEADING_MARK as unknown as string
    ],
  );

export default function remarkSectionHeadings() {
  return function transform(tree: Node) {
    const walk = (node: Node, sectionDepth: number) => {
      if (!hasChildren(node)) return;

      for (const child of node.children) {
        if (isSection(child)) {
          // Always attach the computed depth as an attribute so the runtime
          // component can render depth-aware styles. Replace any existing
          // depth attribute to stay idempotent across hot reloads.
          child.attributes = (child.attributes ?? []).filter((a) => a?.name !== 'depth');
          child.attributes.push({
            type: 'mdxJsxAttribute',
            name: 'depth',
            value: {
              type: 'mdxJsxAttributeValueExpression',
              value: String(sectionDepth),
              data: {
                estree: {
                  type: 'Program',
                  sourceType: 'module',
                  comments: [],
                  body: [
                    {
                      type: 'ExpressionStatement',
                      expression: {
                        type: 'Literal',
                        value: sectionDepth,
                        raw: String(sectionDepth),
                      },
                    },
                  ],
                },
              },
            },
          } as MdxAttribute);

          const title = getStringAttribute(child, 'title');
          if (title) {
            const headingDepth = Math.min(2 + sectionDepth, 6);

            // Idempotency: don't double-inject on hot reload / repeated runs.
            const alreadyInjected =
              child.children.length > 0 && isInjectedHeading(child.children[0]);

            if (!alreadyInjected) {
              const headingNode: Node = {
                type: 'heading',
                depth: headingDepth,
                children: [{ type: 'text', value: title }],
                data: { [SECTION_HEADING_MARK as unknown as string]: true },
              } as Node;
              child.children.unshift(headingNode);
            }
          }
          walk(child, sectionDepth + 1);
        } else if (isExercise(child)) {
          walk(child, sectionDepth + 1);
        } else {
          walk(child, sectionDepth);
        }
      }
    };

    walk(tree, 0);
  };
}
