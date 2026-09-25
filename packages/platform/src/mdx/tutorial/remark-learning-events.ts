import type { Node } from 'unist';
import { collectLearningContent } from './learning-model.js';

type File = { path?: string; fail: (message: string, node?: Node) => never };

export default function remarkLearningEvents() {
  return function transform(tree: Node, file: File) {
    const page = file.path ?? '<unknown page>';
    const analysis = collectLearningContent(tree, page);
    const firstError = analysis.issues.find((issue) => issue.severity === 'error');
    if (firstError) file.fail(firstError.message, tree);
  };
}
