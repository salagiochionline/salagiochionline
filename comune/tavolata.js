/* =========================================================
   TAVOLATA — account, amici, inviti e stanze pubbliche
   File comune a tutti i giochi e alla home.
   - Profilo unico (nome, foto o emoji) usato in ogni gioco.
   - Codice amico, richieste di amicizia, amici online, inviti.
   - Stanze: privata (solo amici invitati), su richiesta (chi entra
     deve essere accettato), pubblica (entra chiunque).
   - Elenco delle partite pubbliche in avvio.
   - Statistiche di tutti i giochi copiate (cifrate) sul server,
     così si ritrovano anche sugli altri dispositivi collegati.
   Niente password: l'account vive sul dispositivo e si collega
   ad altri dispositivi con un link segreto.
   ========================================================= */
(function () {
  'use strict';
  if (window.Tavolata) return;

  /* ---------------- impostazioni ---------------- */
  const SCRIPT = document.currentScript;
  const BASE = (() => { try { return new URL('..', SCRIPT.src).href; } catch (e) { return location.origin + '/'; } })();
  const QS = (() => { try { const q = new URLSearchParams(location.search); return q.get('broker') ? '?broker=' + encodeURIComponent(q.get('broker')) : ''; } catch (e) { return ''; } })();
  const BROKER = (() => { try { const q = new URLSearchParams(location.search); if (q.get('broker')) return q.get('broker'); } catch (e) { } return 'wss://broker.emqx.io:8084/mqtt'; })();
  const TP = 'tavolata/v1/';
  const ONLINE_MS = 75000;          // un amico è online se ha dato segni di vita da meno di così
  const STANZA_MS = 50000;          // una stanza pubblica sparisce se chi l'ha creata non si fa sentire
  const INVITO_MS = 20 * 60000;     // un invito vale 20 minuti

  const GIOCHI = [
    { id: 'crazymonopolio', nome: 'Crazy Monopolio', colore: '#ffcf4a', ico: '🏠', stats: 'gm-stats', nomeK: 'gm-name', tp: 'giramondo-xl/v1/' },
    { id: 'ultima', nome: 'Ultima!', colore: '#ff6b6b', ico: '🃏', stats: 'ul-stats', nomeK: 'ul-name' },
    { id: 'machiavelli', nome: 'Machiavelli', colore: '#4dabf7', ico: '♠️', stats: 'mv-stats', nomeK: 'mv-name' },
    { id: 'scala40', nome: 'Scala 40', colore: '#3ddc84', ico: '🂡', stats: 's40-stats', nomeK: 's40-name' },
    { id: 'yatzy', nome: 'Yatzy', colore: '#b197fc', ico: '🎲', stats: 'yz-stats', nomeK: 'yz-name' },
    { id: 'chiechi', nome: 'Chi è Chi?', colore: '#ff922b', ico: '🕵️', stats: 'cc-stats', nomeK: 'cc-name' },
    { id: 'impostore', nome: 'Impostore', colore: '#f06595', ico: '🎭', stats: 'imp-stats', nomeK: 'imp-name' },
    { id: 'battaglianavale', nome: 'Battaglia Navale', colore: '#22b8cf', ico: '🚢', stats: 'bn-stats', nomeK: 'bn-name' },
    { id: 'paroleincodice', nome: 'Parole in Codice', colore: '#748ffc', ico: '🔎', stats: 'pc-stats', nomeK: 'pc-name' },
    { id: 'chepiccioni', nome: 'Che Piccioni!', colore: '#a9e34b', ico: '🐦', stats: 'cp-stats', nomeK: 'cp-name' },
    { id: 'altobasso', nome: 'Alto Basso', colore: '#38d9a9', ico: '↕️', stats: 'ab-stats', nomeK: 'ab-name' },
    { id: 'lamente', nome: 'La Mente', colore: '#da77f2', ico: '🧠', stats: 'lm-stats', nomeK: 'lm-name' },
    { id: 'nomicosecitta', nome: 'Nomi, Cose, Città', colore: '#ffe066', ico: '✏️', stats: 'ncc-stats', nomeK: 'ncc-name' },
    { id: 'texasholdem', nome: "Texas Hold'em", colore: '#51cf66', ico: '♣️', stats: 'th-stats', nomeK: 'th-name', max: 300 },
    { id: 'blackjack', nome: 'Blackjack', colore: '#fab005', ico: '🂱', stats: 'bj-stats', nomeK: 'bj-name' }
  ];
  const GIOCO = id => GIOCHI.find(g => g.id === id) || null;

  /* ---------------- piccoli aiuti ---------------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ALF = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rid = (n, a) => { a = a || 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; const r = new Uint32Array(n); try { crypto.getRandomValues(r); } catch (e) { for (let i = 0; i < n; i++) r[i] = Math.random() * 1e9; } for (let i = 0; i < n; i++) s += a[r[i] % a.length]; return s; };
  const lsg = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lss = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const jget = k => { try { return JSON.parse(lsg(k) || 'null'); } catch (e) { return null; } };
  const jset = (k, v) => lss(k, JSON.stringify(v));
  const uniq = a => [...new Set(a.filter(Boolean))];
  const hashStr = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + ':' + s.length; };
  const emit = (n, d) => { try { dispatchEvent(new CustomEvent('tavolata:' + n, { detail: d })); } catch (e) { } };
  const COLORI = ['#ef6b94', '#6db4e8', '#63cba8', '#fddc6e', '#e386e6', '#f09a57', '#9e9cd9', '#8fcc5f', '#ff6b6b', '#4dabf7'];
  const EMOJI = ['🐶', '🐱', '🦊', '🐼', '🐨', '🐯', '🦁', '🐸', '🐵', '🦄', '🐙', '🦉', '🐢', '🐧', '🐰', '🐻', '🐝', '🦖', '🌵', '🌻', '🍕', '🍩', '⚽', '🎸', '🚀', '👑', '😎', '🤠', '👻', '🤖'];
  const okFoto = f => typeof f === 'string' && f.length < 70000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(f);
  const okEmoji = e => typeof e === 'string' && e.length > 0 && e.length <= 8 && !/[<>&"']/.test(e);
  const okCol = c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
  const pulisciNome = n => String(n || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16);
  const pulisciProfilo = d => d && typeof d === 'object' ? {
    nome: pulisciNome(d.nome), foto: okFoto(d.foto) ? d.foto : '', emoji: okEmoji(d.emoji) ? d.emoji : '',
    colore: okCol(d.colore) ? d.colore : '#9e9cd9', t: +d.t || 0
  } : null;
  const codiceAmico = id => (id || '').replace(/^u-/, '').replace(/^(....)(....)$/, '$1-$2');
  const idDaCodice = s => { const x = String(s || '').toUpperCase().replace(/^.*[#/]/, '').replace(/^U-/, '').replace(/[^A-Z0-9]/g, ''); return /^[A-Z0-9]{8}$/.test(x) && [...x].every(c => ALF.includes(c)) ? 'u-' + x : null; };
  const quando = t => { const s = Math.round((Date.now() - t) / 1000); if (s < 60) return 'adesso'; const m = Math.round(s / 60); if (m < 60) return m + ' min fa'; const h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' ora fa' : ' ore fa'); return new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); };

  /* =========================================================
     ACCOUNT (sul dispositivo)
     ========================================================= */
  const K = { conto: 'tavolata-conto', amici: 'tavolata-amici', profili: 'tavolata-profili', vis: 'tavolata-vis', sync: 'tavolata-sync', visti: 'tavolata-visti' };
  function nomiTrovati() {
    const n = [];
    GIOCHI.forEach(g => { const v = pulisciNome(lsg(g.nomeK)); if (v) n.push(v); });
    return uniq(n);
  }
  /* TRASLOCO (dal 19/11/2026): il sito si sposta su un nuovo indirizzo.
     Sul vecchio indirizzo una schermata porta al nuovo con l'account nel frammento
     (#trasloco=ID.SEG, come il link segreto: il frammento non arriva a nessun server).
     Sul nuovo indirizzo, se il dispositivo non ha ancora un account suo, lo prende in silenzio;
     nome, amici e statistiche arrivano poi dal server cifrato (o da Google). */
  /* DONAZIONI (Ko-fi): con KOFI = null il pulsante c'è ma è grigio, "presto disponibile".
     Per attivarlo basta mettere il link della pagina, es. 'https://ko-fi.com/tavolata'. */
  const KOFI = 'https://ko-fi.com/tavolatateam';
  /* STATISTICHE VISITE (Cloudflare Web Analytics, gratis e senza cookie): con null sono spente.
     Per attivarle: il "token" che Cloudflare dà in Web Analytics → Add a site (solo le lettere e numeri). */
  const STATISTICHE = 'a043090f27224bd3bed72cda2a8db292';
  const NUOVO_SITO = 'https://salagiochionline.tavolata.workers.dev/';                                // es. 'https://tavolata.pages.dev/'
  const VECCHI_SITI = ['salagiochionline.github.io'];
  const DA_TRASLOCARE = !!NUOVO_SITO && VECCHI_SITI.includes(location.host);
  const TRASLOCO = (() => {
    const m = location.hash.match(/(?:^#|&)trasloco=([A-Z0-9]{8})\.([a-z0-9]{16,40})(?:&h=([^&]*))?/);
    if (!m) return null;
    let h = ''; try { h = m[3] ? decodeURIComponent(m[3]) : ''; } catch (e) { }
    try { history.replaceState(null, '', location.pathname + location.search + (h ? '#' + h : '')); } catch (e) { }
    return { id: 'u-' + m[1], seg: m[2] };
  })();
  let C = jget(K.conto);
  if (TRASLOCO && (!C || !C.id || (C.id !== TRASLOCO.id && !C.nome && (C.t || 0) <= 1 && !((jget(K.amici) || {}).lista || []).length))) {
    C = { id: TRASLOCO.id, seg: TRASLOCO.seg, nome: '', foto: '', emoji: '', colore: (C && C.colore) || COLORI[0], t: 0, nomi: (C && C.nomi) || [], creato: Date.now() };
    jset(K.conto, C); jset(K.amici, { t: 0, lista: [], uscite: [] }); jset(K.sync, null);
    TRASLOCO.fatto = true;
  }
  if (!C || !/^u-[A-Z0-9]{8}$/.test(C.id) || !C.seg) {
    const trovati = nomiTrovati();
    C = { id: 'u-' + rid(8, ALF), seg: rid(22), nome: trovati[0] || '', foto: '', emoji: '', colore: COLORI[Math.floor(Math.random() * COLORI.length)], t: 1, nomi: trovati, creato: Date.now() };
    jset(K.conto, C);
  }
  C.nomi = uniq([...(C.nomi || []), C.nome]);
  let A = jget(K.amici) || {};
  A = { t: A.t || 0, lista: Array.isArray(A.lista) ? A.lista : [], uscite: Array.isArray(A.uscite) ? A.uscite : [] };
  const salvaConto = () => jset(K.conto, C);
  const salvaAmici = (cambio) => { if (cambio) A.t = Date.now(); jset(K.amici, A); emit('amici'); if (cambio) { syncConto(); ggPresto(); } render(); };

  const PROF = Object.assign({}, jget(K.profili) || {});   // profili conosciuti (amici: anche sul dispositivo)
  const salvaProfili = () => { const o = {}; A.lista.forEach(a => { if (PROF[a.id]) o[a.id] = PROF[a.id]; }); jset(K.profili, o); };
  const PRES = {};         // presenza degli amici
  const RIEP = {};         // riepiloghi pubblici (statistiche) di altri
  const STANZE = {};       // stanze pubbliche conosciute: gioco/codice -> dati
  const POSTA = {};        // messaggi ricevuti: tipo/da -> dati
  const chiesti = new Set();

  const eAmico = id => A.lista.some(a => a.id === id);
  function profiloDi(id) {
    if (!id) return null;
    if (id === C.id) return { nome: C.nome, foto: C.foto, emoji: C.emoji, colore: C.colore, t: C.t };
    if (!PROF[id]) chiediProfilo(id);
    const a = A.lista.find(x => x.id === id);
    return PROF[id] || (a ? { nome: a.nome, foto: '', emoji: '', colore: '#9e9cd9' } : null);
  }
  function chiediProfilo(id) { if (!/^u-[A-Z0-9]{8}$/.test(id) || chiesti.has(id)) return; chiesti.add(id); sub('utenti/' + id + '/profilo'); }

  function salvaProfilo(p) {
    const n = {};
    if ('nome' in p) { const v = pulisciNome(p.nome); if (v) n.nome = v; }
    if ('foto' in p) n.foto = okFoto(p.foto) ? p.foto : '';
    if ('emoji' in p) n.emoji = okEmoji(p.emoji) ? p.emoji : '';
    if ('colore' in p && okCol(p.colore)) n.colore = p.colore;
    if (n.foto) n.emoji = '';
    if (n.emoji) n.foto = '';
    Object.assign(C, n); C.t = Date.now();
    if (C.nome && !C.nomi.includes(C.nome)) { C.nomi.push(C.nome); syncConto(); }
    salvaConto();
    GIOCHI.forEach(g => { if (C.nome) lss(g.nomeK, C.nome); });
    pubProfilo(); emit('profilo', profiloDi(C.id)); aggiornaDom(C.id); render(); ggPresto();
    G && G.impostaNome && C.nome && G.impostaNome(C.nome);
  }
  function impostaNome(n) { n = pulisciNome(n); if (n && n !== C.nome) salvaProfilo({ nome: n }); }

  /* foto: ritaglio quadrato 160×160, JPEG leggero */
  function fotoDaFile(file) {
    return new Promise((res, rej) => {
      if (!file || !/^image\//.test(file.type)) return rej(new Error('Scegli un\'immagine'));
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => {
        const s = Math.min(img.naturalWidth, img.naturalHeight), N = 160;
        const cv = document.createElement('canvas'); cv.width = cv.height = N;
        const cx = cv.getContext('2d'); cx.fillStyle = '#2b2647'; cx.fillRect(0, 0, N, N);
        cx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, N, N);
        URL.revokeObjectURL(url);
        let q = 0.85, d = cv.toDataURL('image/jpeg', q);
        while (d.length > 60000 && q > 0.4) { q -= 0.1; d = cv.toDataURL('image/jpeg', q); }
        res(d);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Immagine non valida')); };
      img.src = url;
    });
  }

  /* =========================================================
     RETE: server MQTT pubblico (lo stesso dei giochi)
     ========================================================= */
  const Net = { c: null, ok: false, subs: new Set() };
  function connetti() {
    if (Net.c || typeof window.mqtt === 'undefined') return;
    try {
      Net.c = mqtt.connect(BROKER, {
        clientId: 'tv_' + rid(12), keepalive: 30, reconnectPeriod: 3000, connectTimeout: 10000, clean: true,
        will: { topic: TP + 'presenza/' + C.id, payload: JSON.stringify({ on: false, t: Date.now() }), qos: 0, retain: true }
      });
    } catch (e) { Net.c = null; return; }
    Net.c.on('connect', () => { Net.ok = true; Net.subs.forEach(t => Net.c.subscribe(TP + t, { qos: 0 })); alCollegamento(); render(); });
    Net.c.on('offline', () => { Net.ok = false; render(); });
    Net.c.on('close', () => { Net.ok = false; });
    Net.c.on('error', () => { });
    Net.c.on('message', (topic, payload) => {
      if (!topic.startsWith(TP)) { try { corsoArrivo(topic, payload); } catch (e) { } return; }
      let d = null;
      if (payload && payload.length) { try { d = JSON.parse(payload.toString()); } catch (e) { return; } }
      try { arrivo(topic.slice(TP.length), d); } catch (e) { console.warn('tavolata', e); }
    });
  }
  function sub(t) { if (Net.subs.has(t)) return; Net.subs.add(t); if (Net.ok) Net.c.subscribe(TP + t, { qos: 0 }); }
  function unsub(t) { if (!Net.subs.delete(t)) return; try { Net.ok && Net.c.unsubscribe(TP + t); } catch (e) { } }
  function pub(t, obj, retain) {
    if (!Net.c) return;
    try { Net.c.publish(TP + t, obj == null ? '' : JSON.stringify(obj), { qos: 1, retain: retain !== false }); } catch (e) { }
  }

  function alCollegamento() {
    pubProfilo(); pubPresenza(true); syncConto(); controllaStats(true); pubRiepilogo(true);
  }
  function pubProfilo() { if (!C.nome || !C.t) return; pub('utenti/' + C.id + '/profilo', { id: C.id, nome: C.nome, foto: C.foto, emoji: C.emoji, colore: C.colore, t: C.t }); }

  /* ---------------- presenza ---------------- */
  let ultimaPres = '', presT = 0;
  function dove() {
    if (G) {
      const st = statoGioco();
      const S = st && st.S;
      const stanza = st && st.view === 'game' && st.code && S && S.status === 'lobby' && S.vis !== 'privata'
        ? { gioco: G.id, code: st.code, vis: S.vis || 'pubblica' } : null;
      return { dove: G.id, stanza, gioca: !!(st && st.view === 'game' && S && S.status === 'playing') };
    }
    return { dove: (document.body && document.body.dataset.tvPagina) || 'home', stanza: null, gioca: false };
  }
  function pubPresenza(forza) {
    if (!Net.ok) return;
    const d = dove(); const key = JSON.stringify(d);
    if (!forza && key === ultimaPres && Date.now() - presT < 25000) return;
    ultimaPres = key; presT = Date.now();
    pub('presenza/' + C.id, Object.assign({ on: true, t: Date.now() }, d));
  }
  const online = id => { const p = PRES[id]; return !!(p && p.on && Date.now() - p.t < ONLINE_MS); };

  /* ---------------- messaggi in arrivo ---------------- */
  function arrivo(t, d) {
    const p = t.split('/');
    if (p[0] === 'utenti' && p[2] === 'profilo') {
      const id = p[1];
      const pr = pulisciProfilo(d);
      if (id === C.id) {
        if (pr && pr.t > C.t && pr.nome) { Object.assign(C, { nome: pr.nome, foto: pr.foto, emoji: pr.emoji, colore: pr.colore, t: pr.t }); C.nomi = uniq([...C.nomi, pr.nome]); salvaConto(); GIOCHI.forEach(g => lss(g.nomeK, C.nome)); emit('profilo', profiloDi(C.id)); G && G.impostaNome && G.impostaNome(C.nome); aggiornaDom(C.id); render(); }
        else if (!pr || pr.t < C.t) pubProfilo();
        return;
      }
      if (!pr || !pr.nome) return;
      PROF[id] = pr;
      const a = A.lista.find(x => x.id === id);
      if (a && a.nome !== pr.nome) { a.nome = pr.nome; jset(K.amici, A); }
      if (a) salvaProfili();
      aggiornaDom(id); emit('profili', { id }); render();
    } else if (p[0] === 'utenti' && p[2] === 'riepilogo') {
      if (d && typeof d === 'object') { RIEP[p[1]] = d; emit('riepilogo', { id: p[1] }); }
    } else if (p[0] === 'presenza') {
      if (p[1] === C.id) { if (d && !d.on && Net.ok) pubPresenza(true); return; }
      PRES[p[1]] = d && typeof d === 'object' ? { on: !!d.on, t: +d.t || 0, dove: String(d.dove || ''), gioca: !!d.gioca, stanza: d.stanza && typeof d.stanza === 'object' ? { gioco: String(d.stanza.gioco || ''), code: String(d.stanza.code || '').slice(0, 5), vis: String(d.stanza.vis || '') } : null } : null;
      emit('presenza', { id: p[1] }); render();
    } else if (p[0] === 'posta' && p[1] === C.id) {
      riceviPosta(p[2], p[3], d);
    } else if (p[0] === 'privato') {
      riceviPrivato(p.slice(2).join('/'), d);
    } else if (p[0] === 'stanze') {
      const k = p[1] + '/' + p[2];
      if (d && typeof d === 'object' && d.code) STANZE[k] = {
        gioco: p[1], code: String(d.code).slice(0, 5), host: String(d.host || ''), hostNome: pulisciNome(d.hostNome), vis: d.vis === 'richiesta' ? 'richiesta' : 'pubblica',
        n: +d.n || 0, max: +d.max || 0, t: +d.t || 0
      };
      else delete STANZE[k];
      if (STANZE[k]) chiediProfilo(STANZE[k].host);
      emit('stanze'); render();
    }
  }

  /* =========================================================
     AMICI, RICHIESTE, INVITI (posta: tavolata/v1/posta/<a chi>/<tipo>/<da chi>)
     ========================================================= */
  function svuota(tipo, da) { delete POSTA[tipo + '/' + da]; pub('posta/' + C.id + '/' + tipo + '/' + da, null); }
  function riceviPosta(tipo, da, d) {
    if (!/^u-[A-Z0-9]{8}$/.test(da || '') || da === C.id) return;
    const key = tipo + '/' + da;
    if (!d) { delete POSTA[key]; render(); return; }
    if (tipo === 'amicizia') {
      if (eAmico(da)) { svuota(tipo, da); rispondi(da, true); return; }
      if (A.uscite.some(u => u.id === da)) { aggiungiAmico(da, d.nome); svuota(tipo, da); rispondi(da, true); return; }
      POSTA[key] = { tipo, da, nome: pulisciNome(d.nome) || 'Qualcuno', t: +d.t || Date.now() };
      chiediProfilo(da);
    } else if (tipo === 'risposta') {
      const era = A.uscite.find(u => u.id === da);
      A.uscite = A.uscite.filter(u => u.id !== da);
      if (d.ok) { if (!eAmico(da)) { aggiungiAmico(da, d.nome, true); avviso(`🎉 ${pulisciNome(d.nome) || 'Un amico'} ha accettato la tua amicizia`); } }
      else if (era) salvaAmici(true);
      svuota(tipo, da); return;
    } else if (tipo === 'nuovoid') {
      /* un amico è passato a un altro account (accesso con Google o link segreto): si aggiorna la lista */
      const nuovo = d && String(d.nuovo || '');
      if (/^u-[A-Z0-9]{8}$/.test(nuovo) && nuovo !== C.id && (eAmico(da) || A.uscite.some(u => u.id === da))) {
        const v = A.lista.find(a => a.id === da);
        A.lista = A.lista.filter(a => a.id !== da);
        A.uscite = A.uscite.filter(u => u.id !== da);
        if (!eAmico(nuovo)) A.lista.push({ id: nuovo, nome: pulisciNome(d.nome) || (v && v.nome) || 'Amico', da: (v && v.da) || Date.now() });
        unsub('presenza/' + da); sub('presenza/' + nuovo); chiediProfilo(nuovo); salvaAmici(true); salvaProfili();
      }
      svuota(tipo, da); return;
    } else if (tipo === 'rimozione') {
      if (eAmico(da)) { A.lista = A.lista.filter(a => a.id !== da); salvaAmici(true); }
      svuota(tipo, da); return;
    } else if (tipo === 'invito') {
      const gi = GIOCO(d.gioco); const code = String(d.code || '').toUpperCase();
      if (!gi || !/^[A-Z0-9]{5}$/.test(code) || Date.now() - (+d.t || 0) > INVITO_MS) { svuota(tipo, da); return; }
      const nuovo = !POSTA[key] || POSTA[key].code !== code;
      POSTA[key] = { tipo, da, nome: pulisciNome(d.nome) || 'Un amico', gioco: gi.id, code, t: +d.t };
      if (nuovo) { suona(); vibra(); }
    } else return;
    render(); emit('posta');
  }
  function aggiungiAmico(id, nome, giaSalva) {
    if (id === C.id) return;
    if (!eAmico(id)) A.lista.push({ id, nome: pulisciNome(nome) || 'Amico', da: Date.now() });
    A.uscite = A.uscite.filter(u => u.id !== id);
    sub('presenza/' + id); chiediProfilo(id); salvaAmici(true); salvaProfili();
  }
  function rispondi(id, ok) { pub('posta/' + id + '/risposta/' + C.id, { ok, nome: C.nome, t: Date.now() }); }
  function chiediAmicizia(idOCodice) {
    const id = idDaCodice(idOCodice) || (/^u-[A-Z0-9]{8}$/.test(idOCodice) ? idOCodice : null);
    if (!id) return { ok: false, msg: 'Il codice amico ha 8 caratteri (per esempio ABCD-EF23).' };
    if (id === C.id) return { ok: false, msg: 'Questo è il tuo codice!' };
    if (eAmico(id)) return { ok: false, msg: 'Siete già amici.' };
    if (!C.nome) return { ok: false, msg: 'Prima scegli il tuo nome.' };
    if (POSTA['amicizia/' + id]) { accettaAmicizia(id); return { ok: true, msg: 'Ora siete amici!' }; }
    if (!A.uscite.some(u => u.id === id)) A.uscite.push({ id, t: Date.now() });
    pub('posta/' + id + '/amicizia/' + C.id, { nome: C.nome, t: Date.now() });
    chiediProfilo(id); salvaAmici(true);
    return { ok: true, msg: 'Richiesta inviata: quando la accetta, la trovi tra gli amici.' };
  }
  function accettaAmicizia(id) { const m = POSTA['amicizia/' + id]; aggiungiAmico(id, m ? m.nome : ''); rispondi(id, true); svuota('amicizia', id); render(); }
  function rifiutaAmicizia(id) { rispondi(id, false); svuota('amicizia', id); render(); }
  function annullaRichiesta(id) { A.uscite = A.uscite.filter(u => u.id !== id); pub('posta/' + id + '/amicizia/' + C.id, null); salvaAmici(true); }
  function rimuoviAmico(id) { A.lista = A.lista.filter(a => a.id !== id); pub('posta/' + id + '/rimozione/' + C.id, { t: Date.now() }); unsub('presenza/' + id); salvaAmici(true); salvaProfili(); }

  /* invito a una stanza: chi crea la partita lo aggiunge anche agli ammessi */
  const invitati = {};
  function invita(id) {
    const st = statoGioco(); if (!st || !st.code || !st.S) return;
    const S = st.S;
    if (S.host === C.id && S.vis && S.vis !== 'pubblica' && !(S.allow || []).includes(id)) G.act(N => { N.allow = uniq([...(N.allow || []), id]); });
    pub('posta/' + id + '/invito/' + C.id, { nome: C.nome, gioco: G.id, code: st.code, t: Date.now() });
    invitati[st.code + '/' + id] = Date.now();
    avviso('📨 Invito mandato a ' + ((profiloDi(id) || {}).nome || 'un amico'));
    render();
  }
  function rifiutaInvito(da) { svuota('invito', da); render(); }
  function accettaInvito(da) { const m = POSTA['invito/' + da]; svuota('invito', da); if (m) vai(m.gioco, m.code); }

  /* andare a una partita (anche in un altro gioco) */
  function vai(gioco, code) {
    const gi = GIOCO(gioco); if (!gi) return;
    chiudiPannello();
    const st = statoGioco();
    const fai = () => {
      if (G && G.id === gioco) { G.entra(code); }
      else location.href = BASE + gi.id + '/' + QS + '#' + code;
    };
    if (st && st.view === 'game' && st.S && st.S.status === 'playing' && st.code !== code) {
      conferma('Stai giocando una partita', 'Se esci adesso, la partita continua senza di te. Vuoi andare lo stesso?', 'Vai', fai);
    } else fai();
  }

  /* =========================================================
     STATISTICHE: riepilogo per gioco + copia cifrata sul server
     ========================================================= */
  const n0 = v => +v || 0;
  const maxOf = (rs, f) => rs.reduce((a, r) => { const v = f(r); return typeof v === 'number' && isFinite(v) ? Math.max(a, v) : a; }, -Infinity);
  const minOf = (rs, f) => rs.reduce((a, r) => { const v = f(r); return typeof v === 'number' && isFinite(v) ? Math.min(a, v) : a; }, Infinity);
  const sumOf = (rs, f) => rs.reduce((a, r) => a + n0(f(r)), 0);
  const fin = v => isFinite(v) ? v : '–';
  const it = n => Math.round(n).toLocaleString('it-IT');
  const RIASSUNTI = {
    crazymonopolio: rs => ({ vinte: rs.filter(r => r.won).length, conAltri: rs.length, extra: [['💰 Patrimonio record', fin(maxOf(rs, r => r.st && r.st.peak)), v => v === '–' ? v : it(v) + ' €'], ['🏨 Hotel costruiti', sumOf(rs, r => r.st && r.st.ho)]] }),
    ultima: rs => ({ extra: [['🃏 Mani vinte', sumOf(rs, r => r.roundsWon)]] }),
    machiavelli: rs => ({ extra: [['🃏 Mani vinte', sumOf(rs, r => r.roundsWon)]] }),
    scala40: rs => ({ extra: [['🃏 Mani vinte', sumOf(rs, r => r.roundsWon)]] }),
    yatzy: rs => ({ extra: [['🏆 Record di punti', fin(maxOf(rs, r => Math.max(0, ...(r.scores || [0]))))], ['🎲 Yatzy fatti', sumOf(rs, r => r.st && r.st.yatzy)]] }),
    altobasso: rs => ({ extra: [['⬇️ Punteggio più basso', fin(minOf(rs.filter(r => !r.removed && r.rounds <= 1), r => r.total))]] }),
    blackjack: rs => ({ extra: [['🪙 Record di fiches', fin(maxOf(rs, r => r.chips)), v => v === '–' ? v : it(v)]] }),
    battaglianavale: rs => ({ extra: [['🚢 Navi affondate', sumOf(rs, r => r.st && r.st.sinks)], ['🛡️ Vittorie perfette', sumOf(rs, r => r.st && r.st.perfect)]] }),
    paroleincodice: rs => ({ extra: [['🤝 Pareggi', rs.filter(r => r.draw).length]] }),
    chepiccioni: rs => ({ vinte: rs.filter(r => r.champ || (r.rounds && r.rounds.length === 1 && r.rounds[0].won)).length, extra: [['🐦 Manche vinte', sumOf(rs, r => (r.rounds || []).filter(x => x.won).length)]] }),
    chiechi: rs => ({ extra: [['🤝 Pareggi', rs.filter(r => r.draw).length]] }),
    impostore: rs => ({ extra: [['⭐ Punti fatti', sumOf(rs, r => r.pts)]] }),
    lamente: rs => ({ extra: [['🧠 Livello più alto', fin(maxOf(rs, r => r.best))]] }),
    nomicosecitta: rs => ({ extra: [['🏆 Record di punti', fin(maxOf(rs, r => r.total))]] }),
    texasholdem: rs => ({ vinte: rs.filter(r => r.place === 1 && r.n > 1).length, extra: [['🪙 Record di fiches', fin(maxOf(rs, r => r.chips)), v => v === '–' ? v : it(v)]] })
  };
  function partiteDi(g, nomi) {
    let rs = jget(g.stats); if (!Array.isArray(rs)) return [];
    rs = rs.filter(r => r && typeof r === 'object' && r.st !== true);
    if (nomi) { const s = new Set(nomi); rs = rs.filter(r => s.has(r.name)); }
    return rs.sort((a, b) => (b.t || 0) - (a.t || 0));
  }
  function riassunto(g, rs) {
    const base = { partite: rs.length, vinte: rs.filter(r => r.won).length, conAltri: rs.filter(r => (r.n || 2) > 1 && !r.removed).length, ultima: rs.length ? rs[0].t : 0, extra: [] };
    let x = {}; try { x = (RIASSUNTI[g.id] || (() => ({})))(rs) || {}; } catch (e) { }
    const out = Object.assign(base, x);
    out.extra = (out.extra || []).map(([l, v, f]) => [l, f ? f(v) : (typeof v === 'number' ? it(v) : v)]);
    return out;
  }
  function riepilogoLocale() {
    const giochi = {};
    GIOCHI.forEach(g => { const rs = partiteDi(g, C.nomi); if (rs.length) { const r = riassunto(g, rs); giochi[g.id] = { p: r.partite, v: r.vinte, a: r.conAltri, u: r.ultima, x: r.extra }; } });
    return giochi;
  }
  let riepHash = '', riepT = 0;
  function pubRiepilogo(forza) {
    if (!Net.ok || !C.nome) return;
    if (!forza && Date.now() - riepT < 20000) return;
    riepT = Date.now();
    const g = riepilogoLocale(); const h = hashStr(JSON.stringify(g));
    if (h === riepHash && !forza) return;
    riepHash = h;
    pub('utenti/' + C.id + '/riepilogo', { t: Date.now(), giochi: g });
  }

  /* ---- copia privata (cifrata con la chiave dell'account) ---- */
  const CR = { key: null, topic: null, pronto: null };
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function streamBytes(u8, Stream, mode) { const s = new Blob([u8]).stream().pipeThrough(new Stream(mode)); return new Uint8Array(await new Response(s).arrayBuffer()); }
  function preparaCifra() {
    if (CR.pronto) return CR.pronto;
    CR.pronto = (async () => {
      if (!(window.crypto && crypto.subtle)) return false;
      const enc = new TextEncoder();
      const kraw = await crypto.subtle.digest('SHA-256', enc.encode('tavolata-chiave:' + C.seg));
      CR.key = await crypto.subtle.importKey('raw', kraw, 'AES-GCM', false, ['encrypt', 'decrypt']);
      const th = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('tavolata-posto:' + C.id + ':' + C.seg)));
      CR.topic = 'privato/' + [...th.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
      sub(CR.topic + '/#');
      return true;
    })().catch(() => false);
    return CR.pronto;
  }
  async function cifra(obj) {
    let u8 = new TextEncoder().encode(JSON.stringify(obj)); let z = false;
    if (typeof CompressionStream !== 'undefined') { try { u8 = await streamBytes(u8, CompressionStream, 'gzip'); z = true; } catch (e) { } }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, CR.key, u8));
    const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
    return { v: 1, z, d: b64(all) };
  }
  async function decifra(m) {
    const all = unb64(m.d); let u8 = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, CR.key, all.slice(12)));
    if (m.z) u8 = await streamBytes(u8, DecompressionStream, 'gzip');
    return JSON.parse(new TextDecoder().decode(u8));
  }
  async function pubPrivato(nome, obj) {
    if (!(await preparaCifra()) || !Net.ok) return false;
    pub(CR.topic + '/' + nome, await cifra(obj)); return true;
  }
  async function riceviPrivato(nome, m) {
    if (!m || !m.d || !(await preparaCifra())) return;
    let d; try { d = await decifra(m); } catch (e) { return; }
    if (nome === 'conto') {
      C.nomi = uniq([...C.nomi, ...(Array.isArray(d.nomi) ? d.nomi.map(pulisciNome) : [])]); salvaConto();
      if ((+d.t || 0) > A.t) {
        A = { t: +d.t, lista: (d.lista || []).filter(a => a && /^u-[A-Z0-9]{8}$/.test(a.id)).map(a => ({ id: a.id, nome: pulisciNome(a.nome), da: +a.da || 0 })), uscite: (d.uscite || []).filter(u => u && /^u-[A-Z0-9]{8}$/.test(u.id)) };
        jset(K.amici, A); A.lista.forEach(a => { sub('presenza/' + a.id); chiediProfilo(a.id); });
        emit('amici'); render();
      } else if ((+d.t || 0) < A.t) syncConto();
    } else if (nome.startsWith('stats/')) {
      uniscStats(nome.slice(6), d);
    }
  }
  function syncConto() { if (!Net.ok) return; pubPrivato('conto', { t: A.t, lista: A.lista, uscite: A.uscite, nomi: C.nomi }); }

  let SY = jget(K.sync) || {};
  const salvaSY = () => jset(K.sync, SY);
  function controllaStats(forza) {
    if (!Net.ok) return;
    GIOCHI.forEach(g => {
      let rs = jget(g.stats); if (!Array.isArray(rs)) rs = [];
      const keys = rs.map(r => r && r.k).filter(Boolean);
      const s = SY[g.stats] || (SY[g.stats] = { last: [], tomb: [], inviato: '' });
      const set = new Set(keys);
      const tolte = (s.last || []).filter(k => !set.has(k));
      if (tolte.length) s.tomb = uniq([...(s.tomb || []), ...tolte]).slice(-600);
      s.last = keys;
      const h = hashStr(keys.join('|') + '#' + (s.tomb || []).length);
      if ((forza && keys.length) || h !== s.inviato) {
        if (!keys.length && !(s.tomb || []).length) { s.inviato = h; return; }
        s.inviato = h;
        pubPrivato('stats/' + g.stats, { t: Date.now(), recs: rs, tomb: s.tomb || [] });
      }
    });
    salvaSY();
  }
  let statsEmitT = null;
  function uniscStats(key, d) {
    const g = GIOCHI.find(x => x.stats === key); if (!g || !d || !Array.isArray(d.recs)) return;
    const s = SY[key] || (SY[key] = { last: [], tomb: [], inviato: '' });
    const tomb = new Set([...(s.tomb || []), ...(Array.isArray(d.tomb) ? d.tomb : [])]);
    let rs = jget(key); if (!Array.isArray(rs)) rs = [];
    const map = new Map();
    rs.forEach(r => { if (r && r.k && !tomb.has(r.k)) map.set(r.k, r); });
    const prima = rs.length;
    d.recs.forEach(r => { if (r && typeof r === 'object' && typeof r.k === 'string' && !tomb.has(r.k) && !map.has(r.k)) map.set(r.k, r); });
    const out = [...map.values()].sort((a, b) => (a.t || 0) - (b.t || 0)).slice(-(g.max || 200));
    s.tomb = [...tomb].slice(-600);
    const keys = out.map(r => r.k);
    const remKeys = new Set(d.recs.map(r => r && r.k));
    const cambiato = out.length !== prima || keys.some((k, i) => !rs[i] || rs[i].k !== k);
    if (cambiato) lss(key, JSON.stringify(out));
    s.last = keys;
    if (keys.length === remKeys.size && keys.every(k => remKeys.has(k))) s.inviato = hashStr(keys.join('|') + '#' + s.tomb.length);
    salvaSY();
    if (cambiato) { clearTimeout(statsEmitT); statsEmitT = setTimeout(() => { emit('stats'); render(); }, 300); }
  }

  /* dopo un cambio di account: gli amici del vecchio account passano al nuovo */
  function avvisaCambioId(vecchioId, amici) {
    amici.forEach(a => { if (a && /^u-[A-Z0-9]{8}$/.test(a.id) && a.id !== C.id) pub('posta/' + a.id + '/nuovoid/' + vecchioId, { nuovo: C.id, nome: C.nome, t: Date.now() }); });
  }
  /* ---- collegare un altro dispositivo ---- */
  function linkDispositivo() { return BASE + 'profilo/' + QS + '#collega=' + C.id.slice(2) + '.' + C.seg; }
  function collegaDa(testo) {
    const m = String(testo || '').match(/([A-Z0-9]{8})\.([a-z0-9]{16,40})/);
    if (!m) return { ok: false, msg: 'Il link non è giusto: copialo di nuovo dall\'altro dispositivo.' };
    const id = 'u-' + m[1];
    if (id === C.id) return { ok: true, msg: 'Questo dispositivo è già collegato a questo account.' };
    try { pub('presenza/' + C.id, { on: false, t: Date.now() }); } catch (e) { }
    const vecchiNomi = C.nomi, vecchioId = C.id;
    C = { id, seg: m[2], nome: C.nome, foto: C.foto, emoji: C.emoji, colore: C.colore, t: 0, nomi: uniq([...vecchiNomi]), creato: Date.now() };
    salvaConto();
    A = { t: 0, lista: A.lista.filter(a => a.id !== id), uscite: A.uscite }; jset(K.amici, A);
    avvisaCambioId(vecchioId, A.lista);
    SY = {}; salvaSY();
    return { ok: true, msg: 'Fatto! Questo dispositivo ora usa lo stesso account.', ricarica: true };
  }

  /* =========================================================
     PARTITE IN CORSO: nella home di ogni gioco, per rientrare
     se ci si è disconnessi o si è chiusa la pagina.
     - Si segna la partita mentre ci sei dentro (in attesa o in corso).
     - Quando finisce (status 'ended') sparisce; prima di mostrarla si
       controlla sul server che esista ancora, non sia finita e ci sia tu.
     - Le statistiche non c'entrano: restano come sono.
     ========================================================= */
  K.corso = 'tavolata-in-corso';
  const CORSO_MAX = 3 * 864e5;                 // dopo 3 giorni una partita si considera abbandonata
  const VER = {};                              // gioco/codice -> { ok, stato, doc, mio, t }
  const RAW = {};                              // argomento MQTT del gioco -> gioco/codice
  const tpDi = g => (GIOCO(g) && GIOCO(g).tp) || ('tavolata-' + g + '/v1/');
  function corsoTutte() { const o = jget(K.corso); return o && typeof o === 'object' ? o : {}; }
  function corsoLista(g) { const now = Date.now(); return (corsoTutte()[g] || []).filter(e => e && /^[A-Z0-9]{4,8}$/.test(e.code) && now - (e.t || 0) < CORSO_MAX); }
  function corsoSalva(g, L) { const o = corsoTutte(); if (L.length) o[g] = L; else delete o[g]; jset(K.corso, o); }
  function corsoServe(g, code, stato) { const e = corsoLista(g).find(x => x.code === code); return !e || e.stato !== stato || Date.now() - e.t > 60000; }
  function segnaCorso(g, code, stato) {
    const L = corsoLista(g).filter(x => x.code !== code);
    corsoSalva(g, [{ code, t: Date.now(), stato }, ...L].slice(0, 6));
    const v = VER[g + '/' + code]; VER[g + '/' + code] = Object.assign(v || {}, { ok: true, stato, t: Date.now() });
  }
  function togliCorso(g, code) {
    const L = corsoLista(g); delete VER[g + '/' + code];
    if (!L.some(x => x.code === code)) return;
    corsoSalva(g, L.filter(x => x.code !== code)); render();
  }
  /* controllo sul server: documento della partita + posti */
  function verificaCorso(g) {
    if (!Net.ok || !Net.c) return;
    corsoLista(g).forEach(e => {
      const k = g + '/' + e.code; const v = VER[k];
      if (v && (v.verifica || Date.now() - v.t < 60000)) return;
      const base = tpDi(g) + 'games/' + e.code;
      VER[k] = { ok: v ? v.ok : null, verifica: true, stato: v && v.stato, host: v && v.host, doc: undefined, mio: false, t: Date.now() };
      RAW[base] = k;
      try { Net.c.subscribe([base, base + '/seats/+'], { qos: 0 }); } catch (err) { }
      setTimeout(() => valutaCorso(g, e.code, base), 3500);
    });
  }
  function corsoArrivo(topic, payload) {
    let base = null;
    if (RAW[topic]) base = topic;
    else { const i = topic.indexOf('/seats/'); if (i > 0 && RAW[topic.slice(0, i)]) base = topic.slice(0, i); }
    if (!base) return;
    const v = VER[RAW[base]]; if (!v || !v.verifica) return;
    let d = null; if (payload && payload.length) { try { d = JSON.parse(payload.toString()); } catch (e) { return; } }
    if (base === topic) v.doc = d;
    else if (d && topic.endsWith('/seats/' + C.id)) v.mio = true;
  }
  function valutaCorso(g, code, base) {
    try { Net.c && Net.c.unsubscribe([base, base + '/seats/+']); } catch (e) { }
    delete RAW[base];
    const k = g + '/' + code; const v = VER[k]; if (!v || !v.verifica) return;
    v.verifica = false;
    if (!Net.ok) { v.ok = null; v.t = 0; return; }          // senza connessione non si decide niente
    const d = v.doc;
    let ok;
    if (!d || typeof d !== 'object') ok = false;           // partita sparita dal server
    else if (d.status === 'ended') ok = false;             // finita
    else if (d.status === 'lobby') ok = v.mio || d.host === C.id;
    else ok = JSON.stringify(d).includes(C.id);           // in corso: ci sei ancora tra i giocatori?
    v.ok = ok; v.stato = d && d.status; v.host = d && (d.hostName || ''); v.doc = undefined; v.t = Date.now();
    if (!ok) togliCorso(g, code); else render();
  }
  function corsoHTML(g) {
    const L = corsoLista(g).filter(e => VER[g + '/' + e.code] && VER[g + '/' + e.code].ok === true);
    if (!L.length) return '';
    return `<h3>🔄 Le tue partite in corso</h3>
      <div class="tv-small tv-mut" style="margin-bottom:8px">Ti sei disconnesso o hai chiuso la pagina? Rientra da qui. Quando la partita finisce, sparisce da sola.</div>
      <div class="tv-list">${L.map(e => { const v = VER[g + '/' + e.code]; return `<div class="tv-item"><div class="tv-tx"><b>Partita ${esc(e.code)}${v.host ? ' di ' + esc(v.host) : ''}</b><small>${v.stato === 'lobby' ? 'In attesa di iniziare' : '🎮 In corso'} · ${esc(quando(e.t))}</small></div><button class="tv-btn tv-sm tv-pri" data-tv="unisciti" data-g="${esc(g)}" data-c="${esc(e.code)}">Rientra</button></div>`; }).join('')}</div>`;
  }

  /* =========================================================
     ACCESSO CON GOOGLE (Firebase) — copia dell'account nel cloud
     - Facoltativo: chi non accede continua come prima (account sul dispositivo).
     - Su Firestore, nel documento utenti/<uid Google>: id e chiave dell'account
       Tavolata, profilo, nomi usati, amici. Nella sottocartella stats/ una copia
       delle statistiche di ogni gioco. Le regole di Firestore permettono a
       ciascuno di leggere e scrivere solo i propri documenti.
     - Accedendo su un altro dispositivo (o su un altro indirizzo del sito)
       si ritrova lo stesso account; le statistiche di quel dispositivo si sommano.
     ========================================================= */
  const FIREBASE = {       // progetto Firebase "Tavolata" (questi dati non sono segreti: proteggono le regole di Firestore)
    apiKey: 'AIzaSyApcqPk0l86K8pNnSZ3EZlZpWmwwZMXVSY',
    authDomain: 'tavolata-b9f07.firebaseapp.com',
    projectId: 'tavolata-b9f07',
    storageBucket: 'tavolata-b9f07.firebasestorage.app',
    messagingSenderId: '191403562558',
    appId: '1:191403562558:web:ed4d00cc2fef7e370ba36f'
  };
  const FB_VER = '13.3.0';
  const FB_URL = 'https://www.gstatic.com/firebasejs/' + FB_VER + '/';
  K.google = 'tavolata-google';
  const GG = { m: null, auth: null, db: null, user: null, pronto: null, stato: FIREBASE ? 'fuori' : 'assente', msg: '', ultimo: 0, occupato: false, blocco: false, popup: false, hash: {}, presto: null };
  const ggInfo = () => jget(K.google);
  function ggCambio() { emit('google', ggStato()); render(); }
  function ggStato() {
    const i = ggInfo() || {};
    return { disponibile: !!FIREBASE, stato: GG.stato, email: GG.user ? GG.user.email : i.email || '', nome: GG.user ? GG.user.displayName : i.nome || '', ultimo: GG.ultimo || i.ultimo || 0, msg: GG.msg };
  }
  function ggErrore(e) {
    const c = (e && e.code) || '';
    if (/popup-closed-by-user|cancelled-popup-request|user-cancelled/.test(c)) return '';
    if (/popup-blocked/.test(c)) return 'Il browser ha bloccato la finestra di Google: permetti i popup per questo sito e riprova.';
    if (/unauthorized-domain/.test(c)) return 'Questo indirizzo del sito non è ancora autorizzato in Firebase (Authentication → Impostazioni → Domini autorizzati).';
    if (/network-request-failed|unavailable/.test(c)) return 'Problema di connessione: riprova tra poco.';
    if (/operation-not-supported|web-storage-unsupported|disallowed/.test(c)) return 'Questo browser non permette l\'accesso con Google: apri il sito in Chrome, Safari o Firefox (non dentro WhatsApp o Instagram).';
    if (/permission-denied/.test(c)) return 'Firebase ha rifiutato il salvataggio: controlla le regole di Firestore.';
    if (/operation-not-allowed|configuration-not-found/.test(c)) return 'L\'accesso con Google non è attivo in Firebase (Authentication → Metodo di accesso → Google).';
    return 'Qualcosa non ha funzionato con Google' + (c ? ' (' + c + ')' : '') + '. Riprova.';
  }
  /* carica Firebase solo quando serve (chi non usa Google non scarica nulla) */
  function ggCarica() {
    if (!FIREBASE) return Promise.resolve(false);
    if (GG.pronto) return GG.pronto;
    GG.pronto = Promise.all([import(FB_URL + 'firebase-app.js'), import(FB_URL + 'firebase-auth.js'), import(FB_URL + 'firebase-firestore.js')])
      .then(([app, au, fs]) => {
        const a = app.initializeApp(FIREBASE, 'tavolata');
        GG.m = { au, fs }; GG.auth = au.getAuth(a); GG.db = fs.getFirestore(a);
        au.onAuthStateChanged(GG.auth, u => { ggUtente(u); });
        return true;
      })
      .catch(e => { console.warn('tavolata google', e); GG.pronto = null; GG.msg = 'Non riesco a caricare l\'accesso con Google: controlla la connessione.'; ggCambio(); return false; });
    return GG.pronto;
  }
  async function ggAccedi() {
    if (!FIREBASE || GG.occupato) return;
    GG.msg = '';
    if (!GG.m) { GG.stato = 'carico'; ggCambio(); const ok = await ggCarica(); if (!ok) { GG.stato = 'fuori'; return ggCambio(); } }
    const { au } = GG.m;
    try {
      const prov = new au.GoogleAuthProvider(); prov.setCustomParameters({ prompt: 'select_account' });
      GG.stato = 'carico'; GG.popup = true; ggCambio();
      await au.signInWithPopup(GG.auth, prov);   // poi pensa a tutto onAuthStateChanged
      GG.popup = false;
    } catch (e) { GG.popup = false; GG.stato = GG.user ? 'dentro' : 'fuori'; GG.msg = ggErrore(e); ggCambio(); }
  }
  async function ggEsci() {
    try { await ggInvia(); } catch (e) { }
    try { if (GG.m) await GG.m.au.signOut(GG.auth); } catch (e) { }
    jset(K.google, null); GG.user = null; GG.stato = FIREBASE ? 'fuori' : 'assente'; GG.hash = {}; GG.ultimo = 0; ggCambio();
    avviso('Sei uscito da Google. Su questo dispositivo continui a giocare con lo stesso account.');
  }
  async function ggElimina() {
    if (!GG.user) return;
    const { fs } = GG.m; const uid = GG.user.uid;
    try {
      const qs = await fs.getDocs(fs.collection(GG.db, 'utenti', uid, 'stats'));
      await Promise.all(qs.docs.map(d => fs.deleteDoc(d.ref)));
      await fs.deleteDoc(fs.doc(GG.db, 'utenti', uid));
    } catch (e) { GG.msg = ggErrore(e); ggCambio(); return; }
    try { await GG.m.au.signOut(GG.auth); } catch (e) { }
    jset(K.google, null); GG.user = null; GG.stato = 'fuori'; GG.hash = {}; GG.ultimo = 0; ggCambio();
    avviso('🗑️ Dati cancellati da Google. Su questo dispositivo l\'account resta.');
  }
  async function ggUtente(u) {
    if (!u) {
      GG.user = null;
      if (ggInfo()) jset(K.google, null);
      if (!GG.popup) { GG.stato = 'fuori'; ggCambio(); }
      return;
    }
    GG.user = u; GG.stato = 'dentro';
    const i = ggInfo() || {};
    const nuovo = i.uid !== u.uid;
    if (nuovo) GG.hash = {}; else GG.hash = i.hash || {};
    jset(K.google, { uid: u.uid, email: u.email || '', nome: u.displayName || '', ultimo: nuovo ? 0 : i.ultimo || 0, hash: GG.hash });
    ggCambio();
    await ggAllinea(nuovo);
  }
  /* il contenuto del documento principale */
  function ggDati() {
    return { v: 1, id: C.id, seg: C.seg, creato: C.creato || 0, nomi: C.nomi, profilo: { nome: C.nome, foto: C.foto, emoji: C.emoji, colore: C.colore, t: C.t }, amici: { t: A.t, lista: A.lista, uscite: A.uscite } };
  }
  function ggUnisci(x) {
    let cambio = false;
    const p = pulisciProfilo(x.profilo);
    if (p && p.t > C.t) {
      if (p.nome) C.nome = p.nome;
      C.foto = p.foto; C.emoji = p.emoji; C.colore = p.colore; C.t = p.t; cambio = true;
      GIOCHI.forEach(g => { if (C.nome) lss(g.nomeK, C.nome); });
      pubProfilo(); emit('profilo', profiloDi(C.id)); aggiornaDom(C.id);
      G && G.impostaNome && C.nome && G.impostaNome(C.nome);
    }
    const nomi = uniq([...C.nomi, ...(Array.isArray(x.nomi) ? x.nomi.map(pulisciNome) : [])]);
    if (nomi.length !== C.nomi.length) { C.nomi = nomi; cambio = true; }
    if (cambio) salvaConto();
    const am = x.amici || {};
    if ((+am.t || 0) > A.t) {
      A = { t: +am.t, lista: (am.lista || []).filter(a => a && /^u-[A-Z0-9]{8}$/.test(a.id)).map(a => ({ id: a.id, nome: pulisciNome(a.nome), da: +a.da || 0 })), uscite: (am.uscite || []).filter(u => u && /^u-[A-Z0-9]{8}$/.test(u.id)) };
      jset(K.amici, A); A.lista.forEach(a => { sub('presenza/' + a.id); chiediProfilo(a.id); });
      emit('amici');
    }
  }
  async function ggScaricaStats() {
    const { fs } = GG.m;
    const qs = await fs.getDocs(fs.collection(GG.db, 'utenti', GG.user.uid, 'stats'));
    qs.forEach(d => { let x = null; try { x = JSON.parse(d.data().dati); } catch (e) { } if (x && Array.isArray(x.recs)) uniscStats(d.id, { recs: x.recs, tomb: x.tomb || [] }); });
  }
  /* manda solo quello che è cambiato dall'ultima volta */
  async function ggInvia() {
    if (!GG.user || !GG.m || GG.blocco) return;
    const { fs } = GG.m; const uid = GG.user.uid; const lavori = [];
    const dati = JSON.stringify(ggDati()); const h0 = hashStr(dati);
    if (GG.hash.main !== h0) lavori.push(fs.setDoc(fs.doc(GG.db, 'utenti', uid), { v: 1, id: C.id, t: Date.now(), dati }).then(() => { GG.hash.main = h0; }));
    GIOCHI.forEach(g => {
      let rs = jget(g.stats); if (!Array.isArray(rs)) rs = [];
      const tomb = (SY[g.stats] && SY[g.stats].tomb) || [];
      if (!rs.length && !tomb.length && !GG.hash[g.stats]) return;
      let s = JSON.stringify({ recs: rs, tomb });
      while (s.length > 900000 && rs.length > 10) { rs = rs.slice(Math.ceil(rs.length / 4)); s = JSON.stringify({ recs: rs, tomb }); }
      const h = hashStr(s);
      if (GG.hash[g.stats] !== h) lavori.push(fs.setDoc(fs.doc(GG.db, 'utenti', uid, 'stats', g.stats), { t: Date.now(), dati: s }).then(() => { GG.hash[g.stats] = h; }));
    });
    if (!lavori.length) return;
    await Promise.all(lavori);
    GG.ultimo = Date.now();
    const i = ggInfo(); if (i && i.uid === uid) jset(K.google, Object.assign(i, { ultimo: GG.ultimo, hash: GG.hash }));
  }
  /* all'accesso (e a ogni apertura di pagina): unisce cloud e dispositivo */
  async function ggAllinea(primaVolta) {
    if (!GG.user || GG.occupato) return;
    GG.occupato = true;
    const { fs } = GG.m; const uid = GG.user.uid;
    try {
      const snap = await fs.getDoc(fs.doc(GG.db, 'utenti', uid));
      if (!snap.exists()) {
        GG.hash = {};
        await ggInvia();
        if (primaVolta) avviso('☁️ Fatto! Il tuo account ora è salvato con Google: su un altro dispositivo ti basta accedere.');
      } else {
        let x = null; try { x = JSON.parse(snap.data().dati); } catch (e) { }
        if (x && /^u-[A-Z0-9]{8}$/.test(x.id) && x.seg && x.id !== C.id) { GG.occupato = false; GG.blocco = true; ggCambio(); return ggAdotta(x); }
        if (x) ggUnisci(x);
        await ggScaricaStats();
        await ggInvia();
        if (primaVolta) avviso('☁️ Bentornato! Account recuperato da Google.');
      }
      GG.ultimo = GG.ultimo || Date.now(); GG.msg = '';
      const i = ggInfo(); if (i && i.uid === uid) jset(K.google, Object.assign(i, { ultimo: GG.ultimo, hash: GG.hash }));
    } catch (e) { console.warn('tavolata google', e); GG.msg = ggErrore(e); }
    GG.occupato = false; ggCambio(); render();
  }
  /* su Google c'è un account diverso da quello del dispositivo: si usa quello di Google */
  function ggAdotta(x) {
    const p = pulisciProfilo(x.profilo) || {};
    const fai = async () => {
      try { pub('presenza/' + C.id, { on: false, t: Date.now() }); } catch (e) { }
      const vecchiNomi = C.nomi, vecchioId = C.id, vecchiAmici = A.lista.slice(), vecchieUscite = A.uscite.slice();
      C = { id: x.id, seg: x.seg, nome: p.nome || C.nome, foto: p.foto || '', emoji: p.emoji || '', colore: p.colore || C.colore, t: p.t || 1, nomi: uniq([...(x.nomi || []).map(pulisciNome), ...vecchiNomi]), creato: +x.creato || Date.now() };
      salvaConto();
      GIOCHI.forEach(g => { if (C.nome) lss(g.nomeK, C.nome); });
      const am = x.amici || {};
      const lista = (am.lista || []).filter(a => a && /^u-[A-Z0-9]{8}$/.test(a.id) && a.id !== vecchioId);
      vecchiAmici.forEach(a => { if (a && a.id !== C.id && !lista.some(b => b.id === a.id)) lista.push(a); });
      const uscite = (am.uscite || []).filter(u => u && /^u-[A-Z0-9]{8}$/.test(u.id));
      vecchieUscite.forEach(u => { if (u && u.id !== C.id && !uscite.some(b => b.id === u.id) && !lista.some(b => b.id === u.id)) uscite.push(u); });
      A = { t: Date.now(), lista, uscite };
      jset(K.amici, A);
      avvisaCambioId(vecchioId, vecchiAmici);
      SY = {}; salvaSY();
      GG.occupato = true; GG.blocco = false;
      try { await ggScaricaStats(); GG.hash = {}; await ggInvia(); } catch (e) { }
      GG.occupato = false;
      avviso('☁️ Account recuperato da Google: ricarico la pagina…');
      setTimeout(() => location.reload(), 1800);
    };
    const qui = C.nome || 'senza nome', su = p.nome || 'senza nome';
    if (!A.lista.length && C.t <= 1) return fai();
    conferma('Usare l\'account salvato su Google?',
      `Su Google c'è già il tuo account "${su}". Su questo dispositivo ce n'è un altro ("${qui}"${A.lista.length ? ', con ' + A.lista.length + (A.lista.length === 1 ? ' amico' : ' amici') : ''}). Userai quello di Google: le statistiche e gli amici di questo dispositivo vengono aggiunti, e i tuoi amici vengono avvisati del cambio.`,
      'Usa l\'account Google', fai, async () => { try { await GG.m.au.signOut(GG.auth); } catch (e) { } jset(K.google, null); GG.user = null; GG.blocco = false; GG.stato = 'fuori'; ggCambio(); });
  }
  function ggPresto() { if (!GG.user) return; clearTimeout(GG.presto); GG.presto = setTimeout(() => { ggInvia().catch(e => { GG.msg = ggErrore(e); ggCambio(); }); }, 2500); }
  setInterval(() => { if (GG.user && !GG.occupato) ggInvia().catch(() => { }); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.hidden && GG.user && !GG.occupato) ggInvia().catch(() => { }); });
  function ggHTML(compatto) {
    if (!FIREBASE) return '';
    const s = ggStato();
    const gIco = '<svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" style="flex:none"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>';
    const err = s.msg ? `<div class="tv-small" style="color:#ff8787;margin-top:6px">${esc(s.msg)}</div>` : '';
    if (s.stato === 'carico') return `<div class="tv-small tv-mut">☁️ Mi collego a Google…</div>${err}`;
    if (s.stato === 'dentro') {
      if (compatto) return `<div class="tv-small tv-on">☁️ Salvato con Google${s.email ? ' · ' + esc(s.email) : ''}</div>${err}`;
      return `<div class="tv-row" style="gap:8px">${gIco}<b>${esc(s.email || s.nome || 'Account Google')}</b></div>
        <div class="tv-small tv-mut" style="margin-top:4px">${GG.occupato ? 'Sto sincronizzando…' : s.ultimo ? 'Ultimo salvataggio ' + esc(quando(s.ultimo)) : 'Salvataggio in corso…'}</div>${err}
        <div class="tv-row" style="margin-top:10px"><button class="tv-btn tv-sm" data-tv="g-salva">Salva adesso</button><button class="tv-btn tv-sm tv-gh" data-tv="g-esci">Esci da Google</button><button class="tv-btn tv-sm tv-gh" data-tv="g-elimina">Cancella i dati da Google</button></div>`;
    }
    return `<button class="tv-btn ${compatto ? 'tv-sm' : 'tv-pri'}" data-tv="g-accedi" style="gap:8px;${compatto ? '' : 'background:#fff;color:#1f1f1f'}">${gIco}Accedi con Google</button>${err}`;
  }

  /* =========================================================
     COLLEGAMENTO CON IL GIOCO APERTO
     ========================================================= */
  let G = null;
  const R = { code: null, uns: [], bussate: [], mia: null, bloccato: null, visInit: null, allowKey: '', pubblicata: null, pubKey: '', pubT: 0, bussato: {}, rawPosti: [] };
  function statoGioco() { if (!G) return null; try { return G.stato(); } catch (e) { return null; } }
  function collegaGioco(g) {
    G = g;
    setInterval(tick, 1000);
    tick();
    osserva();
  }
  const ammesso = (S, id) => !S || !S.vis || S.vis === 'pubblica' || S.host === id || (S.allow || []).includes(id);
  function puoEntrare(d) {
    if (!d || ammesso(d, C.id)) return true;
    R.bloccato = { code: d.code, vis: d.vis };
    if (d.vis === 'richiesta') bussa(d.code);
    setTimeout(render, 0);
    return false;
  }
  function bussa(code) {
    const st = statoGioco(); if (!st || !st.DB || R.bussato[code]) return;
    R.bussato[code] = true;
    st.DB.doc(`games/${code}/bussa/${C.id}`).set({ id: C.id, nome: C.nome || 'Giocatore', t: Date.now() }).catch(() => { R.bussato[code] = false; });
  }
  function posti(raw) {
    R.rawPosti = raw;
    const st = statoGioco(); const S = st && st.S;
    if (!S || !S.vis || S.vis === 'pubblica' || S.status !== 'lobby') return raw;
    return raw.filter(s => s && ammesso(S, s.id));
  }
  function apriStanza(code, st) {
    chiudiStanza();
    R.code = code; R.bussate = []; R.mia = null; R.allowKey = '';
    if (!st.DB) return;
    try {
      R.uns.push(st.DB.collection(`games/${code}/bussa`).onSnapshot(s => {
        R.bussate = s.docs.map(d => d.data()).filter(x => x && /^u-[A-Z0-9]{8}$/.test(x.id));
        R.bussate.forEach(b => chiediProfilo(b.id));
        const nuove = R.bussate.filter(b => !b.no && !b.visto);
        render();
        if (nuove.length) suona();
      }, () => { }));
      R.uns.push(st.DB.doc(`games/${code}/bussa/${C.id}`).onSnapshot(s => { R.mia = s.exists ? s.data() : null; render(); }, () => { }));
    } catch (e) { }
  }
  function chiudiStanza() {
    R.uns.forEach(u => { try { u(); } catch (e) { } }); R.uns = [];
    togliPubblica();
    R.code = null; R.bussate = []; R.mia = null;
  }
  function togliPubblica() { if (R.pubblicata) { pub('stanze/' + G.id + '/' + R.pubblicata, null); delete STANZE[G.id + '/' + R.pubblicata]; R.pubblicata = null; R.pubKey = ''; } }
  function visPreferita() { const v = lsg(K.vis); return ['privata', 'richiesta', 'pubblica'].includes(v) ? v : 'richiesta'; }
  function cambiaVis(v) {
    const st = statoGioco(); if (!st || !st.S || st.S.host !== C.id || !['privata', 'richiesta', 'pubblica'].includes(v)) return;
    lss(K.vis, v);
    const dentro = (R.rawPosti || []).filter(s => ammesso(st.S, s.id)).map(s => s.id);
    G.act(N => { N.vis = v; N.allow = uniq([N.host, ...(N.allow || []), ...dentro]); });
  }
  function accettaBussata(id) {
    const st = statoGioco(); if (!st || !st.S || st.S.host !== C.id) return;
    G.act(N => { N.allow = uniq([...(N.allow || []), id]); });
    try { st.DB.doc(`games/${st.code}/bussa/${id}`).delete(); } catch (e) { }
    R.bussate = R.bussate.filter(b => b.id !== id); render();
  }
  function rifiutaBussata(id) {
    const st = statoGioco(); if (!st || !st.S || st.S.host !== C.id) return;
    const b = R.bussate.find(x => x.id === id);
    try { st.DB.doc(`games/${st.code}/bussa/${id}`).set(Object.assign({}, b || { id }, { no: true, t: Date.now() })); } catch (e) { }
    render();
  }
  function maxGiocatori(st) { try { const m = G.max && G.max(); if (m) return m; } catch (e) { } return (st.S && st.S.settings && +st.S.settings.max) || 0; }

  function tick() {
    const st = statoGioco(); if (!st) return;
    const S = st.S;
    const inStanza = st.view === 'game' && st.code && S;
    if ((inStanza ? st.code : null) !== R.code) { if (inStanza) apriStanza(st.code, st); else chiudiStanza(); }
    if (R.bloccato && (!inStanza || st.code !== R.bloccato.code)) R.bloccato = null;
    if (inStanza && S.status === 'lobby') {
      /* chi crea la stanza: scelta iniziale di chi può entrare */
      if (S.host === C.id && !S.vis && R.visInit !== st.code && Date.now() - (S.created || 0) < 120000) {
        R.visInit = st.code;
        const v = visPreferita();
        G.act(N => { if (!N.vis) { N.vis = v; N.allow = uniq([N.host, ...(N.allow || []), ...(R.rawPosti || []).map(s => s.id)]); } });
      }
      /* elenco dei posti ricalcolato quando cambiano gli ammessi */
      const ak = (S.vis || '') + '|' + (S.allow || []).join(',');
      if (ak !== R.allowKey) { const prima = R.allowKey; R.allowKey = ak; if (prima) { try { G.impostaPosti(posti(R.rawPosti || [])); G.ridisegna(); } catch (e) { } render(); } }
      /* chi era in attesa ed è stato accettato entra da solo */
      if (R.bloccato && ammesso(S, C.id)) { R.bloccato = null; avviso('✅ Sei dentro!'); try { G.riapri(); } catch (e) { } }
      /* stanza nell'elenco delle partite pubbliche */
      if (S.host === C.id && (S.vis === 'pubblica' || S.vis === 'richiesta')) {
        const n = posti(R.rawPosti || []).length + ((S.extras || []).length);
        const e = { code: st.code, host: C.id, hostNome: C.nome, vis: S.vis, n, max: maxGiocatori(st), t: Date.now() };
        const key = JSON.stringify([e.vis, e.n, e.max, e.hostNome]);
        if (key !== R.pubKey || Date.now() - R.pubT > 15000) { R.pubKey = key; R.pubT = Date.now(); R.pubblicata = st.code; pub('stanze/' + G.id + '/' + st.code, e); STANZE[G.id + '/' + st.code] = Object.assign({ gioco: G.id }, e); }
      } else togliPubblica();
    } else if (R.pubblicata) togliPubblica();
    if (inStanza) {
      if (S.status === 'ended') togliCorso(G.id, st.code);
      else if ((S.status === 'lobby' || S.status === 'playing') && corsoServe(G.id, st.code, S.status)) {
        if (S.host === C.id || (R.rawPosti || []).some(x => x && x.id === C.id) || (S.status !== 'lobby' && JSON.stringify(S).includes(C.id))) segnaCorso(G.id, st.code, S.status);
      }
      R.eraInGioco = { g: G.id, code: st.code };
    } else if (R.eraInGioco) {
      /* appena tornato alla home: ricontrolla subito quella partita (magari ne sei uscito) */
      const k = R.eraInGioco.g + '/' + R.eraInGioco.code; if (VER[k]) { VER[k].ok = null; VER[k].t = 0; }
      R.eraInGioco = null; render();
    }
    pubPresenza(false);
    if (Date.now() - (tick.s || 0) > 15000) { tick.s = Date.now(); controllaStats(false); pubRiepilogo(false); }
  }

  /* =========================================================
     INTERFACCIA
     ========================================================= */
  const CSS = `
  .tv-btn{font:inherit;font-weight:700;font-size:14px;cursor:pointer;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.07);color:#f4f1ff;padding:8px 13px;border-radius:12px;display:inline-flex;align-items:center;gap:6px;line-height:1.2;text-decoration:none;transition:background .15s,transform .1s}
  .tv-btn:hover{background:rgba(255,255,255,.13)}.tv-btn:active{transform:translateY(1px)}.tv-btn:disabled{opacity:.45;cursor:default}
  .tv-btn.tv-pri{background:#ffcf4a;color:#1d1a2f;border-color:#ffcf4a}.tv-btn.tv-pri:hover{background:#ffd966}
  .tv-btn.tv-ok{background:#3ddc84;color:#0d3320;border-color:#3ddc84}.tv-btn.tv-sm{font-size:13px;padding:6px 10px;border-radius:10px}
  .tv-btn.tv-gh{background:transparent}.tv-badge{min-width:19px;height:19px;padding:0 5px;border-radius:99px;background:#ff6b6b;color:#fff;font-size:12px;font-weight:800;display:inline-grid;place-items:center}
  .tv-av{flex:none;border-radius:50%;display:inline-grid;place-items:center;overflow:hidden;color:#1d1a2f;font-weight:800;position:relative;font-family:inherit}
  .tv-av img{width:100%;height:100%;object-fit:cover;display:block}
  .tv-dot{position:absolute;right:-1px;bottom:-1px;width:30%;height:30%;min-width:9px;min-height:9px;border-radius:50%;background:#3ddc84;border:2px solid #1d1a2f}
  [data-tv-id] > img.tv-foto{width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block}
  [data-tv-id] > .tv-emo{font-size:1.05em;line-height:1}
  .tv-barra{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:8px 10px;margin:0 0 14px;color:#f4f1ff;text-align:left}
  .tv-barra .tv-chi{display:flex;align-items:center;gap:9px;flex:1;min-width:150px;cursor:pointer;background:none;border:0;color:inherit;font:inherit;text-align:left;padding:0}
  .tv-barra .tv-chi b{font-size:15px}.tv-barra .tv-chi small{display:block;color:#a9a3c9;font-size:12px;font-weight:600}
  .tv-panel{background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:16px;margin:0 0 14px;color:#f4f1ff;text-align:left}
  .tv-panel h3,.tv-dr h3{margin:0 0 10px;font-size:17px;font-weight:800;display:flex;align-items:center;gap:8px}
  .tv-mut{color:#a9a3c9}.tv-small{font-size:13px}.tv-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.tv-between{justify-content:space-between}
  .tv-seg{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .tv-seg button{font:inherit;cursor:pointer;text-align:left;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#f4f1ff;border-radius:14px;padding:10px 11px;display:flex;flex-direction:column;gap:2px}
  .tv-seg button b{font-size:14px}.tv-seg button small{color:#a9a3c9;font-size:12px;line-height:1.3}
  .tv-seg button.on{border-color:#ffcf4a;background:rgba(255,207,74,.13);box-shadow:0 0 0 1px #ffcf4a inset}
  .tv-seg button:disabled{cursor:default}.tv-seg button:disabled:not(.on){opacity:.45}
  @media (max-width:560px){.tv-seg{grid-template-columns:1fr}.tv-seg button{flex-direction:row;align-items:baseline;gap:8px}}
  .tv-list{display:flex;flex-direction:column;gap:6px;margin-top:8px}
  .tv-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.04);min-width:0}.tv-item>.tv-btn{flex:none}
  .tv-list,.tv-panel{min-width:0;max-width:100%}
  .tv-item .tv-tx{flex:1;min-width:0}.tv-item .tv-tx b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tv-item .tv-tx small{color:#a9a3c9;font-size:12px}
  .tv-on{color:#3ddc84!important}.tv-sep{height:1px;background:rgba(255,255,255,.09);margin:14px 0}
  .tv-note{border-radius:12px;padding:10px 12px;background:rgba(255,207,74,.12);border:1px solid rgba(255,207,74,.35);margin-top:10px;font-size:14px}
  .tv-note.tv-ko{background:rgba(255,107,107,.12);border-color:rgba(255,107,107,.4)}
  .tv-in{font:inherit;font-size:15px;color:#f4f1ff;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:9px 12px;min-width:0}
  #tv-avvisi{position:fixed;right:14px;bottom:14px;z-index:9400;display:flex;flex-direction:column;gap:10px;width:min(360px,calc(100vw - 28px));pointer-events:none}
  .tv-card{pointer-events:auto;background:#2b2647;border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:12px;box-shadow:0 14px 34px -10px rgba(0,0,0,.6);color:#f4f1ff;font-family:Nunito,system-ui,sans-serif;animation:tvIn .35s cubic-bezier(.2,.8,.3,1.2)}
  .tv-card .tv-row{flex-wrap:nowrap}.tv-card p{margin:0;font-size:14px;line-height:1.35}.tv-card .tv-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
  .tv-card.tv-toast{padding:10px 14px;font-weight:700;font-size:14px}
  @keyframes tvIn{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}
  #tv-velo{position:fixed;inset:0;z-index:9500;background:rgba(10,8,20,.55);backdrop-filter:blur(2px);opacity:0;pointer-events:none;transition:opacity .2s}
  #tv-velo.on{opacity:1;pointer-events:auto}
  .tv-dr{position:fixed;top:0;right:0;bottom:0;z-index:9501;width:min(420px,100vw);background:#211d36;border-left:1px solid rgba(255,255,255,.1);color:#f4f1ff;font-family:Nunito,system-ui,sans-serif;transform:translateX(105%);transition:transform .25s cubic-bezier(.2,.8,.3,1);overflow-y:auto;padding:18px 18px 40px;box-sizing:border-box}
  .tv-dr.on{transform:none}.tv-dr *{box-sizing:border-box}
  .tv-dr .tv-x{position:absolute;top:12px;right:12px}
  .tv-codice{font-family:ui-monospace,Menlo,monospace;font-size:20px;font-weight:800;letter-spacing:2px;color:#ffcf4a}
  .tv-modal{position:fixed;inset:0;z-index:9600;display:grid;place-items:center;background:rgba(10,8,20,.6);padding:16px}
  .tv-modal .tv-panel{background:#2b2647;max-width:420px;width:100%;margin:0}
  .tv-stanze-vuote{padding:10px 2px}
  @media (prefers-reduced-motion:reduce){.tv-card,.tv-dr{animation:none!important;transition:none!important}}
  
.tv-dona-riga{margin-top:8px}
.tv-dona{display:inline-block;padding:7px 14px;border-radius:999px;background:#ffcf4a;color:#1d1a2f !important;font:800 12.5px/1.2 system-ui,-apple-system,'Segoe UI',sans-serif;text-decoration:none;border:0;cursor:pointer;opacity:1}
.tv-dona-sm{display:inline-flex;align-items:center;padding:6px 12px;font-size:13px;box-shadow:0 3px 0 #c99a17;white-space:nowrap}
.tv-dona:hover{filter:brightness(1.06)}
.tv-dona-off{box-shadow:none;background:transparent;color:inherit !important;border:1px dashed currentColor;opacity:.75;font-weight:700}
`;
  function stile() { if (document.getElementById('tv-css')) return; const s = document.createElement('style'); s.id = 'tv-css'; s.textContent = CSS; document.head.appendChild(s); }

  function iniziale(n) { return esc((String(n || '?').trim().charAt(0) || '?').toUpperCase()); }
  function avatarHTML(id, size, punto) {
    const p = profiloDi(id) || { nome: '?', colore: '#9e9cd9' };
    size = size || 36;
    const inner = p.foto ? `<img src="${p.foto}" alt="">` : p.emoji ? `<span style="font-size:${Math.round(size * .55)}px">${esc(p.emoji)}</span>` : `<span style="font-size:${Math.round(size * .45)}px">${iniziale(p.nome)}</span>`;
    return `<span class="tv-av" data-tv-av="${esc(id)}" style="width:${size}px;height:${size}px;background:${okCol(p.colore) ? p.colore : '#9e9cd9'}">${inner}${punto && online(id) ? '<i class="tv-dot"></i>' : ''}</span>`;
  }
  /* foto/emoji del profilo dentro l'avatar disegnato dal gioco */
  function conFoto(html, p) {
    if (!p || p.bot || typeof html !== 'string' || !/^u-[A-Z0-9]{8}$/.test(p.id || '')) return html;
    const pr = profiloDi(p.id);
    let out = html.replace(/^(\s*<[a-zA-Z]+)/, `$1 data-tv-id="${p.id}"`);
    const inner = innerFoto(pr);
    if (inner) out = out.replace(/^(\s*<[^>]+>)[\s\S]*(<\/[a-zA-Z]+>\s*)$/, `$1${inner}$2`);
    return out;
  }
  const innerFoto = pr => pr && pr.foto ? `<img class="tv-foto" src="${pr.foto}" alt="">` : pr && pr.emoji ? `<span class="tv-emo">${esc(pr.emoji)}</span>` : '';
  function aggiornaDom(id) {
    const pr = profiloDi(id); const inner = innerFoto(pr);
    if (inner) document.querySelectorAll(`[data-tv-id="${id}"]`).forEach(el => { if (el.innerHTML !== inner) el.innerHTML = inner; });
    document.querySelectorAll(`[data-tv-av="${id}"]`).forEach(el => { const w = parseInt(el.style.width) || 36; const tmp = document.createElement('div'); tmp.innerHTML = avatarHTML(id, w, !!el.querySelector('.tv-dot')); el.replaceWith(tmp.firstChild); });
  }

  function suona() { try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(880, a.currentTime); o.frequency.setValueAtTime(1320, a.currentTime + .09); g.gain.setValueAtTime(.0001, a.currentTime); g.gain.exponentialRampToValueAtTime(.12, a.currentTime + .02); g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + .3); o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + .32); setTimeout(() => a.close(), 600); } catch (e) { } }
  function vibra() { try { navigator.vibrate && navigator.vibrate([60, 40, 60]); } catch (e) { } }

  /* ---- avvisi in basso a destra ---- */
  const toasts = [];
  function avviso(msg) { toasts.push({ id: rid(6), msg }); renderAvvisi(); const t = toasts[toasts.length - 1]; setTimeout(() => { const i = toasts.indexOf(t); if (i >= 0) toasts.splice(i, 1); renderAvvisi(); }, 3500); }
  function renderAvvisi() {
    let box = document.getElementById('tv-avvisi');
    if (!box) { if (!document.body) return; box = document.createElement('div'); box.id = 'tv-avvisi'; document.body.appendChild(box); }
    const carte = [];
    Object.values(POSTA).forEach(m => {
      const pr = profiloDi(m.da); const nome = esc((pr && pr.nome) || m.nome);
      if (m.tipo === 'invito') {
        if (Date.now() - m.t > INVITO_MS) return;
        const gi = GIOCO(m.gioco);
        carte.push(`<div class="tv-card" data-k="i-${m.da}-${m.code}"><div class="tv-row">${avatarHTML(m.da, 40)}<p><b>${nome}</b> ti invita a giocare a <b>${esc(gi.ico + ' ' + gi.nome)}</b></p></div><div class="tv-acts"><button class="tv-btn tv-sm tv-gh" data-tv="no-inv" data-id="${m.da}">No grazie</button><button class="tv-btn tv-sm tv-pri" data-tv="si-inv" data-id="${m.da}">Entra ▶</button></div></div>`);
      } else if (m.tipo === 'amicizia') {
        carte.push(`<div class="tv-card" data-k="a-${m.da}"><div class="tv-row">${avatarHTML(m.da, 40)}<p><b>${nome}</b> vuole essere tuo amico su Tavolata</p></div><div class="tv-acts"><button class="tv-btn tv-sm tv-gh" data-tv="no-am" data-id="${m.da}">Rifiuta</button><button class="tv-btn tv-sm tv-ok" data-tv="si-am" data-id="${m.da}">Accetta</button></div></div>`);
      }
    });
    const st = statoGioco();
    if (st && st.S && st.S.status === 'lobby' && st.S.host === C.id && !pannelloVisibile()) {
      R.bussate.filter(b => !b.no && !(st.S.allow || []).includes(b.id)).forEach(b => {
        carte.push(`<div class="tv-card" data-k="b-${b.id}"><div class="tv-row">${avatarHTML(b.id, 40)}<p><b>${esc((profiloDi(b.id) || {}).nome || b.nome)}</b> chiede di entrare nella tua stanza</p></div><div class="tv-acts"><button class="tv-btn tv-sm tv-gh" data-tv="no-bus" data-id="${b.id}">Rifiuta</button><button class="tv-btn tv-sm tv-ok" data-tv="si-bus" data-id="${b.id}">Accetta</button></div></div>`);
      });
    }
    toasts.forEach(t => carte.push(`<div class="tv-card tv-toast" data-k="t-${t.id}">${esc(t.msg)}</div>`));
    // aggiorna senza rifare le carte già presenti (niente animazione ripetuta)
    const voluti = new Map(carte.map(h => { const m = h.match(/data-k="([^"]+)"/); return [m[1], h]; }));
    [...box.children].forEach(el => { if (!voluti.has(el.dataset.k)) el.remove(); });
    voluti.forEach((h, k) => {
      const ex = box.querySelector(`[data-k="${CSS_ESC(k)}"]`);
      if (ex) { if (ex.dataset.h !== hashStr(h)) { const t = document.createElement('div'); t.innerHTML = h; t.firstChild.style.animation = 'none'; t.firstChild.dataset.h = hashStr(h); ex.replaceWith(t.firstChild); } }
      else { const t = document.createElement('div'); t.innerHTML = h; t.firstChild.dataset.h = hashStr(h); box.appendChild(t.firstChild); }
    });
  }
  const CSS_ESC = s => (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');

  /* ---- clic su tutti i pulsanti del modulo ---- */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-tv]'); if (!b) return;
    const a = b.dataset.tv, id = b.dataset.id;
    e.preventDefault();
    if (a === 'si-inv') accettaInvito(id);
    else if (a === 'no-inv') rifiutaInvito(id);
    else if (a === 'si-am') { accettaAmicizia(id); avviso('🎉 Ora siete amici!'); }
    else if (a === 'no-am') rifiutaAmicizia(id);
    else if (a === 'si-bus') accettaBussata(id);
    else if (a === 'no-bus') rifiutaBussata(id);
    else if (a === 'vis') cambiaVis(b.dataset.v);
    else if (a === 'invita') invita(id);
    else if (a === 'aggiungi') { const r = chiediAmicizia(id); avviso(r.ok ? '📨 Richiesta di amicizia mandata' : r.msg); render(); }
    else if (a === 'annulla') annullaRichiesta(id);
    else if (a === 'rimuovi') conferma('Togliere questo amico?', 'Non vi vedrete più tra gli amici (potrete sempre tornare amici).', 'Togli', () => rimuoviAmico(id));
    else if (a === 'unisciti') vai(b.dataset.g, b.dataset.c);
    else if (a === 'entra-pub') vai(b.dataset.g, b.dataset.c);
    else if (a === 'conto') apriPannello();
    else if (a === 'chiudi') chiudiPannello();
    else if (a === 'copia') copia(b.dataset.txt, b.dataset.ok || 'Copiato');
    else if (a === 'dona-presto') avviso('☕ Le donazioni arriveranno presto. Grazie del pensiero!');
    else if (a === 'g-accedi') ggAccedi();
    else if (a === 'g-esci') conferma('Uscire da Google?', 'Su questo dispositivo continui a giocare con lo stesso account, ma le modifiche non verranno più salvate su Google finché non accedi di nuovo.', 'Esci', ggEsci);
    else if (a === 'g-elimina') conferma('Cancellare i dati da Google?', 'Cancello la copia del tuo account salvata con Google (nome, amici, statistiche) ed esco. Su questo dispositivo l\'account resta com\'è.', 'Cancella', ggElimina);
    else if (a === 'g-salva') { ggInvia().then(() => { GG.ultimo = Date.now(); avviso('☁️ Salvato'); ggCambio(); }).catch(e => { GG.msg = ggErrore(e); ggCambio(); }); }
    else if (a === 'agg-codice') {
      const inp = document.getElementById('tv-codice-in'); const r = chiediAmicizia(inp ? inp.value : '');
      const out = document.getElementById('tv-codice-esito'); if (out) { out.textContent = r.msg; out.className = 'tv-small ' + (r.ok ? 'tv-on' : 'tv-mut'); }
      if (r.ok && inp) inp.value = '';
      avviso((r.ok ? '📨 ' : '') + r.msg);
    }
  });
  function copia(txt, ok) {
    const fatto = () => avviso('📋 ' + ok);
    try { navigator.clipboard.writeText(txt).then(fatto, () => { prompt('Copia questo testo:', txt); }); } catch (e) { prompt('Copia questo testo:', txt); }
  }
  function conferma(tit, testo, si, fn, no) {
    const m = document.createElement('div'); m.className = 'tv-modal';
    m.innerHTML = `<div class="tv-panel"><h3>${esc(tit)}</h3><p class="tv-mut" style="margin:0 0 14px">${esc(testo)}</p><div class="tv-row" style="justify-content:flex-end"><button class="tv-btn tv-gh" data-x>Annulla</button><button class="tv-btn tv-pri" data-y>${esc(si)}</button></div></div>`;
    document.body.appendChild(m);
    m.querySelector('[data-x]').onclick = () => { m.remove(); no && no(); };
    m.querySelector('[data-y]').onclick = () => { m.remove(); fn(); };
    m.onclick = e => { if (e.target === m) { m.remove(); no && no(); } };
  }

  /* ---- descrizione di dove si trova un amico ---- */
  function statoAmico(id) {
    const p = PRES[id];
    if (!online(id)) return { txt: 'Offline', on: false };
    const gi = GIOCO(p.dove);
    if (p.stanza && GIOCO(p.stanza.gioco)) return { txt: 'In una stanza di ' + GIOCO(p.stanza.gioco).nome, on: true, stanza: p.stanza };
    if (gi) return { txt: (p.gioca ? 'Sta giocando a ' : 'Su ') + gi.nome, on: true };
    if (p.dove === 'profilo') return { txt: 'Online · sul profilo', on: true };
    return { txt: 'Online · nella sala giochi', on: true };
  }
  const amiciOrdinati = () => [...A.lista].sort((a, b) => (online(b.id) - online(a.id)) || String((profiloDi(a.id) || a).nome).localeCompare(String((profiloDi(b.id) || b).nome)));
  const quantiOnline = () => A.lista.filter(a => online(a.id)).length;
  const richiesteInArrivo = () => Object.values(POSTA).filter(m => m.tipo === 'amicizia');
  const nonLette = () => Object.values(POSTA).filter(m => m.tipo === 'amicizia' || (m.tipo === 'invito' && Date.now() - m.t < INVITO_MS)).length;

  /* ---- pannello laterale "Amici e profilo" ---- */
  let pannelloAperto = false;
  function apriPannello() { pannelloAperto = true; ensureDrawer(); renderPannello(); requestAnimationFrame(() => { document.getElementById('tv-velo').classList.add('on'); document.getElementById('tv-dr').classList.add('on'); }); }
  function chiudiPannello() { pannelloAperto = false; const v = document.getElementById('tv-velo'), d = document.getElementById('tv-dr'); if (v) v.classList.remove('on'); if (d) d.classList.remove('on'); }
  function ensureDrawer() {
    if (document.getElementById('tv-dr')) return;
    const v = document.createElement('div'); v.id = 'tv-velo'; v.onclick = chiudiPannello; document.body.appendChild(v);
    const d = document.createElement('aside'); d.id = 'tv-dr'; d.className = 'tv-dr'; d.setAttribute('aria-label', 'Amici e profilo'); document.body.appendChild(d);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && pannelloAperto) chiudiPannello(); });
  }
  function rigaAmico(a, conInvita) {
    const s = statoAmico(a.id); const pr = profiloDi(a.id) || a;
    const st = statoGioco(); const code = st && st.code;
    const giaInv = code && invitati[code + '/' + a.id] && Date.now() - invitati[code + '/' + a.id] < 60000;
    let bt = '';
    if (conInvita) bt = `<button class="tv-btn tv-sm ${s.on ? 'tv-pri' : ''}" data-tv="invita" data-id="${a.id}" ${giaInv ? 'disabled' : ''}>${giaInv ? 'Invitato ✓' : 'Invita'}</button>`;
    else if (s.stanza && !(st && st.code === s.stanza.code)) bt = `<button class="tv-btn tv-sm tv-pri" data-tv="unisciti" data-g="${esc(s.stanza.gioco)}" data-c="${esc(s.stanza.code)}">Unisciti</button>`;
    return `<div class="tv-item">${avatarHTML(a.id, 38, true)}<div class="tv-tx"><b>${esc(pr.nome || a.nome)}</b><small class="${s.on ? 'tv-on' : ''}">${esc(s.txt)}</small></div>${bt}</div>`;
  }
  function puoInvitare() {
    const st = statoGioco();
    return !!(st && st.view === 'game' && st.code && st.S && st.S.status === 'lobby' && (st.S.host === C.id || !st.S.vis || st.S.vis === 'pubblica'));
  }
  function renderPannello() {
    const d = document.getElementById('tv-dr'); if (!d || !pannelloAperto) return;
    if (FIREBASE && !GG.user) ggCarica();
    const inv = puoInvitare();
    const ric = richiesteInArrivo();
    const usc = A.uscite;
    const sc = d.scrollTop;
    const inp = document.getElementById('tv-codice-in'); const val = inp ? inp.value : ''; const foc = document.activeElement === inp;
    d.innerHTML = `<button class="tv-btn tv-sm tv-gh tv-x" data-tv="chiudi" aria-label="Chiudi">✕</button>
      <div class="tv-row" style="gap:12px;margin:4px 0 14px">${avatarHTML(C.id, 58)}<div><div style="font-size:20px;font-weight:800">${esc(C.nome || 'Senza nome')}</div><a class="tv-small" style="color:#ffcf4a" href="${BASE}profilo/${QS}">Profilo e statistiche →</a></div></div>
      ${FIREBASE ? `<div class="tv-panel" style="margin-bottom:12px">${GG.stato === 'dentro' ? ggHTML(true) : `<div class="tv-small tv-mut" style="margin-bottom:8px">Salva nome, amici e statistiche: li ritrovi su ogni dispositivo.</div>${ggHTML(true)}`}</div>` : ''}
      <div class="tv-panel" style="margin-bottom:12px"><div class="tv-small tv-mut">Il tuo codice amico</div><div class="tv-row tv-between"><span class="tv-codice">${codiceAmico(C.id)}</span><span class="tv-row"><button class="tv-btn tv-sm" data-tv="copia" data-txt="${codiceAmico(C.id)}" data-ok="Codice copiato">Copia</button><button class="tv-btn tv-sm" data-tv="copia" data-txt="${esc(BASE + 'profilo/#' + C.id.slice(2))}" data-ok="Link copiato: mandalo a chi vuoi aggiungere">Link</button></span></div>
      <div class="tv-small tv-mut" style="margin-top:6px">Dallo agli amici: con questo codice ti aggiungono e potete invitarvi a giocare senza mandarvi codici di partita.</div></div>
      ${inv ? `<div class="tv-note">Sei in una stanza: premi <b>Invita</b> accanto a un amico e gli arriva l'invito, ovunque sia nella sala giochi.</div>` : ''}
      ${ric.length ? `<h3 style="margin-top:16px">Richieste di amicizia <span class="tv-badge">${ric.length}</span></h3><div class="tv-list">${ric.map(m => `<div class="tv-item">${avatarHTML(m.da, 38)}<div class="tv-tx"><b>${esc((profiloDi(m.da) || m).nome)}</b><small>${quando(m.t)}</small></div><button class="tv-btn tv-sm tv-gh" data-tv="no-am" data-id="${m.da}">No</button><button class="tv-btn tv-sm tv-ok" data-tv="si-am" data-id="${m.da}">Accetta</button></div>`).join('')}</div>` : ''}
      <h3 style="margin-top:18px">Amici ${A.lista.length ? `<span class="tv-mut tv-small">${quantiOnline()} online su ${A.lista.length}</span>` : ''}</h3>
      ${A.lista.length ? `<div class="tv-list">${amiciOrdinati().map(a => rigaAmico(a, inv)).join('')}</div>` : `<div class="tv-mut tv-small">Non hai ancora amici qui. Scrivi sotto il codice amico di qualcuno, oppure mandagli il tuo.</div>`}
      <h3 style="margin-top:18px">Aggiungi un amico</h3>
      <div class="tv-row" style="flex-wrap:nowrap"><input id="tv-codice-in" class="tv-in" style="flex:1;text-transform:uppercase;letter-spacing:1px" maxlength="20" placeholder="Codice amico (ABCD-EF23)"><button class="tv-btn tv-pri" data-tv="agg-codice">Aggiungi</button></div>
      <div id="tv-codice-esito" class="tv-small tv-mut" style="margin-top:6px"></div>
      ${usc.length ? `<div class="tv-list">${usc.map(u => `<div class="tv-item">${avatarHTML(u.id, 32)}<div class="tv-tx"><b>${esc((profiloDi(u.id) || {}).nome || codiceAmico(u.id))}</b><small>Richiesta mandata · in attesa</small></div><button class="tv-btn tv-sm tv-gh" data-tv="annulla" data-id="${u.id}">Annulla</button></div>`).join('')}</div>` : ''}
      <div class="tv-sep"></div>
      <div class="tv-small tv-mut">${Net.ok ? '🟢 Collegato' : '🟠 Mi sto collegando…'}</div>`;
    d.scrollTop = sc;
    const ni = document.getElementById('tv-codice-in');
    if (ni) { ni.value = val; if (foc) ni.focus(); ni.onkeydown = e => { if (e.key === 'Enter') d.querySelector('[data-tv="agg-codice"]').click(); }; }
  }

  /* ---- barra in cima alla home di ogni gioco ---- */
  function barraHTML() {
    const n = nonLette(), on = quantiOnline();
    return `<button class="tv-chi" data-tv="conto">${avatarHTML(C.id, 40)}<span><b>${esc(C.nome || 'Scegli il tuo nome')}</b><small>${A.lista.length ? (on ? `🟢 ${on} ${on === 1 ? 'amico online' : 'amici online'}` : `${A.lista.length} ${A.lista.length === 1 ? 'amico' : 'amici'} · nessuno online`) : 'Aggiungi gli amici per invitarli a giocare'}</small></span></button>
      <button class="tv-btn tv-sm" data-tv="conto">👥 Amici ${n ? `<span class="tv-badge">${n}</span>` : ''}</button>
      <a class="tv-btn tv-sm" href="${BASE}profilo/${QS}">📊 Profilo</a>${donaBreveHTML()}`;
  }
  /* ---- partite pubbliche in avvio ---- */
  function stanzeAttive(gioco) {
    const now = Date.now();
    return Object.values(STANZE).filter(s => GIOCO(s.gioco) && (!gioco || s.gioco === gioco) && now - s.t < STANZA_MS)
      .sort((a, b) => ((b.host === C.id) - (a.host === C.id)) || (eAmico(b.host) - eAmico(a.host)) || (b.t - a.t));
  }
  function stanzeHTML(gioco, conGioco) {
    const L = stanzeAttive(gioco);
    if (!L.length) return `<div class="tv-mut tv-small tv-stanze-vuote">Nessuna partita pubblica in avvio adesso. Crea una partita e scegli <b>Pubblica</b> o <b>Su richiesta</b>: comparirà qui per tutti.</div>`;
    return `<div class="tv-list">${L.map(s => {
      const gi = GIOCO(s.gioco); const mia = s.host === C.id; const piena = s.max && s.n >= s.max;
      const nome = (profiloDi(s.host) || {}).nome || s.hostNome || 'Qualcuno';
      return `<div class="tv-item">${avatarHTML(s.host, 38)}<div class="tv-tx"><b>${conGioco ? esc(gi.ico + ' ' + gi.nome) + ' · ' : ''}Partita di ${esc(nome)}${eAmico(s.host) ? ' <span class="tv-on tv-small">· amico</span>' : ''}</b><small>${s.n}${s.max ? '/' + s.max : ''} giocatori · ${s.vis === 'richiesta' ? '✋ su richiesta' : '🌍 pubblica'} · codice ${esc(s.code)}</small></div>${mia ? '<span class="tv-small tv-mut">la tua</span>' : `<button class="tv-btn tv-sm ${piena ? '' : 'tv-pri'}" data-tv="entra-pub" data-g="${esc(s.gioco)}" data-c="${esc(s.code)}" ${piena ? 'disabled' : ''}>${piena ? 'Piena' : s.vis === 'richiesta' ? 'Chiedi' : 'Entra'}</button>`}</div>`;
    }).join('')}</div>`;
  }

  /* ---- pannello "Chi può entrare" nella stanza ---- */
  const VIS = {
    privata: ['🔒 Privata', 'Solo gli amici che inviti'],
    richiesta: ['✋ Su richiesta', 'Visibile a tutti, accetti tu chi entra'],
    pubblica: ['🌍 Pubblica', 'Visibile a tutti, entra chi vuole']
  };
  function pannelloVisibile() { const p = document.getElementById('tv-stanza'); if (!p) return false; const r = p.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }
  function stanzaHTML() {
    const st = statoGioco(); if (!st || !st.S) return '';
    const S = st.S, host = S.host === C.id, vis = S.vis || 'pubblica';
    let h = `<h3>Chi può entrare</h3><div class="tv-seg">${Object.entries(VIS).map(([k, [t, d]]) => `<button type="button" data-tv="vis" data-v="${k}" class="${vis === k ? 'on' : ''}" ${host ? '' : 'disabled'}><b>${t}</b><small>${d}</small></button>`).join('')}</div>`;
    if (!host) h += `<div class="tv-small tv-mut" style="margin-top:8px">Lo decide chi ha creato la partita.</div>`;
    if (!S.vis && host) h += `<div class="tv-small tv-mut" style="margin-top:8px">Preparo la stanza…</div>`;
    /* chi non è ancora dentro */
    if (R.bloccato && !ammesso(S, C.id)) {
      if (R.mia && R.mia.no) h += `<div class="tv-note tv-ko">La tua richiesta di entrare non è stata accettata.</div>`;
      else if (vis === 'richiesta') h += `<div class="tv-note">⏳ Hai chiesto di entrare: aspetta che <b>${esc(S.hostName || 'chi ha creato la partita')}</b> ti accetti. Entri da solo appena dice sì.</div>`;
      else h += `<div class="tv-note tv-ko">🔒 Questa stanza è privata: entri solo se chi l'ha creata ti invita dalla lista amici.</div>`;
    }
    /* richieste da accettare */
    if (host) {
      const att = R.bussate.filter(b => !b.no && !(S.allow || []).includes(b.id));
      if (att.length) h += `<div class="tv-sep"></div><h3>Chiedono di entrare <span class="tv-badge">${att.length}</span></h3><div class="tv-list">${att.map(b => `<div class="tv-item">${avatarHTML(b.id, 36)}<div class="tv-tx"><b>${esc((profiloDi(b.id) || {}).nome || b.nome)}</b><small>${eAmico(b.id) ? 'Tuo amico' : 'Non è tra i tuoi amici'}</small></div><button class="tv-btn tv-sm tv-gh" data-tv="no-bus" data-id="${b.id}">Rifiuta</button><button class="tv-btn tv-sm tv-ok" data-tv="si-bus" data-id="${b.id}">Accetta</button></div>`).join('')}</div>`;
    }
    /* invita gli amici */
    if (puoInvitare()) {
      const seduti = new Set((R.rawPosti || []).map(s => s.id));
      const L = amiciOrdinati().filter(a => !seduti.has(a.id));
      h += `<div class="tv-sep"></div><h3>Invita gli amici</h3>`;
      h += L.length ? `<div class="tv-list">${L.slice(0, 8).map(a => rigaAmico(a, true)).join('')}</div>${L.length > 8 ? `<div style="margin-top:8px"><button class="tv-btn tv-sm" data-tv="conto">Tutti gli amici (${L.length})</button></div>` : ''}`
        : `<div class="tv-small tv-mut">${A.lista.length ? 'Tutti i tuoi amici sono già qui!' : 'Non hai ancora amici: aggiungili con il loro codice amico e potrai invitarli con un clic.'} <button class="tv-btn tv-sm" data-tv="conto" style="margin-left:4px">👥 Amici</button></div>`;
    }
    /* chi è nella stanza ma non è ancora amico */
    const altri = (R.rawPosti || []).filter(s => s && /^u-[A-Z0-9]{8}$/.test(s.id) && s.id !== C.id && !eAmico(s.id) && ammesso(S, s.id));
    if (altri.length) h += `<div class="tv-sep"></div><div class="tv-small tv-mut" style="margin-bottom:4px">Nella stanza (non ancora amici)</div><div class="tv-list">${altri.map(s => { const inv = A.uscite.some(u => u.id === s.id); return `<div class="tv-item">${avatarHTML(s.id, 32)}<div class="tv-tx"><b>${esc((profiloDi(s.id) || {}).nome || s.name)}</b></div><button class="tv-btn tv-sm" data-tv="aggiungi" data-id="${s.id}" ${inv ? 'disabled' : ''}>${inv ? 'Richiesta mandata' : '➕ Aggiungi amico'}</button></div>`; }).join('')}</div>`;
    return h;
  }

  /* ---- inserisce barra/pannelli nelle pagine del gioco ---- */
  let osservatore = null;
  function osserva() {
    const app = document.getElementById('app') || document.body;
    if (osservatore) return;
    let q = false;
    osservatore = new MutationObserver(() => { if (q) return; q = true; Promise.resolve().then(() => { q = false; inserisci(); }); });
    osservatore.observe(app, { childList: true, subtree: true });
    inserisci();
  }
  function inserisci() {
    if (!G) return;
    const st = statoGioco();
    const jc = document.getElementById('jc');
    if (st && st.view === 'home' && jc) {
      const home = jc.closest('.home') || document.querySelector('#app .home');
      if (home && !document.getElementById('tv-barra')) {
        const b = document.createElement('div'); b.id = 'tv-barra'; b.className = 'tv-barra'; b.innerHTML = barraHTML();
        const hub = home.querySelector(':scope > .hubbtn, :scope > .hubrow');
        if (hub) hub.insertAdjacentElement('afterend', b); else home.prepend(b);
      }
      const box = jc.closest('.panel, .card');
      if (box && !document.getElementById('tv-pubbliche')) {
        sub('stanze/' + G.id + '/+');
        const p = document.createElement('div'); p.id = 'tv-pubbliche'; p.className = 'tv-panel';
        p.innerHTML = `<h3>🌍 Partite pubbliche in avvio</h3><div id="tv-pubbliche-l">${stanzeHTML(G.id)}</div>`;
        box.insertAdjacentElement('afterend', p);
      }
      if (box && !document.getElementById('tv-corso')) {
        const p = document.createElement('div'); p.id = 'tv-corso'; p.className = 'tv-panel';
        const h = corsoHTML(G.id); p.innerHTML = h; p.dataset.h = hashStr(h); p.style.display = h ? '' : 'none';
        box.insertAdjacentElement('afterend', p);
      }
    }
    if (st && st.view === 'game' && st.S && st.S.status === 'lobby') {
      const bc = document.querySelector('#app .bigcode');
      const box = bc && bc.closest('.panel, .card');
      if (box && !document.getElementById('tv-stanza')) {
        const p = document.createElement('div'); p.id = 'tv-stanza'; p.className = 'tv-panel'; p.innerHTML = stanzaHTML();
        box.insertAdjacentElement('afterend', p);
      }
    }
  }

  /* ---- ridisegno di tutto ciò che è del modulo ---- */
  let rq = false;
  function render() {
    if (rq) return; rq = true;
    requestAnimationFrame(() => {
      rq = false;
      if (!document.body) return;
      stile();
      const b = document.getElementById('tv-barra'); if (b) b.innerHTML = barraHTML();
      const pl = document.getElementById('tv-pubbliche-l'); if (pl) pl.innerHTML = stanzeHTML(G ? G.id : null);
      const ps = document.getElementById('tv-stanza'); if (ps) { const h = stanzaHTML(); if (ps.dataset.h !== hashStr(h)) { ps.dataset.h = hashStr(h); ps.innerHTML = h; } }
      const conto = document.getElementById('tv-conto'); if (conto) conto.innerHTML = `<button class="tv-btn" data-tv="conto" style="padding:5px 12px 5px 5px;border-radius:99px">${avatarHTML(C.id, 34)}<span>${esc(C.nome || 'Il mio profilo')}</span>${nonLette() ? `<span class="tv-badge">${nonLette()}</span>` : quantiOnline() ? `<span class="tv-small tv-on">● ${quantiOnline()}</span>` : ''}</button>`;
      const tutte = document.getElementById('tv-stanze-tutte'); if (tutte) tutte.innerHTML = stanzeHTML(null, true);
      const co = document.getElementById('tv-corso');
      if (co && G) { verificaCorso(G.id); const h = corsoHTML(G.id); if (co.dataset.h !== hashStr(h)) { co.dataset.h = hashStr(h); co.innerHTML = h; co.style.display = h ? '' : 'none'; } }
      const ao = document.getElementById('tv-amici-online');
      if (ao) { const L = amiciOrdinati().filter(a => online(a.id)); ao.innerHTML = L.length ? `<div class="tv-list">${L.map(a => rigaAmico(a, false)).join('')}</div>` : `<div class="tv-mut tv-small">${A.lista.length ? 'Nessun amico online in questo momento.' : 'Aggiungi i tuoi amici con il loro codice: qui vedrai chi è online e dove sta giocando.'} <button class="tv-btn tv-sm" data-tv="conto" style="margin-left:4px">👥 Amici</button></div>`; }
      renderAvvisi();
      renderPannello();
    });
  }
  setInterval(() => { render(); }, 10000);   // aggiorna "online/offline" e stanze scadute

  /* ---------------- avvio ---------------- */
  function urlNuovoSito() {
    let rel = '';
    try { const base = new URL(BASE); if (location.pathname.startsWith(base.pathname)) rel = location.pathname.slice(base.pathname.length); } catch (e) { }
    const h = location.hash.replace(/^#/, '');
    return NUOVO_SITO + rel + location.search + '#trasloco=' + C.id.slice(2) + '.' + C.seg + (h ? '&h=' + encodeURIComponent(h) : '');
  }
  function mostraTrasloco() {
    const m = document.createElement('div'); m.className = 'tv-modal'; m.style.zIndex = 100000;
    const dove = NUOVO_SITO.replace(/^https?:\/\//, '').replace(/\/$/, '');
    m.innerHTML = `<div class="tv-panel" style="max-width:420px;text-align:center;margin:auto">
      <div style="font-size:2.4rem">🏠➡️🏡</div>
      <h3 style="margin:8px 0">Tavolata ha cambiato casa!</h3>
      <p class="tv-small" style="margin:0 0 6px">Il nuovo indirizzo è <b>${esc(dove)}</b>. Salvalo nei preferiti!</p>
      <p class="tv-small tv-mut" style="margin:0 0 14px">Porti con te nome, foto, amici e statistiche. <span id="tv-tras-st">Preparo il tuo account…</span></p>
      <a class="tv-btn tv-pri" id="tv-tras-vai" href="#" style="display:inline-flex">Vai al nuovo sito →</a></div>`;
    const via = () => { try { pubProfilo(); syncConto(); controllaStats(true); } catch (e) { } location.replace(urlNuovoSito()); };
    m.querySelector('#tv-tras-vai').onclick = e => { e.preventDefault(); via(); };
    (document.body || document.documentElement).appendChild(m);
    /* prima di partire salva sul server le ultime modifiche (amici, statistiche), poi va da solo */
    let fatto = false;
    const parti = () => { if (fatto) return; fatto = true; const st = document.getElementById('tv-tras-st'); if (st) st.textContent = 'Ti porto lì…'; setTimeout(via, 2500); };
    const aspetta = setInterval(() => { if (Net.ok) { clearInterval(aspetta); try { pubProfilo(); syncConto(); controllaStats(true); } catch (e) { } parti(); } }, 300);
    setTimeout(() => { clearInterval(aspetta); parti(); }, 9000);
  }
  function donaHTML() {
    return KOFI
      ? `<a class="tv-dona" href="${esc(KOFI)}" target="_blank" rel="noopener">☕ Ti piace Tavolata? Offrici un caffè su Ko-fi</a>`
      : `<button type="button" class="tv-dona tv-dona-off" data-tv="dona-presto" title="Le donazioni non sono ancora attive">☕ Sostieni Tavolata · presto disponibile</button>`;
  }
  /* versione corta del pulsante, per le barre in alto (giochi e home) */
  function donaBreveHTML(testo) {
    return KOFI
      ? `<a class="tv-dona tv-dona-sm" href="${esc(KOFI)}" target="_blank" rel="noopener" title="Sostieni Tavolata su Ko-fi">${esc(testo || '☕ Sostienici')}</a>`
      : `<button type="button" class="tv-dona tv-dona-sm tv-dona-off" data-tv="dona-presto">☕ Presto</button>`;
  }
  function mettiDona() {
    /* le pagine possono preparare un posto: <span class="tv-dona-slot" data-testo="…"></span> */
    document.querySelectorAll('.tv-dona-slot').forEach(f => { if (!f.firstChild) f.innerHTML = donaBreveHTML(f.dataset.testo); });
    document.querySelectorAll('.tv-copy, .tv-copy-home').forEach(f => {
      if (f.querySelector('.tv-dona')) return;
      const d = document.createElement('div'); d.className = 'tv-dona-riga'; d.innerHTML = donaHTML(); f.appendChild(d);
    });
  }
  /* conta le visite solo sul sito vero (non nelle prove in locale né sul vecchio indirizzo) */
  function contaVisite() {
    if (!STATISTICHE || !NUOVO_SITO || location.host !== new URL(NUOVO_SITO).host || document.querySelector('script[data-cf-beacon]')) return;
    const sc = document.createElement('script'); sc.defer = true;
    sc.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    sc.setAttribute('data-cf-beacon', JSON.stringify({ token: STATISTICHE }));
    document.head.appendChild(sc);
  }
  function avvio() {
    stile();
    try { contaVisite(); } catch (e) { }
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mettiDona); else mettiDona();
    if (DA_TRASLOCARE) { connetti(); preparaCifra(); if (document.body) mostraTrasloco(); else addEventListener('DOMContentLoaded', mostraTrasloco); return; }
    if (TRASLOCO && TRASLOCO.fatto) setTimeout(() => avviso('🏡 Benvenuto nel nuovo indirizzo di Tavolata: il tuo account è arrivato!'), 1200);
    else if (TRASLOCO && TRASLOCO.id !== C.id) setTimeout(() => conferma('Portare qui l\'account del vecchio indirizzo?',
      'Su questo dispositivo, nel nuovo indirizzo, c\'è già un altro account. Vuoi usare quello che avevi sul vecchio sito? Gli amici di questo dispositivo restano e vengono uniti.',
      'Sì, usa quello vecchio', () => { const r = collegaDa(TRASLOCO.id.slice(2) + '.' + TRASLOCO.seg); if (r.ricarica) setTimeout(() => location.reload(), 1200); }), 800);
    A.lista.forEach(a => { sub('presenza/' + a.id); chiediProfilo(a.id); });
    sub('posta/' + C.id + '/#');
    sub('utenti/' + C.id + '/profilo');
    if (document.getElementById('tv-stanze-tutte')) sub('stanze/+/+');
    connetti();
    preparaCifra();
    if (FIREBASE && ggInfo()) { GG.stato = 'carico'; ggCarica(); }
    if (!G) {
      setInterval(() => { pubPresenza(false); if (Date.now() - (avvio.s || 0) > 15000) { avvio.s = Date.now(); controllaStats(false); pubRiepilogo(false); } }, 3000);
    }
    render();
  }
  addEventListener('pagehide', () => { try { if (G && R.pubblicata) togliPubblica(); pub('presenza/' + C.id, { on: false, t: Date.now() }); } catch (e) { } });
  addEventListener('pageshow', e => { if (e.persisted) pubPresenza(true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pubPresenza(true); controllaStats(false); } });
  addEventListener('storage', e => {
    if (e.key === K.conto) { const n = jget(K.conto); if (n && n.id && n.id !== C.id) return location.reload(); if (n && n.id === C.id && n.t > C.t) { C = n; emit('profilo', profiloDi(C.id)); G && G.impostaNome && C.nome && G.impostaNome(C.nome); render(); } }
    if (e.key === K.amici) { const n = jget(K.amici); if (n) { A = { t: n.t || 0, lista: n.lista || [], uscite: n.uscite || [] }; A.lista.forEach(a => { sub('presenza/' + a.id); chiediProfilo(a.id); }); render(); } }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvio); else setTimeout(avvio, 0);

  /* ---------------- cosa vedono i giochi e le pagine ---------------- */
  window.Tavolata = {
    get id() { return C.id; },
    nome: () => C.nome,
    conto: () => ({ id: C.id, nome: C.nome, foto: C.foto, emoji: C.emoji, colore: C.colore, nomi: C.nomi.slice(), codice: codiceAmico(C.id) }),
    impostaNome, salvaProfilo, fotoDaFile, profiloDi, avatarHTML, conFoto,
    amici: () => amiciOrdinati().map(a => Object.assign({}, a, profiloDi(a.id) || {}, { online: online(a.id), stato: statoAmico(a.id) })),
    uscite: () => A.uscite.slice(), richieste: () => richiesteInArrivo(),
    chiediAmicizia, accettaAmicizia, rifiutaAmicizia, rimuoviAmico, annullaRichiesta, eAmico,
    collegaGioco, puoEntrare, posti, vai, apriPannello, chiudiPannello, avviso, conferma, copia,
    stanze: stanzeAttive, GIOCHI, GIOCO, partiteDi, riassunto, riepilogoLocale,
    riepilogoDi: id => { if (id === C.id) return { t: Date.now(), giochi: riepilogoLocale() }; sub('utenti/' + id + '/riepilogo'); return RIEP[id] || null; },
    seguiProfilo: id => { chiediProfilo(id); sub('presenza/' + id); },
    online, statoAmico, linkDispositivo, collegaDa, codiceAmico, idDaCodice, EMOJI, COLORI, BASE, QS,
    collegato: () => Net.ok, esc, quando, render,
    kofi: KOFI, donaHTML: donaBreveHTML,
    google: { stato: ggStato, accedi: ggAccedi, esci: ggEsci, elimina: ggElimina, salva: ggInvia, prepara: ggCarica, html: ggHTML }
  };
})();
