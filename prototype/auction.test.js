const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Auction } = require('./auction');

test('auction enforces increments, team purse and squad limit', () => {
  const a = new Auction({ purse: 100, increment: 10, maxSquad: 1 });
  a.addTeam('A'); a.addTeam('B');
  a.addPlayer('P', 20); a.addPlayer('Q', 90);
  a.open('P');
  assert.throws(() => a.bid('A', 10));
  a.bid('A', 20);
  assert.throws(() => a.bid('B', 25));
  a.bid('B', 30);
  a.sold();
  assert.equal(a.teams.B.balance, 70);
  assert.deepEqual(a.teams.B.players, ['P']);
  a.open('Q');
  assert.throws(() => a.bid('B', 90));
  a.bid('A', 90);
  assert.throws(() => a.bid('B', 100));
});

test('unsold players can be reopened and cannot be sold without a bid', () => {
  const a = new Auction({ purse: 100, increment: 10, maxSquad: 2 });
  a.addTeam('A'); a.addPlayer('P', 20); a.open('P');
  assert.throws(() => a.sold());
  a.unsold(); a.open('P'); a.bid('A', 20); a.sold();
  assert.equal(a.players.P.status, 'sold');
  assert.throws(() => a.open('P'));
});
