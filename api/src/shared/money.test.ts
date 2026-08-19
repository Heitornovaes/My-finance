import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCentsToBRL, parseMoneyToCents } from './money';

test('parseMoneyToCents: formato BR com milhar', () => {
  assert.equal(parseMoneyToCents('1.234,56'), 123456);
});

test('parseMoneyToCents: formato com ponto decimal', () => {
  assert.equal(parseMoneyToCents('1234.56'), 123456);
});

test('parseMoneyToCents: zero', () => {
  assert.equal(parseMoneyToCents('0'), 0);
  assert.equal(parseMoneyToCents('0,00'), 0);
});

test('parseMoneyToCents: negativo', () => {
  assert.equal(parseMoneyToCents('-50,00'), -5000);
});

test('parseMoneyToCents: sem casas decimais', () => {
  assert.equal(parseMoneyToCents('10'), 1000);
});

test('parseMoneyToCents: lixo lança erro', () => {
  assert.throws(() => parseMoneyToCents('abc'));
  assert.throws(() => parseMoneyToCents(''));
  assert.throws(() => parseMoneyToCents('12,345,67'));
  assert.throws(() => parseMoneyToCents('R$ 10,00'));
});

test('formatCentsToBRL: valores básicos', () => {
  assert.equal(formatCentsToBRL(123456), 'R$ 1.234,56');
  assert.equal(formatCentsToBRL(0), 'R$ 0,00');
  assert.equal(formatCentsToBRL(5), 'R$ 0,05');
});

test('formatCentsToBRL: negativo', () => {
  assert.equal(formatCentsToBRL(-5000), '-R$ 50,00');
});

test('parseMoneyToCents e formatCentsToBRL são inversos para valores exatos', () => {
  const cents = parseMoneyToCents('1.234,56');
  assert.equal(formatCentsToBRL(cents), 'R$ 1.234,56');
});
