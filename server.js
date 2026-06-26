const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  res.writeHead(200); res.end('Vibe Snake Server');
});

const wss = new WebSocket.Server({ server });

const COLS = 30, ROWS = 22, TICK = 150;
const TARGET_FOOD = 22;
const RESPAWN_DELAY = 18;

const WORDS = [
  // power-ups — wander around
  {t:'MOTIVATED',y:'power',c:'#1D9E75',p:15,e:'Motivated! Speed boost!',i:'💪',ms:2,mv:'wander'},
  {t:'FOCUSED',y:'power',c:'#1D9E75',p:12,e:'Focused! +3 length!',i:'🎯',ms:2,mv:'wander'},
  {t:'ALIGNED',y:'power',c:'#1D9E75',p:10,e:'Aligned! Growth spurt!',i:'🤝',ms:2,mv:'wander'},
  {t:'SHIPPED',y:'power',c:'#1D9E75',p:18,e:'Shipped! Faster!',i:'🚀',ms:4,mv:'bounce'},
  {t:'SYNCED',y:'power',c:'#1D9E75',p:10,e:'Synced! +3 length!',i:'🔄',ms:2,mv:'wander'},
  {t:'IN THE ZONE',y:'power',c:'#1D9E75',p:20,e:'In the zone! Unstoppable!',i:'⚡',ms:4,mv:'bounce'},
  // bonus — flee from you
  {t:'CLOSED',y:'bonus',c:'#7F77DD',p:30,e:'Deal closed! Score x2!',i:'🏆',ms:3,mv:'flee'},
  {t:'PROMOTED',y:'bonus',c:'#7F77DD',p:35,e:'Promoted! Big bonus!',i:'📈',ms:4,mv:'flee'},
  {t:'FUNDED',y:'bonus',c:'#7F77DD',p:40,e:'Funded! Jackpot!',i:'💰',ms:5,mv:'flee'},
  {t:'LAUNCHED',y:'bonus',c:'#7F77DD',p:30,e:'Launched! Score x2!',i:'🛸',ms:4,mv:'flee'},
  {t:'VIRAL',y:'bonus',c:'#7F77DD',p:45,e:'Gone viral! Score x3!',i:'🔥',ms:6,mv:'flee'},
  {t:'RECORD MONTH',y:'bonus',c:'#7F77DD',p:50,e:'Record month! Massive bonus!',i:'💎',ms:7,mv:'flee'},
  {t:'LEGENDARY',y:'bonus',c:'#7F77DD',p:50,e:'Legendary! Max bonus!',i:'👑',ms:7,mv:'flee'},
  // danger — hunt you
  {t:'BURNOUT',y:'danger',c:'#D85A30',p:5,e:'Burnout! Stunned.',i:'😵',ms:3,mv:'hunt'},
  {t:'BLOCKED',y:'danger',c:'#D85A30',p:5,e:'Blocked! Wall appeared.',i:'🧱',ms:2,mv:'wander'},
  {t:'MEETING',y:'danger',c:'#D85A30',p:2,e:'Another meeting... stunned!',i:'😴',ms:2,mv:'hunt'},
  {t:'SCOPE CREEP',y:'danger',c:'#D85A30',p:4,e:'Scope creep! Lost tail.',i:'😬',ms:3,mv:'hunt'},
  {t:'CHURN',y:'danger',c:'#D85A30',p:3,e:'Churn! Lost tail.',i:'📉',ms:3,mv:'hunt'},
  {t:'DEADLINE',y:'danger',c:'#D85A30',p:3,e:'Deadline! Everyone stunned!',i:'⏰',ms:5,mv:'hunt'},
  {t:'CONTEXT SWITCH',y:'danger',c:'#D85A30',p:2,e:'Context switch! Direction flipped!',i:'🔀',ms:4,mv:'hunt'},
  // chaos — erratic
  {t:'PIVOT',y:'chaos',c:'#EF9F27',p:15,e:'Pivot! Direction surprise!',i:'🔄',ms:5,mv:'erratic'},
  {t:'REORG',y:'chaos',c:'#EF9F27',p:20,e:'Reorg! Everything speeds up!',i:'🌪️',ms:6,mv:'erratic'},
  {t:'ALL IN',y:'chaos',c:'#EF9F27',p:20,e:'All in! Double or nothing!',i:'🃏',ms:4,mv:'erratic'},
  {t:'WILD CARD',y:'chaos',c:'#EF9F27',p:25,e:'Wild card! Random effect!',i:'🎲',ms:7,mv:'erratic'},
  {t:'PLOT TWIST',y:'chaos',c:'#EF9F27',p:20,e:'Plot twist! Chaos ensues!',i:'💫',ms:5,mv:'erratic'},
];

const COLORS = ['#0F6E56','#534AB7','#993C1D','#BA7517','#A32D2D','#185FA5','#3B6D11','#8B3A8B','#C2185B','#00695C','#1565C0','#6A1B9A'];

let players = {};
let foods = [];
let respawnQueue = [];
let walls = [];
let gameStarted = false;
let tickInterval = null;
let tickN = 0;

