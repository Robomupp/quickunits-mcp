import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tolkaSvar } from '../lib/client.js';

test('tolkar ett rent JSON-svar', () => {
  const s = tolkaSvar('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
  assert.equal(s.result.ok, true);
});

test('tolkar ett SSE-svar med en data-rad', () => {
  const svar = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"value":5}}\n\n';
  assert.equal(tolkaSvar(svar).result.value, 5);
});

test('tolkar ett SSE-svar där JSON:en är delad på flera data-rader', () => {
  const svar = 'data: {"jsonrpc":"2.0",\ndata: "id":3,"result":{"x":1}}\n\n';
  assert.deepEqual(tolkaSvar(svar).result, { x: 1 });
});

test('tomt svar ger null i stället för att kasta', () => {
  assert.equal(tolkaSvar('   \n'), null);
});

test('ett svar med fel kastas inte av tolken — felet ligger i fältet error', () => {
  const s = tolkaSvar('{"jsonrpc":"2.0","id":4,"error":{"code":-32602,"message":"bad"}}');
  assert.equal(s.error.message, 'bad');
});
