import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown} from '../public/markdown.js';

test('headings, nested emphasis, quotes, lists and line breaks retain their structure',()=>{
  const html = renderMarkdown('# Minutes\n\n> **Lead _review_**\n\n3. check\n   - detail\n4. publish\n\n今天\n明天');
  assert.match(html,/<h1>Minutes<\/h1>/);
  assert.match(html,/<blockquote><p><strong>Lead <em>review<\/em><\/strong><\/p><\/blockquote>/);
  assert.match(html,/<ol start="3"><li>check<ul><li>detail<\/li><\/ul><\/li><li>publish<\/li><\/ol>/);
  assert.match(html,/<p>今天<br>明天<\/p>/);
});

test('fenced and inline code keep Markdown and HTML literal',()=>{
  const html = renderMarkdown('Use `**bold**`\n\n```html\n<main> & title\n```');
  assert.match(html,/<code>\*\*bold\*\*<\/code>/);
  assert.match(html,/<pre><code>&lt;main&gt; &amp; title<\/code><\/pre>/);
});

test('GFM tables preserve header, alignment, inline formatting and escaped pipes',()=>{
  const html = renderMarkdown('| Stage | Count |\n| --- | ---: |\n| **Review** | East\\|West |');
  assert.match(html,/<thead><tr><th>Stage<\/th><th align="right">Count<\/th>/);
  assert.match(html,/<tbody><tr><td><strong>Review<\/strong><\/td><td align="right">East\|West<\/td>/);
});

test('links validate their scheme, escape attributes and open separately from the game',()=>{
  const https = renderMarkdown('[**Review**](https://example.org/r?a=1&b=2 "Notes")');
  assert.equal(https,'<p><a href="https://example.org/r?a=1&amp;b=2" title="Notes" target="_blank" rel="noopener noreferrer"><strong>Review</strong></a></p>');
  assert.match(renderMarkdown('[inbox](mailto:team@example.org)'),/href="mailto:team@example.org"/);
  assert.doesNotMatch(renderMarkdown('[attachment](data:text/plain,hello) [local](file:///example)'),/<a\b/);
});

test('HTML and tracker images from a paste stay inert',()=>{
  const html = renderMarkdown('literal <b>text</b>\n\n![diagram](https://example.invalid/tracker.png)\n\n<img src="/sample">');
  assert.match(html,/literal &lt;b&gt;text&lt;\/b&gt;/);
  assert.match(html,/diagram/);
  assert.match(html,/&lt;img src=&quot;\/sample&quot;&gt;/);
  assert.doesNotMatch(html,/<img|<b>|tracker\.png/);
});
