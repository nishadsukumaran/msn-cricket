const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Auction } = require('./auction');

test('a new bid must follow the configured increment exactly', () => {
  const a = new Auction({ purse: 500, increment: 10, maxSquad: 3 });
  a.addTeam('A'); a.addTeam('B'); a.addPlayer('Player', 50); a.open('Player');
  a.bid('A', 50);
  assert.throws(() => a.bid('B', 65), /increment/i);
  a.bid('B', 60);
});

test('a bid cannot be placed after a player is sold', () => {
  const a = new Auction({ purse: 500, increment: 10, maxSquad: 3 });
  a.addTeam('A'); a.addPlayer('Player', 50); a.open('Player');
  a.bid('A', 50); a.sold();
  assert.throws(() => a.bid('A', 60));
});
