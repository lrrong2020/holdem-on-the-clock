import test from 'node:test';
import assert from 'node:assert/strict';
import {splitGeometry} from '../public/splitter.js';

test('sidebar preferences are pixel widths and leave sufficient room for the main panel', () => {
  assert.equal(splitGeometry('sidebar',1440,1440).first,228);
  assert.equal(splitGeometry('sidebar',1000,1000).first,198);
  assert.equal(splitGeometry('sidebar',1440,1440,307).first,307);
  const narrow = splitGeometry('sidebar',790,790,307);
  assert.equal(narrow.first,narrow.max);
  assert.equal(narrow.space - narrow.first,520);
  assert.equal(splitGeometry('sidebar',1440,1440,4000).first,400);
  assert.equal(splitGeometry('sidebar',780,780).inline,false);
});

test('nested splits retain proportions while both panes stay inside the available space', () => {
  for (const name of ['document','terminal','table']) {
    const wide = splitGeometry(name,1120,1440,0.6);
    const narrow = splitGeometry(name,850,1200,0.6);
    assert.ok(wide.inline && narrow.inline);
    assert.equal(wide.first,Math.round((1120 - wide.gutter) * 0.6));
    assert.equal(narrow.first,Math.round((850 - narrow.gutter) * 0.6));
    assert.equal(splitGeometry(name,1120,1440,0.01).first,wide.min);
    assert.equal(splitGeometry(name,1120,1440,0.99).first,wide.max);
    assert.equal(wide.space + wide.gutter,1120);
    assert.equal(splitGeometry(name,1120,1440,NaN).first,splitGeometry(name,1120,1440).first);
  }
});

test('stacked views respond to both narrow viewports and their own available width', () => {
  assert.equal(splitGeometry('document',632,1100,0.3,672).inline,false);
  assert.equal(splitGeometry('document',633,1100,0.3,673).inline,true);
  assert.equal(splitGeometry('terminal',700,700).inline,false);
  assert.equal(splitGeometry('terminal',480,1000).inline,false);
  assert.equal(splitGeometry('terminal',600,1000).inline,true);
  assert.equal(splitGeometry('table',500,530).inline,false);
  assert.equal(splitGeometry('table',479,1440).inline,false);
  assert.equal(splitGeometry('table',480,1440).inline,true);
});
