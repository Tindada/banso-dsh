import type {} from 'remark-parse';
import type { Root, RootContent, Paragraph, Parents } from 'mdast';
import type { Extension, Tokenizer, State } from 'micromark-util-types';
import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown';
import type { Processor } from 'unified';

declare module 'micromark-util-types' {
  interface TokenTypeMap { bansoLatex: 'bansoLatex'; bansoLatexData: 'bansoLatexData' }
}

// Parse before Markdown's backslash escapes. Code spans and code blocks are
// already opaque to text constructs, so their contents never reach this parser.
const tokenize: Tokenizer = function (effects, ok, nok) {
  let closing: number;
  const start: State = code => {
    effects.enter('bansoLatex');
    effects.consume(code);
    return opening;
  };
  const opening: State = code => {
    if (code !== 40 && code !== 91) return nok(code);
    closing = code === 40 ? 41 : 93;
    effects.consume(code);
    return body;
  };
  const body: State = code => {
    if (code === null) return nok(code);
    if (code === -5 || code === -4 || code === -3) {
      effects.enter('lineEnding');
      effects.consume(code);
      effects.exit('lineEnding');
    } else {
      effects.enter('bansoLatexData');
      effects.consume(code);
      effects.exit('bansoLatexData');
    }
    return code === 92 ? afterSlash : body;
  };
  const afterSlash: State = code => {
    if (code === closing) {
      effects.consume(code);
      effects.exit('bansoLatex');
      return ok;
    }
    // Consume escaped backslashes as a pair, so \\) is not a closing marker.
    if (code === 92) { effects.consume(code); return body; }
    return body(code);
  };
  return start;
};

export default function remarkLatex(this: Processor) {
  const syntax: Extension = { text: { 92: { name: 'bansoLatex', tokenize } } };
  const fromMarkdown: FromMarkdownExtension = {
    enter: {
      bansoLatex(token) {
        const source = this.sliceSerialize(token);
        const value = source.slice(2, -2).trim();
        this.enter({
          type: 'inlineMath', value,
          data: {
            hName: 'code',
            hProperties: { className: ['language-math', source[1] === '[' ? 'math-display' : 'math-inline'] },
            hChildren: [{ type: 'text', value }],
          },
        }, token);
        this.buffer();
      },
    },
    exit: { bansoLatex(token) { this.resume(); this.exit(token); } },
  };
  const data = this.data();
  (data.micromarkExtensions ||= []).push(syntax);
  (data.fromMarkdownExtensions ||= []).push(fromMarkdown);
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    // Only inspect parsed math nodes: code and escaped dollars stay untouched.
    const visit = (parent: Parents) => {
      const result: RootContent[] = [];
      for (const child of parent.children) {
        if (child.type !== 'paragraph') {
          if ('children' in child) visit(child);
          result.push(child);
          continue;
        }
        let pending: Paragraph['children'] = [];
        const flush = () => {
          if (pending.some(node => node.type !== 'text' || node.value.trim())) {
            result.push({ type: 'paragraph', children: pending });
          }
          pending = [];
        };
        for (const node of child.children) {
          const start = node.position?.start.offset;
          const end = node.position?.end.offset;
          const raw = start === undefined || end === undefined ? '' : source.slice(start, end);
          const lineStart = start === undefined ? 0 : source.lastIndexOf('\n', start - 1) + 1;
          const nextLine = end === undefined ? -1 : source.indexOf('\n', end);
          const lineEnd = nextLine < 0 ? source.length : nextLine;
          if (node.type === 'inlineMath' && /^\$\$[^$][\s\S]*\$\$$/.test(raw) &&
              !raw.includes('\n') && source.slice(lineStart, start).trim() === '' &&
              source.slice(end, lineEnd).trim() === '') {
            flush();
            result.push({ type: 'math', value: node.value, position: node.position, data: {
              hName: 'pre', hChildren: [{ type: 'element', tagName: 'code',
                properties: { className: ['language-math', 'math-display'] },
                children: [{ type: 'text', value: node.value }] }],
            } });
          } else pending.push(node);
        }
        flush();
      }
      // Every replacement of a paragraph is valid in its original block container.
      parent.children = result as typeof parent.children;
    };
    visit(tree);
  };
}
