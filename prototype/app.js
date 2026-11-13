'use strict';
let auction;
const $ = id => document.getElementById(id);
function notify(s){ $('message').textContent=s; }
function act(fn){try{fn();notify('');render();}catch(e){notify(e.message)}}
function option(select,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o)}
function render(){
  const teams=$('teams'), players=$('players'), ps=$('playerSelect'), ts=$('teamSelect');
  teams.replaceChildren();players.replaceChildren();ps.replaceChildren();ts.replaceChildren();
  if(!auction)return;
  for(const [name,t] of Object.entries(auction.teams)){const d=document.createElement('div');d.textContent=`${name} · ${t.balance.toLocaleString()} pts · ${t.players.length} players`;teams.append(d);option(ts,name,name)}
  for(const [name,p] of Object.entries(auction.players)){const d=document.createElement('div');d.textContent=`${name} · ${p.status}${p.team?' · '+p.team:''}`;players.append(d);if(p.status==='available'||p.status==='unsold')option(ps,name,`${name} · ${p.base} pts`)}
  const c=auction.current;$('current').textContent=c?c.player:'No player selected';$('state').textContent=c?'LIVE':'WAITING';$('bidStatus').textContent=c?(c.team?`${c.team} leads with ${c.amount.toLocaleString()} points`:`Base price: ${auction.players[c.player].base.toLocaleString()} points`):'Select a player to begin';
}
$('setup').onsubmit=e=>{e.preventDefault();act(()=>{const d=new FormData(e.target);auction=new Auction({purse:Number(d.get('purse')),increment:Number(d.get('increment')),maxSquad:Number(d.get('maxSquad'))})})};
function ready(){if(!auction)throw Error('Create an auction first.')}
$('teamForm').onsubmit=e=>{e.preventDefault();act(()=>{ready();auction.addTeam(new FormData(e.target).get('team').trim());e.target.reset()})};
$('playerForm').onsubmit=e=>{e.preventDefault();act(()=>{ready();const d=new FormData(e.target);auction.addPlayer(d.get('player').trim(),Number(d.get('base')));e.target.reset()})};
$('open').onclick=()=>act(()=>{ready();auction.open($('playerSelect').value)});
$('random').onclick=()=>act(()=>{ready();const names=[...$('playerSelect').options].map(o=>o.value);if(!names.length)throw Error('No eligible players are available.');auction.open(names[Math.floor(Math.random()*names.length)])});
$('bidForm').onsubmit=e=>{e.preventDefault();act(()=>{ready();const d=new FormData(e.target);auction.bid(d.get('team'),Number(d.get('amount')));e.target.reset()})};
$('sold').onclick=()=>act(()=>{ready();auction.sold()});$('unsold').onclick=()=>act(()=>{ready();auction.unsold()});
render();
