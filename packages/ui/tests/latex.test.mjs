import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkLatex from '../lib/types/client/remark-latex.js';
const parse = text => {
  const processor = unified().use(remarkParse).use(remarkMath).use(remarkLatex);
  return processor.runSync(processor.parse(text), { value: text });
};
function nodes(tree, type) {
  return [...(tree.type === type ? [tree] : []), ...(tree.children || []).flatMap(child => nodes(child, type))];
}
test('both LaTeX delimiters preserve TeX commands and coexist with dollar math', () => {
  const tree = parse(String.raw`Inline \(Q\), \(35\times20=700\), $x$.

\[
Q=\frac{300}{15}=20
\]

$$
y=2
$$`);
  assert.deepEqual(nodes(tree, 'inlineMath').map(node => node.value), ['Q', String.raw`35\times20=700`, 'x', String.raw`Q=\frac{300}{15}=20`]);
  assert.ok(nodes(tree, 'inlineMath').at(-1).data.hProperties.className.includes('math-display'));
  assert.equal(nodes(tree, 'math')[0].value, 'y=2');
});
test('code spans, fenced code, indented code and escaped delimiters stay literal', () => {
  const tree = parse('`\\(x\\)` and ``\\[y\\]``\n\n```tex\n\\(x\\)\n\\[y\\]\n```\n\n~~~tex\n\\(z\\)\n~~~\n\n    \\[indented\\]\n\n' + String.raw`\\(escaped\\) and (ordinary) [brackets]`);
  assert.equal(nodes(tree, 'inlineMath').length, 0);
  assert.deepEqual(nodes(tree, 'inlineCode').map(node => node.value), [String.raw`\(x\)`, String.raw`\[y\]`]);
  assert.equal(nodes(tree, 'code').length, 3);
  assert.match(nodes(tree, 'code')[0].value, /\\\(x\\\)/);
});
test('incomplete streaming delimiters do not throw or consume later paragraphs', () => {
  const source = String.raw`Answer \(x+1\) and \[\frac{1}{2}\]`;
  for (let i = 0; i <= source.length; i++) assert.doesNotThrow(() => parse(source.slice(0, i)));
  assert.equal(nodes(parse('\\(unfinished\n\nNext paragraph'), 'inlineMath').length, 0);
  assert.equal(nodes(parse(source), 'inlineMath').length, 2);
  const multiline = String.raw`\[
Q=\frac{300}{15}
\]`;
  for (let i = 0; i <= multiline.length; i++) assert.doesNotThrow(() => parse(multiline.slice(0, i)));
  assert.equal(nodes(parse('> ' + String.raw`\(Q\)` + '\n\n- ' + String.raw`\(x\)`), 'inlineMath').length, 2);
});

test('single-line dollar blocks preserve code, inline math and incomplete streams', () => {
  const text = '**Heading**\n$$x=1$$\nAfter\n\n`$$code$$`\n\n```tex\n$$code$$\n```\n\n    $$indented$$\n\nText $$inline$$ and $x$.\n\n\\$$escaped$$';
  const tree = parse(text);
  assert.equal(nodes(tree, 'math').length, 1);
  assert.equal(tree.children[0].type, 'paragraph');
  assert.equal(tree.children[1].type, 'math');
  assert.equal(tree.children[2].type, 'paragraph');
  assert.equal(nodes(tree, 'code').length, 2);
  assert.equal(nodes(tree, 'inlineCode')[0].value, '$$code$$');
  assert.equal(nodes(tree, 'inlineMath').length, 2);
  const stream = '**Heading**\n$$x=1$$';
  for (let i = 0; i <= stream.length; i++) assert.doesNotThrow(() => parse(stream.slice(0, i)));
});