function rn(n) { return Math.floor(Math.random() * n); }
function rd() { return [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}][rn(4)]; }

function isClear(x, y) {
  if (walls.some(w => w.x===x && w.y===y)) return false;
  if (foods.some(f => f.x===x && f.y===y)) return false;
  for (const p of Object.values(players)) {
    if (p.snake && p.snake.some(s => s.x===x && s.y===y)) return false;
  }
  return true;
}

function spawnFood(wordDef, delay) {
  if (delay) { respawnQueue.push({w:{...wordDef}, at:tickN+delay}); return; }
  let x, y, tries = 0;
  do { x = rn(COLS); y = rn(ROWS); tries++; } while (!isClear(x,y) && tries < 120);
  if (tries >= 120) return;
  foods.push({...wordDef, x, y, id: Date.now()+rn(9999), nm: tickN+wordDef.ms, md: rd()});
}

function processRespawnQueue() {
  const ready = respawnQueue.filter(r => tickN >= r.at);
  respawnQueue = respawnQueue.filter(r => tickN < r.at);
  ready.forEach(r => spawnFood(r.w, 0));
}

function fillBoard() {
  const total = foods.length + respawnQueue.length;
  const target = Math.min(TARGET_FOOD, 10 + Object.keys(players).length * 3);
  while (foods.length + respawnQueue.length < target) {
    spawnFood(WORDS[rn(WORDS.length)], 0);
  }
}

function moveWords() {
  const activePlayers = Object.values(players).filter(p => p.alive && p.snake && p.snake.length > 0);
  foods.forEach(f => {
    if (tickN < f.nm) return;
    f.nm = tickN + f.ms;
    let nx = f.x, ny = f.y;
    const target = activePlayers.length > 0 ? activePlayers[rn(activePlayers.length)].snake[0] : null;

    if (f.mv === 'wander') {
      if (rn(3) === 0) f.md = rd();
      nx = (f.x+f.md.x+COLS)%COLS; ny = (f.y+f.md.y+ROWS)%ROWS;
    } else if (f.mv === 'bounce') {
      nx = (f.x+f.md.x+COLS)%COLS; ny = (f.y+f.md.y+ROWS)%ROWS;
      if (nx<=0||nx>=COLS-1) f.md={x:-f.md.x,y:f.md.y};
      if (ny<=0||ny>=ROWS-1) f.md={x:f.md.x,y:-f.md.y};
    } else if (f.mv === 'flee' && target) {
      const dx=f.x-target.x, dy=f.y-target.y;
      f.md = Math.abs(dx)>Math.abs(dy)?{x:dx>0?1:-1,y:0}:{x:0,y:dy>0?1:-1};
      if (rn(4)===0) f.md = rd();
      nx=(f.x+f.md.x+COLS)%COLS; ny=(f.y+f.md.y+ROWS)%ROWS;
    } else if (f.mv === 'hunt' && target) {
      const dx=target.x-f.x, dy=target.y-f.y;
      f.md = Math.abs(dx)>Math.abs(dy)?{x:dx>0?1:-1,y:0}:{x:0,y:dy>0?1:-1};
      if (rn(5)===0) f.md = rd();
      nx=(f.x+f.md.x+COLS)%COLS; ny=(f.y+f.md.y+ROWS)%ROWS;
    } else if (f.mv === 'erratic') {
      f.md = rd();
      nx=(f.x+f.md.x+COLS)%COLS; ny=(f.y+f.md.y+ROWS)%ROWS;
    } else {
      if (rn(3)===0) f.md=rd();
      nx=(f.x+f.md.x+COLS)%COLS; ny=(f.y+f.md.y+ROWS)%ROWS;
    }

    const blocked = walls.some(w=>w.x===nx&&w.y===ny) || foods.some(o=>o!==f&&o.x===nx&&o.y===ny);
    if (!blocked) { f.x=nx; f.y=ny; } else { f.md=rd(); }
  });
}

