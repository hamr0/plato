import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sinkFile } from '../../src/flightlog.js';

// Guards the only policy in the flightlog adopter glue (src/flightlog.js): the
// sink path. initFlightlog() itself is exercised live in bin/server.js (it
// registers global handlers + writes a boot probe), so it's deliberately NOT
// called here.

test('sinkFile honors PLATO_FLIGHTLOG_FILE override', () => {
  const prev = process.env.PLATO_FLIGHTLOG_FILE;
  process.env.PLATO_FLIGHTLOG_FILE = '/tmp/custom-flightlog.jsonl';
  try {
    assert.equal(sinkFile(), '/tmp/custom-flightlog.jsonl');
  } finally {
    if (prev === undefined) delete process.env.PLATO_FLIGHTLOG_FILE;
    else process.env.PLATO_FLIGHTLOG_FILE = prev;
  }
});

test('sinkFile defaults to data/logs/errors.jsonl', () => {
  const prev = process.env.PLATO_FLIGHTLOG_FILE;
  delete process.env.PLATO_FLIGHTLOG_FILE;
  try {
    assert.match(sinkFile(), /[/\\]data[/\\]logs[/\\]errors\.jsonl$/);
  } finally {
    if (prev !== undefined) process.env.PLATO_FLIGHTLOG_FILE = prev;
  }
});
