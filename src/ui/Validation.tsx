import record from '../../docs/validation.md?raw';
import { codeSpans, parseMarkdown, type MarkdownBlock } from './markdown';
import './about.css';
import './validation.css';

const BLOCKS = parseMarkdown(record);

/** Text with its `code` spans marked up. */
function Inline({ text }: { text: string }) {
  return (
    <>{codeSpans(text).map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part))}</>
  );
}

/** True for the "Open:" line that starts a list of checks not yet done. */
const startsOpenList = (block: MarkdownBlock | undefined) =>
  block?.kind === 'paragraph' && block.text === 'Open:';

function Block({ block, open }: { block: MarkdownBlock; open: boolean }) {
  if (block.kind === 'heading')
    return block.level <= 2 ? (
      <h2 class="validation-heading">
        <Inline text={block.text} />
      </h2>
    ) : (
      <h3>
        <Inline text={block.text} />
      </h3>
    );
  if (block.kind === 'paragraph')
    return startsOpenList(block) ? (
      <p class="validation-open-title">Not yet checked</p>
    ) : (
      <p>
        <Inline text={block.text} />
      </p>
    );
  if (block.kind === 'list')
    return (
      <ul class={open ? 'validation-open' : undefined}>
        {block.items.map((item, i) => (
          <li key={i}>
            <Inline text={item} />
          </li>
        ))}
      </ul>
    );
  return (
    <div class="validation-table-scroll">
      <table class="validation-table">
        <thead>
          <tr>
            {block.header.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) =>
                c === 0 ? (
                  <th key={c} scope="row">
                    <Inline text={cell} />
                  </th>
                ) : (
                  <td key={c} data-label={block.header[c]}>
                    <Inline text={cell} />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The public validation page: how each numerical method was checked, against what, to what
 * tolerance, and which checks are still open. The content is docs/validation.md itself, so the
 * page always says what the project's own record says.
 */
export default function Validation() {
  const checks = BLOCKS.reduce((n, b) => n + (b.kind === 'table' ? b.rows.length : 0), 0);
  const openItems = BLOCKS.reduce(
    (n, b, i) => n + (b.kind === 'list' && startsOpenList(BLOCKS[i - 1]) ? b.items.length : 0),
    0,
  );
  return (
    <article class="about validation">
      <p class="back-link">
        <a href="#/about">← About</a>
      </p>
      <h1 class="page-title">How Plot Bhai is validated</h1>
      <p class="page-lead">
        A number you put in a paper has to be right. Each numerical method added to the XRD tool is
        checked three ways before it is released: on made-up data where the true answer is known,
        against another program or a published worked example, and by checks that the answer does
        not change when it should not (for example when the data are shifted or scaled).
      </p>
      <ul class="validation-summary">
        <li>
          <strong>{checks}</strong> recorded checks, each with its source and tolerance
        </li>
        <li>
          <strong>{openItems}</strong> checks not yet done, listed openly under each section
        </li>
        <li>
          Every check is a test in the{' '}
          <a href="https://github.com/shumsularefin/Plot-bhai" rel="noopener noreferrer">
            public source code
          </a>
          , run again on every change
        </li>
      </ul>
      <p>
        The record below is the project's own working file, shown unedited. Results are estimates
        from models; a passed check shows the calculation is done correctly, not that a model suits
        your sample.
      </p>
      {BLOCKS.slice(1).map((block, i) => (
        <Block key={i} block={block} open={startsOpenList(BLOCKS[i])} />
      ))}
    </article>
  );
}