function spawnPlayer(id) {
  let x, y, tries = 0;
  do { x=2+rn(COLS-4); y=2+rn(ROWS-4); tries++; } while (!isClear(x,y) && tries<200);
  const d = rd();
  players[id].snake = [{x,y},{x:x-d.x,y:y-d.y},{x:x-d.x*2,y:y-d.y*2}];
  players[id].dir = d;
  players[id].nextDir = d;
  players[id].alive = true;
  players[id].ds = 0;
  players[id].stun = 0;
  players[id].sb = 0;
  players[id].effect = '';
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

function sendTo(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function getState() {
  const ps = {};
  for (const [id, p] of Object.entries(players)) {
    ps[id] = { name:p.name, color:p.color, snake:p.snake, score:p.score, alive:p.alive, effect:p.effect||'', dir:p.dir };
  }
  return { type:'state', players:ps, foods, walls, respawning:respawnQueue.length };
}

function applyEffect(id, f) {
  const p = players[id];
  if (f.y === 'power') {
    if (['SHIP IT','SPRINT'].includes(f.t)) p.sb = 12;
    else if (['DEPLOY','SYNC','FEEDBACK'].includes(f.t)) { for(let i=0;i<3;i++) p.snake.push({...p.snake[p.snake.length-1]}); }
    else if (f.t === 'ASYNC') p.stun = 0;
  } else if (f.y === 'bonus') {
    p.ds = f.t==='VIRAL' ? 12 : 8;
    if (f.t==='RAISE') p.score += 20;
  } else if (f.y === 'danger') {
    if (['OKR','MEETING'].includes(f.t)) p.stun = 3;
    else if (f.t === 'FIRE DRILL') { for (const op of Object.values(players)) op.stun = 3; }
    else if (f.t === 'BLOCKERS') { let bx=rn(COLS),by=rn(ROWS); if(isClear(bx,by)) walls.push({x:bx,y:by}); }
    else if (f.t === 'REORG') { p.nextDir={x:-p.dir.x||1,y:-p.dir.y}; }
    else if (['CHURN','SCOPE CREEP'].includes(f.t)) { if(p.snake.length>4){p.snake.pop();p.snake.pop();p.snake.pop();} }
    else if (f.t === 'BUG') p.stun = 2;
  } else if (f.y === 'chaos') {
    if (f.t==='CHAOS') { for (const op of Object.values(players)) op.sb = 8; }
    else if (f.t==='PIVOT') p.nextDir={x:p.dir.y,y:p.dir.x};
    else if (f.t==='YOLO') { const r=rn(3); if(r===0)p.sb=8; else if(r===1)p.ds=10; else p.stun=2; }
    else if (f.t==='ALL IN') p.score=rn(2)===0?p.score*2:Math.max(0,p.score-15);
  }
}

function tick() {
  tickN++;
  processRespawnQueue();
  moveWords();

  for (const [id, p] of Object.entries(players)) {
    if (!p.alive || !p.snake) continue;
    if (p.stun > 0) { p.stun--; continue; }

    p.dir = p.nextDir;
    const head = { x:(p.snake[0].x+p.dir.x+COLS)%COLS, y:(p.snake[0].y+p.dir.y+ROWS)%ROWS };

    let dead = false;
    if (walls.some(w=>w.x===head.x&&w.y===head.y)) dead = true;
    for (const [oid, op] of Object.entries(players)) {
      if (!op.alive||!op.snake) continue;
      if (op.snake.some(s=>s.x===head.x&&s.y===head.y)) { dead=true; break; }
    }
    if (dead) { p.alive=false; p.effect='Crashed!'; continue; }

    p.snake.unshift(head);
    let grew = false;
    const fi = foods.findIndex(f=>f.x===head.x&&f.y===head.y);
    if (fi !== -1) {
      const f = foods[fi]; foods.splice(fi,1); grew=true;
      const pts = p.ds>0 ? (f.t==='VIRAL'?f.p*3:f.p*2) : f.p;
      p.score += pts;
      p.effect = f.i+' '+f.e;
      applyEffect(id, f);
      spawnFood({...f}, RESPAWN_DELAY);
      fillBoard();
    }
    if (!grew) p.snake.pop();
    if (p.ds>0) p.ds--;
    if (p.sb>0) p.sb--;
  }

  fillBoard();
  broadcast(getState());
}

wss.on('connection', (ws) => {
  const id = 'p'+Date.now()+rn(9999);
  const colorIdx = Object.keys(players).length % COLORS.length;
  players[id] = { ws, name:'Player', color:COLORS[colorIdx], score:0, alive:false, snake:[], dir:{x:1,y:0}, nextDir:{x:1,y:0}, effect:'', ds:0, stun:0, sb:0 };

  sendTo(ws, { type:'welcome', id, color:COLORS[colorIdx] });
  sendTo(ws, getState());

  ws.on('message', (raw) => {
    let msg; try { msg=JSON.parse(raw); } catch { return; }

    if (msg.type==='join') {
      players[id].name = (msg.name||'Player').slice(0,20);
      spawnPlayer(id);
      if (!gameStarted) {
        gameStarted=true;
        if (!tickInterval) tickInterval=setInterval(tick, TICK);
        fillBoard();
      }
      broadcast(getState());
    }
    if (msg.type==='dir') {
      const p=players[id]; if(!p.alive) return;
      const d=msg.dir;
      if(d.x!==-p.dir.x||d.y!==-p.dir.y) p.nextDir=d;
    }
    if (msg.type==='respawn') { spawnPlayer(id); broadcast(getState()); }
    if (msg.type==='reset') {
      for (const pid of Object.keys(players)) { players[pid].score=0; spawnPlayer(pid); }
      foods=[]; respawnQueue=[]; walls=[];
      fillBoard(); broadcast(getState());
    }
  });

  ws.on('close', () => {
    delete players[id];
    if (Object.keys(players).length===0) {
      gameStarted=false;
      if (tickInterval) { clearInterval(tickInterval); tickInterval=null; }
      foods=[]; respawnQueue=[]; walls=[];
    }
    broadcast(getState());
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Vibe Snake server running on port ${PORT}`));
