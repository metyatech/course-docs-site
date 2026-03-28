import { visit } from 'unist-util-visit';
import type { Node } from 'unist';
import { buildUnsupportedAdmonitionMessage, resolveAdmonitionType } from './admonition-types.js';

const toMdxAttribute = (name: string, value: string) => ({
  type: 'mdxJsxAttribute',
  name,
  value,
});

type MdxAttribute = ReturnType<typeof toMdxAttribute>;

type DirectiveNode = Node & {
  type: string;
  name?: string;
  label?: string;
  attributes?: MdxAttribute[];
  children?: Node[];
};

type TransformFile = {
  fail?: (message: string, node?: unknown) => unknown;
};

const isDirectiveNode = (node: Node): node is DirectiveNode => node.type === 'containerDirective';

export default function remarkAdmonitionsToMdx() {
  return function transform(tree: Node, file: TransformFile) {
    visit(tree, (node: Node) => {
      if (!isDirectiveNode(node)) return;
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
