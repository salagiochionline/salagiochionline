/* =========================================================
   TAVOLATA — server del sito (Cloudflare Worker)
   - Tutte le pagine (home, giochi, profilo…) sono file statici:
     li serve Cloudflare direttamente, senza passare di qui.
   - /mqtt è il server multiplayer di Tavolata: un piccolo
     "broker MQTT" dentro un Durable Object (gratuito su Cloudflare).
     Parla lo stesso linguaggio dei server pubblici usati prima
     (MQTT 3.1.1 su WebSocket), quindi i giochi non cambiano:
     partite, posti, presenza, amici, inviti, stanze.
   - I messaggi "conservati" (retained) restano in memoria e quelli
     importanti (partite, profili, posta, copie cifrate) vengono
     salvati anche nel database del Durable Object, così una
     partita sopravvive a un riavvio del server.
   - La presenza ("sono qui") e l'elenco delle stanze pubbliche si
     ripubblicano da soli ogni pochi secondi: restano solo in memoria.
   ========================================================= */
import { DurableObject } from 'cloudflare:workers';

const MAX_PACCHETTO = 4 * 1024 * 1024;     // 4 MB: più grande di qualsiasi documento di partita
const SALVA_DOPO_MS = 1500;                // i cambi vengono scritti nel database a gruppi
const GIORNO = 864e5;
const PING_TOPIC = 'tavolata/v1/ping';     // usato dai giochi per controllare che la connessione sia viva

/* argomenti che si ripubblicano da soli: non serve salvarli nel database */
const VOLATILE = t => /\/pres\/[^/]+$/.test(t) || t.startsWith('tavolata/v1/presenza/') || t.startsWith('tavolata/v1/stanze/') || t === PING_TOPIC;
/* dopo quanto tempo senza aggiornamenti un messaggio conservato si butta via */
function scadenza(t) {
  if (t.includes('/games/')) return 5 * GIORNO;            // partite
  if (VOLATILE(t)) return 2 * GIORNO;                      // presenza e stanze (solo memoria)
  if (t.startsWith('tavolata/v1/posta/')) return 45 * GIORNO;
  return 400 * GIORNO;                                     // profili, riepiloghi, copie cifrate
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/mqtt' || url.pathname.startsWith('/mqtt/')) {
      const stub = env.BROKER.get(env.BROKER.idFromName('tavolata-v1'));
      if ((req.headers.get('Upgrade') || '').toLowerCase() === 'websocket') return stub.fetch(req);
      if (url.pathname === '/mqtt/stato') return stub.fetch(req);
      return new Response('Server multiplayer di Tavolata: attivo.', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    return env.ASSETS.fetch(req);
  }
};

