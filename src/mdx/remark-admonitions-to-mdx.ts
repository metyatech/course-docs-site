import { visit } from 'unist-util-visit';
import { buildUnsupportedAdmonitionMessage, resolveAdmonitionType } from './admonition-types.js';

const toMdxAttribute = (name: string, value: string) => ({
  type: 'mdxJsxAttribute',
  name,
  value,
});

export default function remarkAdmonitionsToMdx() {
  return function transform(tree: any, file: any) {
    visit(tree, (node: any) => {
      if (node.type !== 'containerDirective') return;
      if (typeof node.name !== 'string') return;

      const admonitionType = resolveAdmonitionType(node.name.trim());
      if (!admonitionType) {
        const message = buildUnsupportedAdmonitionMessage(node.name.trim());
        if (typeof file?.fail === 'function') {
          throw file.fail(message, node);
        }
        throw new Error(message);
      }

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
