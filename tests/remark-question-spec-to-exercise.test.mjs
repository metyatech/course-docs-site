import assert from 'node:assert/strict';
import test from 'node:test';

const pluginModulePath = '../dist/mdx/remark-question-spec-to-exercise.js';

test('question-spec markdown transforms into <Exercise> + <Solution>', async () => {
  const { default: remarkQuestionSpecToExercise } = await import(pluginModulePath);

  const tree = {
    type: 'root',
    children: [
      { type: 'heading', depth: 1, children: [{ type: 'text', value: '問題1（テスト）' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Type' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'descriptive' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Prompt' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'ここが問題文です。' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Scoring' }] },
      { type: 'paragraph', children: [{ type: 'text', value: '3: 期待通り動作する' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Explanation' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'ここが解説です。' }] },
    ],
  };

  const transform = remarkQuestionSpecToExercise();
  transform(tree, { path: '/content/exams/q1.qspec.md' });

  assert.equal(tree.children.length, 1);
  const exercise = tree.children[0];
  assert.equal(exercise.type, 'mdxJsxFlowElement');
  assert.equal(exercise.name, 'Exercise');

  const hasSolution = (exercise.children ?? []).some(
    (child) => child?.type === 'mdxJsxFlowElement' && child?.name === 'Solution',
  );
  assert.equal(hasSolution, true);
});

test('cloze replaces {{answer}} with ${answer} (and keeps escaped \\\\{{)', async () => {
  const { default: remarkQuestionSpecToExercise } = await import(pluginModulePath);

  const tree = {
    type: 'root',
    children: [
      { type: 'heading', depth: 1, children: [{ type: 'text', value: '問題（穴埋め）' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Type' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'cloze' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Prompt' }] },
      {
        type: 'paragraph',
        children: [{ type: 'text', value: 'A={{a}} / literal=\\{{b}} / C={{c}}' }],
      },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Explanation' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'X={{x}}' }] },
    ],
  };

  const transform = remarkQuestionSpecToExercise();
  transform(tree, { path: '/content/exams/q2.qspec.md' });

  const exercise = tree.children[0];
  const allText = JSON.stringify(exercise);
  assert.match(allText, /\$\{a\}/);
  assert.match(allText, /\$\{c\}/);
  assert.match(allText, /\$\{x\}/);
  assert.match(allText, /\{\{b\}\}/);
});

test('cloze also replaces markers inside code blocks', async () => {
  const { default: remarkQuestionSpecToExercise } = await import(pluginModulePath);

  const tree = {
    type: 'root',
    children: [
      { type: 'heading', depth: 1, children: [{ type: 'text', value: '問題（コード）' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Type' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'cloze' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Prompt' }] },
      {
        type: 'code',
        lang: 'js',
        value: 'const x = {{answer}}; // and literal: \\{{notBlank}}',
      },
    ],
  };

  const transform = remarkQuestionSpecToExercise();
  transform(tree, { path: '/content/exams/q3.qspec.md' });

  const exercise = tree.children[0];
  const allText = JSON.stringify(exercise);
  assert.match(allText, /const x = \$\{answer\};/);
  assert.match(allText, /\{\{notBlank\}\}/);
});

test('headings inside question content get a stable id prefix per file', async () => {
  const { default: remarkQuestionSpecToExercise } = await import(pluginModulePath);

  const tree = {
    type: 'root',
    children: [
      { type: 'heading', depth: 1, children: [{ type: 'text', value: '問題（見出し）' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Type' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'descriptive' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Prompt' }] },
      { type: 'heading', depth: 3, children: [{ type: 'text', value: '解説' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'prompt content' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Explanation' }] },
      { type: 'heading', depth: 3, children: [{ type: 'text', value: '解説' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'explanation content' }] },
    ],
  };

  const transform = remarkQuestionSpecToExercise();
  transform(tree, { path: '/content/exams/x/prep/q1.qspec.md' });

  const exercise = tree.children[0];
  const allHeadings = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'heading') allHeadings.push(node);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  walk(exercise);

  // The plugin wraps content into <Exercise>, so headings live inside its children.
  // Ensure ids exist and are prefixed to avoid duplicates when multiple questions are imported on one page.
  const ids = allHeadings.map((h) => h.data?.hProperties?.id).filter(Boolean);
  assert.ok(ids.length >= 2);
  for (const id of ids) {
    assert.match(id, /^q1-/);
  }
});

test('### Exam under Prompt becomes a tip admonition', async () => {
  const { default: remarkQuestionSpecToExercise } = await import(pluginModulePath);

  const tree = {
    type: 'root',
    children: [
      { type: 'heading', depth: 1, children: [{ type: 'text', value: '問題（Exam）' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Type' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'descriptive' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Prompt' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'prompt body' }] },
      { type: 'heading', depth: 3, children: [{ type: 'text', value: 'Exam' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'exam note' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Explanation' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'answer' }] },
    ],
  };

  const transform = remarkQuestionSpecToExercise();
  transform(tree, { path: '/content/exams/x/prep/questions/q1.qspec.md' });

  const exercise = tree.children[0];
  const admonitions = (exercise.children ?? []).filter(
    (child) => child?.type === 'mdxJsxFlowElement' && child?.name === 'Admonition',
  );

  assert.equal(admonitions.length, 1);
  const tip = admonitions[0];
  const title = (tip.attributes ?? []).find((attr) => attr?.name === 'title')?.value;
  const type = (tip.attributes ?? []).find((attr) => attr?.name === 'type')?.value;
  assert.equal(type, 'tip');
  assert.equal(title, '本試験では');
});

test('non-qspec markdown under questions/ is not transformed', async () => {
  const { default: remarkQuestionSpecToExercise } = await import(pluginModulePath);

  const tree = {
    type: 'root',
    children: [
      { type: 'heading', depth: 1, children: [{ type: 'text', value: 'Not a question spec' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Prompt' }] },
      {
        type: 'paragraph',
        children: [{ type: 'text', value: 'Looks similar but should not transform.' }],
      },
    ],
  };

  const transform = remarkQuestionSpecToExercise();
  transform(tree, { path: '/content/exams/x/prep/questions/q1.md' });

  assert.equal(tree.children[0]?.type, 'heading');
  assert.equal(tree.children[0]?.depth, 1);
});

test('relative asset urls in qspec content resolve from qspec directory', async () => {
  const { default: remarkQuestionSpecToExercise } = await import(pluginModulePath);

  const tree = {
    type: 'root',
    children: [
      { type: 'heading', depth: 1, children: [{ type: 'text', value: '問題（相対URL）' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Type' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'descriptive' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Prompt' }] },
      {
        type: 'paragraph',
        children: [
          {
            type: 'image',
            url: '../img/js2-final-preparation-q2.gif',
            alt: '問題2の期待動作',
          },
        ],
      },
      {
        type: 'paragraph',
        children: [
          {
            type: 'link',
            url: '../assets/notes.pdf',
            children: [{ type: 'text', value: 'note' }],
          },
        ],
      },
      {
        type: 'paragraph',
        children: [
          { type: 'image', url: 'https://example.com/image.png', alt: 'external' },
        ],
      },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Explanation' }] },
      { type: 'paragraph', children: [{ type: 'text', value: '解説' }] },
    ],
  };

  const transform = remarkQuestionSpecToExercise();
  transform(tree, {
    path: '/content/exams/2025/2semester/2final-exam/preparation/questions/q2.qspec.md',
  });

  const exercise = tree.children[0];
  const allText = JSON.stringify(exercise);

  assert.match(
    allText,
    /"url":"\/exams\/2025\/2semester\/2final-exam\/preparation\/img\/js2-final-preparation-q2\.gif"/,
  );
  assert.match(
    allText,
    /"url":"\/exams\/2025\/2semester\/2final-exam\/preparation\/assets\/notes\.pdf"/,
  );
  assert.match(allText, /"url":"https:\/\/example\.com\/image\.png"/);
});
