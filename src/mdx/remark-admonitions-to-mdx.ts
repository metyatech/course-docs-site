import { visit } from 'unist-util-visit';

const SUPPORTED_TYPES = new Set(['tip', 'info', 'note', 'caution', 'danger']);

const toMdxAttribute = (name: string, value: string) => ({
  type: 'mdxJsxAttribute',
  name,
  value,
});

export default function remarkAdmonitionsToMdx() {
  return function transform(tree: any) {
    visit(tree, (node: any) => {
      if (node.type !== 'containerDirective') return;
      if (!SUPPORTED_TYPES.has(node.name)) return;

      const admonitionType = node.name;
      const title =
        typeof node.label === 'string' && node.label.trim().length > 0
          ? node.label.trim()
          : undefined;

      node.type = 'mdxJsxFlowElement';
      node.name = 'Admonition';
      node.attributes = [
        toMdxAttribute('type', admonitionType),
        ...(title ? [toMdxAttribute('title', title)] : []),
      ];
      node.children = node.children ?? [];
    });
  };
}
