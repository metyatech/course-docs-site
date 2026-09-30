import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Section from '../dist/mdx/tutorial/Section.js';

const render = (props) =>
  renderToStaticMarkup(
    React.createElement(
      Section,
      { title: '配置を確かめる', ...props },
      React.createElement('h2', null, '配置を確かめる'),
      React.createElement('p', null, '画面を確認します。'),
    ),
  );

test('Section renders at every depth without a goal, including a Learning Event', () => {
  for (const props of [
    {},
    { depth: 0 },
    { depth: 1 },
    { depth: 5 },
    {
      eventId: 'example-event',
      targets: 'example-unit',
      phase: 'initial',
      pattern: 'instruction-first',
    },
    { goal: '' },
    { goal: ' \t\n ' },
  ]) {
    const html = render(props);
    assert.match(html, /画面を確認します/);
    assert.doesNotMatch(html, /tutorial-section__goal/);
  }
});

test('Section preserves non-empty orientation between the heading and body', () => {
  const html = render({ goal: '自分の配置を比較できます' });
  assert.match(html, /tutorial-section__goal[^]*自分の配置を比較できます/);
  assert.ok(html.indexOf('</h2>') < html.indexOf('tutorial-section__goal'));
  assert.ok(html.indexOf('tutorial-section__goal') < html.indexOf('tutorial-section__body'));
});
