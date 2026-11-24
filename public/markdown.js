import { lexer } from './vendor/marked-15.0.7.js';

const escapes = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'};
const escapeHtml = value => value.replace(/[&<>"']/g, character => escapes[character]);

function linkHref(href) {
  // Validate the same URL syntax browsers use, including for relative links.
  try {
    const url = new URL(href, 'https://example.invalid/');
    if (['https:', 'http:', 'mailto:'].includes(url.protocol)) return escapeHtml(href);
  } catch { /* Keep the link label when the destination is malformed. */ }
  return '';
}

function renderTokens(tokens) {
  return tokens.map(renderToken).join('');
}

function tableRow(cells, tag) {
  return '<tr>' + cells.map(cell => {
    const alignment = ['left', 'center', 'right'].includes(cell.align) ? ' align="' + cell.align + '"' : '';
    return '<' + tag + alignment + '>' + renderTokens(cell.tokens) + '</' + tag + '>';
  }).join('') + '</tr>';
}

function renderToken(token) {
  switch (token.type) {
    case 'space': return '\n';
    case 'br': return '<br>';
    case 'hr': return '<hr>';
    case 'strong':
    case 'em':
    case 'del': {
      const tag = token.type;
      return '<' + tag + '>' + renderTokens(token.tokens) + '</' + tag + '>';
    }
    case 'heading': {
      const tag = 'h' + token.depth;
      return '<' + tag + '>' + renderTokens(token.tokens) + '</' + tag + '>';
    }
    case 'paragraph': return '<p>' + renderTokens(token.tokens) + '</p>';
    case 'blockquote': return '<blockquote>' + renderTokens(token.tokens) + '</blockquote>';
    case 'codespan': return '<code>' + escapeHtml(token.text) + '</code>';
    case 'code': return '<pre><code>' + escapeHtml(token.text) + '</code></pre>';
    case 'list': {
      const tag = token.ordered ? 'ol' : 'ul';
      const start = token.ordered && Number.isSafeInteger(token.start) && token.start !== 1
        ? ' start="' + token.start + '"' : '';
      return '<' + tag + start + '>' + renderTokens(token.items) + '</' + tag + '>';
    }
    case 'list_item': {
      const marker = token.task ? (token.checked ? '☑ ' : '☐ ') : '';
      return '<li>' + marker + renderTokens(token.tokens) + '</li>';
    }
    case 'table':
      return '<div class="folio-markdown-table"><table><thead>' + tableRow(token.header,'th') +
        '</thead><tbody>' + token.rows.map(row=>tableRow(row,'td')).join('') + '</tbody></table></div>';
    case 'link': {
      const label = renderTokens(token.tokens);
      const href = linkHref(token.href);
      if (!href) return label;
      const title = token.title ? ' title="' + escapeHtml(token.title) + '"' : '';
      return '<a href="' + href + '"' + title + ' target="_blank" rel="noopener noreferrer">' + label + '</a>';
    }
    case 'image': return escapeHtml(token.text);
    case 'text': return token.tokens ? renderTokens(token.tokens) : escapeHtml(token.text);
    case 'html':
    case 'escape': return escapeHtml(token.text);
    default: return escapeHtml(token.raw || '');
  }
}

// Return self-contained HTML for a .folio-markdown container. Parse once per
// source edit. Raw HTML is always text and images never load external resources.
export function renderMarkdown(source) {
  try {
    return renderTokens(lexer(source, {gfm:true, breaks:true}));
  } catch {
    // A deeply nested paste can exceed the parser's recursion limit. Its source
    // still belongs to the player and must remain readable and editable.
    return '<pre>' + escapeHtml(source) + '</pre>';
  }
}
