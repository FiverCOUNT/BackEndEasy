'use strict';

const assert = require('assert');

function loadConfig() {
  const base = (
    process.env.INTEGRATION_BASE_URL ||
    process.env.BASE_URL ||
    'http://127.0.0.1:3000'
  ).replace(/\/$/, '');
  const email = process.env.INTEGRATION_EMAIL || process.env.SMOKE_EMAIL || 'mili@gmail.com';
  const password =
    process.env.INTEGRATION_PASSWORD || process.env.SMOKE_PASSWORD || '123456';
  const requireBeta = process.env.INTEGRATION_ALLOW_PROD !== '1';
  return { base, email, password, requireBeta };
}

function createRunner() {
  let passed = 0;
  let failed = 0;
  const failures = [];

  async function test(name, fn) {
    process.stdout.write(`  · ${name} ... `);
    try {
      await fn();
      passed += 1;
      process.stdout.write('ok\n');
    } catch (err) {
      failed += 1;
      failures.push({ name, err });
      process.stdout.write('FAIL\n');
      console.error(`    ${err && err.message ? err.message : err}`);
    }
  }

  function summary() {
    return { passed, failed, failures };
  }

  return { test, summary, assert };
}

module.exports = { loadConfig, createRunner, assert };
