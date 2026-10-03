/**
 * Mini harness de pruebas unitarias (sin Jest).
 * Uso en cada archivo:
 *   const { test, section, assert } = require('../harness');
 *   section('Nombre');
 *   test('caso', () => { assert.strictEqual(1, 1); });
 */
const assert = require('assert');

const state = {
  passed: 0,
  failed: 0,
  errors: [],
};

function section(name) {
  console.log(`\n== ${name} ==`);
}

function ok(name) {
  state.passed += 1;
  console.log(`  ✓ ${name}`);
}

function fail(name, err) {
  state.failed += 1;
  const msg = err && err.message ? err.message : String(err);
  state.errors.push({ name, msg });
  console.error(`  ✗ ${name}`);
  console.error(`    ${msg}`);
}

function test(name, fn) {
  try {
    const ret = fn();
    if (ret && typeof ret.then === 'function') {
      throw new Error('Usa testAsync para pruebas async');
    }
    ok(name);
  } catch (err) {
    fail(name, err);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    fail(name, err);
  }
}

function summary() {
  console.log(`\nResultado: ${state.passed} ok, ${state.failed} fail`);
  if (state.failed) {
    console.log('Fallos:');
    for (const e of state.errors) {
      console.log(`  - ${e.name}: ${e.msg}`);
    }
  }
  return state.failed === 0;
}

function reset() {
  state.passed = 0;
  state.failed = 0;
  state.errors = [];
}

module.exports = {
  assert,
  section,
  test,
  testAsync,
  summary,
  reset,
  getState: () => state,
};
