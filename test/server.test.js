const { test, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.ADMIN_PASSWORD = 'testing-password';
const { app, pool } = require('../server');
after(() => pool.end());
test('production app protects panel and OAuth login, exposes health and static assets', async t => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/', '/olx/ogloszenia', '/olx/edytuj/123', '/olx/login']) {
    const response = await fetch(base + route, { redirect: 'manual' });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate'), /Basic/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
  const authorized = await fetch(base + '/', { redirect: 'manual', headers: { Authorization: 'Basic ' + Buffer.from('admin:testing-password').toString('base64') } });
  assert.equal(authorized.status, 302);
  assert.equal(authorized.headers.get('location'), '/olx/ogloszenia');
  const bad = await fetch(base + '/', { headers: { Authorization: 'Basic ' + Buffer.from('admin:wrong').toString('base64') } });
  assert.equal(bad.status, 401);
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/panel.css')).status, 200);
  assert.equal((await fetch(base + '/panel.js')).status, 200);
  assert.equal((await fetch(base + '/olx/callback?code=x&state=bad')).status, 400);
});