/* ---------------- utilità MQTT ---------------- */
const enc = new TextEncoder(), dec = new TextDecoder();
function lunghezza(n) {          // "remaining length" MQTT
  const out = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0);
  return out;
}
function pacchetto(tipoFlags, corpo) {
  const L = lunghezza(corpo.length);
  const out = new Uint8Array(1 + L.length + corpo.length);
  out[0] = tipoFlags; out.set(L, 1); out.set(corpo, 1 + L.length);
  return out;
}
function corrisponde(filtro, fp, topic) {   // fp = filtro diviso in pezzi
  if (filtro === topic) return true;
  if (fp.length === 1 && fp[0] === '#') return !topic.startsWith('$');
  const tp = topic.split('/');
  for (let i = 0; i < fp.length; i++) {
    const x = fp[i];
    if (x === '#') return true;
    if (i >= tp.length) return false;
    if (x !== '+' && x !== tp[i]) return false;
  }
  return fp.length === tp.length;
}
function filtroValido(f) {
  if (!f || f.length > 1024) return false;
  const p = f.split('/');
  for (let i = 0; i < p.length; i++) {
    if (p[i].includes('#') && (p[i] !== '#' || i !== p.length - 1)) return false;
    if (p[i].includes('+') && p[i] !== '+') return false;
  }
  return true;
}
const prefisso = f => { const i = f.search(/[+#]/); return i < 0 ? f : f.slice(0, i); };

/* ---------------- una connessione (un giocatore / una pagina) ---------------- */
class Conn {
  constructor(br, ws) {
    this.br = br; this.ws = ws; this.buf = new Uint8Array(0);
    this.ok = false; this.vivo = true; this.id = ''; this.ka = 0; this.ultimo = Date.now(); this.inizio = Date.now();
    this.subs = new Map();   // filtro -> pezzi
    this.will = null;
  }
  invia(u8) { if (!this.vivo) return; try { this.ws.send(u8); } catch (e) { this.chiudi(true); } }
  dati(d) {
    const pezzo = typeof d === 'string' ? enc.encode(d) : new Uint8Array(d);
    if (this.buf.length) { const b = new Uint8Array(this.buf.length + pezzo.length); b.set(this.buf); b.set(pezzo, this.buf.length); this.buf = b; }
    else this.buf = pezzo;
    while (this.vivo && this.buf.length >= 2) {
      let molt = 1, len = 0, i = 1, b;
      do {
        if (i >= this.buf.length) return;
        b = this.buf[i++]; len += (b & 127) * molt; molt *= 128;
        if (i > 5) return this.chiudi(true);
      } while (b & 128);
      if (len > MAX_PACCHETTO) return this.chiudi(true);
      if (this.buf.length < i + len) return;
      const h = this.buf[0], corpo = this.buf.subarray(i, i + len);
      this.buf = this.buf.length === i + len ? new Uint8Array(0) : this.buf.subarray(i + len);
      this.ultimo = Date.now();
      try { this.pacchetto(h >> 4, h & 15, corpo); } catch (e) { return this.chiudi(true); }
    }
  }
  pacchetto(tipo, flags, c) {
    let o = 0;
    const u16 = () => { const v = (c[o] << 8) | c[o + 1]; o += 2; return v; };
    const bin = () => { const n = u16(); const v = c.slice(o, o + n); o += n; if (v.length !== n) throw new Error('corto'); return v; };
    const str = () => dec.decode(bin());
    if (!this.ok && tipo !== 1) return this.chiudi(true);
    switch (tipo) {
      case 1: {   // CONNECT
        if (this.ok) return this.chiudi(true);
        str(); const livello = c[o++], fl = c[o++]; this.ka = u16();
        if (livello !== 3 && livello !== 4) { this.invia(new Uint8Array([0x20, 2, 0, 1])); return this.chiudi(false); }
        this.id = str() || 'anon-' + Math.random().toString(36).slice(2);
        if (fl & 4) {
          const wt = str(), wm = bin();
          if (wt && !/[+#]/.test(wt)) this.will = { topic: wt, p: wm, retain: !!(fl & 32) };
        }
        if (fl & 128) bin();
        if (fl & 64) bin();
        this.ok = true;
        this.br.entra(this);
        this.invia(new Uint8Array([0x20, 2, 0, 0]));
        return;
      }
      case 3: {   // PUBLISH
        const qos = (flags >> 1) & 3, retain = !!(flags & 1);
        const topic = str();
        let pid = 0; if (qos > 0) pid = u16();
        const p = c.slice(o);
        if (qos === 1) this.invia(new Uint8Array([0x40, 2, pid >> 8, pid & 255]));
        else if (qos === 2) this.invia(new Uint8Array([0x50, 2, pid >> 8, pid & 255]));
        if (!topic || /[+#]/.test(topic)) return;
        this.br.pubblica(topic, p, retain, this);
        return;
      }
      case 4: case 5: case 7: return;                           // PUBACK, PUBREC, PUBCOMP (consegniamo sempre con qos 0)
      case 6: { const pid = u16(); this.invia(new Uint8Array([0x70, 2, pid >> 8, pid & 255])); return; }   // PUBREL -> PUBCOMP
      case 8: {   // SUBSCRIBE
        const pid = u16(); const codici = []; const nuovi = [];
        while (o < c.length) {
          const f = str(); o++;   // qos richiesto: concediamo 0
          if (filtroValido(f)) { const fp = f.split('/'); this.subs.set(f, fp); nuovi.push([f, fp]); codici.push(0); }
          else codici.push(0x80);
        }
        this.invia(pacchetto(0x90, new Uint8Array([pid >> 8, pid & 255, ...codici])));
        this.br.conservati(this, nuovi);
        return;
      }
      case 10: {  // UNSUBSCRIBE
        const pid = u16();
        while (o < c.length) this.subs.delete(str());
        this.invia(new Uint8Array([0xB0, 2, pid >> 8, pid & 255]));
        return;
      }
      case 12: this.invia(new Uint8Array([0xD0, 0])); return;   // PINGREQ -> PINGRESP
      case 14: this.will = null; return this.chiudi(false);     // DISCONNECT
      default: return this.chiudi(true);
    }
  }
  consegna(topic, p, retain) {
    const tb = enc.encode(topic);
    const corpo = new Uint8Array(2 + tb.length + p.length);
    corpo[0] = tb.length >> 8; corpo[1] = tb.length & 255; corpo.set(tb, 2); corpo.set(p, 2 + tb.length);
    this.invia(pacchetto(retain ? 0x31 : 0x30, corpo));
  }
  vuole(topic) { for (const [f, fp] of this.subs) if (corrisponde(f, fp, topic)) return true; return false; }
  chiudi(conWill) {
    if (!this.vivo) return;
    this.vivo = false;
    try { this.ws.close(conWill ? 1011 : 1000, 'fine'); } catch (e) { }
    this.br.esce(this, conWill);
  }
}

/* ---------------- il server (un solo Durable Object per tutto il sito) ---------------- */
export class Broker extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.conns = new Set();
    this.perId = new Map();
    this.ret = new Map();          // topic -> { p, t, by }
    this.sporchi = new Set();
    this.timerSalva = null;
    this.letti = 0; this.errDb = '';
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      try {
        this.sql.exec('CREATE TABLE IF NOT EXISTS ret (topic TEXT PRIMARY KEY, p BLOB NOT NULL, t INTEGER NOT NULL)');
        const ora = Date.now(); const vecchi = [];
        for (const r of this.sql.exec('SELECT topic, p, t FROM ret')) {
          this.letti++;
          if (ora - r.t > scadenza(r.topic)) { vecchi.push(r.topic); continue; }
          this.ret.set(r.topic, { p: new Uint8Array(r.p), t: r.t, by: null });
        }
        for (const t of vecchi) this.sql.exec('DELETE FROM ret WHERE topic = ?', t);
      } catch (e) { this.errDb = String(e && e.message || e); }
    });
    this.sveglia = setInterval(() => this.controlla(), 10000);
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/mqtt/stato') {
      return Response.json({ connessioni: this.conns.size, conservati: this.ret.size, daSalvare: this.sporchi.size, lettiAllAvvio: this.letti, erroreDb: this.errDb || null });
    }
    const coppia = new WebSocketPair();
    const [client, server] = Object.values(coppia);
    server.accept();
    const conn = new Conn(this, server);
    this.conns.add(conn);
    try { server.binaryType = 'arraybuffer'; } catch (e) { }
    let coda = Promise.resolve();   // i messaggi binari possono arrivare come Blob: si leggono in ordine
    server.addEventListener('message', ev => {
      const d = ev.data;
      if (d && typeof d === 'object' && typeof d.arrayBuffer === 'function' && !(d instanceof ArrayBuffer)) coda = coda.then(() => d.arrayBuffer()).then(b => conn.dati(b)).catch(() => conn.chiudi(true));
      else coda = coda.then(() => conn.dati(d)).catch(() => conn.chiudi(true));
    });
    server.addEventListener('close', () => conn.chiudi(true));
    server.addEventListener('error', () => conn.chiudi(true));
    const proto = (req.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(s => s.trim()).filter(Boolean);
    const headers = {};
    const scelto = proto.find(p => p === 'mqtt' || p === 'mqttv3.1');
    if (scelto) headers['Sec-WebSocket-Protocol'] = scelto;
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  entra(conn) {
    const vecchio = this.perId.get(conn.id);
    if (vecchio && vecchio !== conn) { vecchio.will = null; vecchio.chiudi(false); }
    this.perId.set(conn.id, conn);
  }
  esce(conn, conWill) {
    this.conns.delete(conn);
    if (this.perId.get(conn.id) === conn) this.perId.delete(conn.id);
    const w = conn.will; conn.will = null;
    if (conWill && w) {
      // se nel frattempo qualcun altro (di solito la stessa pagina, già ricollegata) ha scritto
      // su quell'argomento, il "testamento" è vecchio: non lo pubblichiamo
      const cur = this.ret.get(w.topic);
      if (!(cur && cur.by && cur.by !== conn && cur.by.vivo)) this.pubblica(w.topic, w.p, w.retain, null);
    }
    if (!this.conns.size) this.salva();
  }

  pubblica(topic, p, retain, da) {
    if (topic === PING_TOPIC) return;       // solo un controllo della connessione
    if (retain) {
      const ora = Date.now();
      if (!p.length) { if (this.ret.delete(topic) && !VOLATILE(topic)) this.segna(topic); }
      else {
        const prima = this.ret.get(topic);
        const uguale = prima && prima.p.length === p.length && prima.p.every((b, i) => b === p[i]);
        this.ret.set(topic, { p, t: ora, by: da });
        if (!VOLATILE(topic) && (!uguale || ora - prima.t > GIORNO)) this.segna(topic);
      }
    }
    for (const c of this.conns) if (c.ok && c.vivo && c.vuole(topic)) c.consegna(topic, p, false);
  }

  conservati(conn, filtri) {
    for (const [f, fp] of filtri) {
      if (!/[+#]/.test(f)) { const r = this.ret.get(f); if (r) conn.consegna(f, r.p, true); continue; }
      const pre = prefisso(f);
      for (const [t, r] of this.ret) if (t.startsWith(pre) && corrisponde(f, fp, t)) conn.consegna(t, r.p, true);
    }
  }

  segna(topic) {
    this.sporchi.add(topic);
    if (!this.timerSalva) this.timerSalva = setTimeout(() => this.salva(), SALVA_DOPO_MS);
  }
  salva() {
    clearTimeout(this.timerSalva); this.timerSalva = null;
    if (!this.sporchi.size) return;
    const lista = [...this.sporchi]; this.sporchi.clear();
    try {
      this.ctx.storage.transactionSync(() => {
        for (const t of lista) {
          const r = this.ret.get(t);
          if (r) this.sql.exec('INSERT OR REPLACE INTO ret (topic, p, t) VALUES (?, ?, ?)', t, r.p, r.t);
          else this.sql.exec('DELETE FROM ret WHERE topic = ?', t);
        }
      });
      this.errDb = '';
    } catch (e) { this.errDb = String(e && e.message || e); }   // limite giornaliero superato ecc.: si continua in memoria
  }

  controlla() {
    const ora = Date.now();
    for (const c of this.conns) {
      if (!c.ok && ora - c.inizio > 20000) c.chiudi(false);
      else if (c.ok && c.ka > 0 && ora - c.ultimo > c.ka * 1500 + 5000) c.chiudi(true);
    }
    if (!this.pulita || ora - this.pulita > 6 * 3600e3) {
      this.pulita = ora;
      for (const [t, r] of this.ret) if (ora - r.t > scadenza(t)) { this.ret.delete(t); if (!VOLATILE(t)) this.segna(t); }
    }
  }
}
