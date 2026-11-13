'use strict';

class Auction {
  constructor({ purse, increment, maxSquad }) {
    if (![purse, increment, maxSquad].every(n => Number.isSafeInteger(n) && n > 0)) throw Error('Rules must be positive whole numbers');
    this.rules = { purse, increment, maxSquad };
    this.teams = Object.create(null);
    this.players = Object.create(null);
    this.current = null;
  }
  addTeam(name) {
    if (typeof name !== 'string' || !name.trim() || this.teams[name]) throw Error('Invalid or duplicate team');
    this.teams[name] = { balance: this.rules.purse, players: [] };
  }
  addPlayer(name, base) {
    if (typeof name !== 'string' || !name.trim() || this.players[name] || !Number.isSafeInteger(base) || base < 0) throw Error('Invalid or duplicate player');
    this.players[name] = { base, status: 'available' };
  }
  open(name) {
    const p = this.players[name];
    if (this.current || !p || p.status === 'sold') throw Error('Player cannot be opened');
    p.status = 'live';
    this.current = { player: name, team: null, amount: null };
  }
  bid(teamName, amount) {
    const c = this.current, team = this.teams[teamName];
    if (!c || !team || !Number.isSafeInteger(amount)) throw Error('Invalid bid');
    const minimum = c.amount === null ? this.players[c.player].base : c.amount + this.rules.increment;
    if (c.amount !== null && (amount - c.amount) % this.rules.increment !== 0) throw Error('Bid must follow the configured increment');
    if (amount < minimum || amount > team.balance || team.players.length >= this.rules.maxSquad || c.team === teamName) throw Error('Bid not allowed');
    c.team = teamName; c.amount = amount;
  }
  sold() {
    const c = this.current;
    if (!c || !c.team) throw Error('No winning bid');
    const team = this.teams[c.team];
    team.balance -= c.amount; team.players.push(c.player);
    Object.assign(this.players[c.player], { status: 'sold', team: c.team, price: c.amount });
    this.current = null;
  }
  unsold() {
    if (!this.current || this.current.team) throw Error('Cannot mark unsold while a bid is active');
    this.players[this.current.player].status = 'unsold'; this.current = null;
  }
}
if (typeof module !== 'undefined') module.exports = { Auction };
if (typeof window !== 'undefined') window.Auction = Auction;
