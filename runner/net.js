'use strict';

// Live races over Firebase Realtime Database. The Firebase SDK is only loaded when a
// player opens Race Friends, so solo play never touches the network.
//
// Data layout (see firebase/database.rules.json):
//   rooms/{CODE}/meta          { host, format, status, seed, startAt, round, createdAt }
//   rooms/{CODE}/players/{uid} { name, look, joinedAt }
//   rooms/{CODE}/state/{uid}   this player's live position, sent ~8 times a second
window.NeonNet = (() => {
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const MAX_PLAYERS = 4;
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I mix-ups

  const config = () => window.NEON_FIREBASE_TEST || window.NEON_FIREBASE || null;
  const available = () => !!(config() && config().apiKey);

  let conn = null; // shared connection, made once

  async function connect() {
    if (conn) return conn;
    const cfg = config();
    if (!cfg) throw new Error('Online races are not set up yet.');
    const [appMod, authMod, dbMod] = await Promise.all([
      import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-database.js'),
    ]);
    const app = appMod.initializeApp(cfg);
    const auth = authMod.getAuth(app);
    const db = dbMod.getDatabase(app);
    if (cfg.emulator) {
      authMod.connectAuthEmulator(auth, `http://${cfg.emulator}:9099`, { disableWarnings: true });
      dbMod.connectDatabaseEmulator(db, cfg.emulator, 9000);
    }
    const { user } = await authMod.signInAnonymously(auth);
    const D = dbMod;
    let offset = 0;
    D.onValue(D.ref(db, '.info/serverTimeOffset'), (s) => { offset = s.val() || 0; });
    const r = (path) => D.ref(db, path);

    conn = {
      uid: user.uid,
      // Firebase server time in ms, so countdowns line up on every phone
      serverNow: () => Date.now() + offset,

      async createRoom(format, player) {
        for (let attempt = 0; attempt < 8; attempt++) {
          let code = '';
          for (let i = 0; i < 4; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
          const metaRef = r(`rooms/${code}/meta`);
          if ((await D.get(metaRef)).exists()) continue;
          try {
            await D.set(metaRef, { host: user.uid, format, status: 'lobby', round: 0, seed: 0, startAt: 0, createdAt: D.serverTimestamp() });
          } catch { continue; } // someone grabbed the code at the same moment
          D.onDisconnect(metaRef).remove(); // the room closes if the host goes away
          await this.addPlayer(code, player);
          return code;
        }
        throw new Error('Could not create a room, please try again.');
      },

      async joinRoom(code, player) {
        const meta = (await D.get(r(`rooms/${code}/meta`))).val();
        if (!meta) return { ok: false, reason: 'No room with that code.' };
        const players = (await D.get(r(`rooms/${code}/players`))).val() || {};
        if (!players[user.uid] && Object.keys(players).length >= MAX_PLAYERS) return { ok: false, reason: 'That room is full (4 players).' };
        if (meta.status === 'countdown' && !players[user.uid]) return { ok: false, reason: 'That race has already started.' };
        await this.addPlayer(code, player);
        return { ok: true };
      },

      async addPlayer(code, player) {
        const pRef = r(`rooms/${code}/players/${user.uid}`), sRef = r(`rooms/${code}/state/${user.uid}`);
        await D.set(pRef, { name: player.name, look: player.look, joinedAt: D.serverTimestamp() });
        D.onDisconnect(pRef).remove();
        D.onDisconnect(sRef).remove();
      },

      // cb({ meta, players, state }) on every change; returns an unsubscribe function
      watchRoom(code, cb) {
        const room = { meta: undefined, players: {}, state: {} };
        const offs = ['meta', 'players', 'state'].map((key) => D.onValue(r(`rooms/${code}/${key}`), (s) => {
          room[key] = s.val() || (key === 'meta' ? null : {});
          if (room.meta !== undefined) cb(room);
        }));
        return () => offs.forEach((off) => off());
      },

      setMeta: (code, patch) => D.update(r(`rooms/${code}/meta`), patch),
      setState: (code, st) => D.set(r(`rooms/${code}/state/${user.uid}`), st),

      async leaveRoom(code, isHost) {
        const pRef = r(`rooms/${code}/players/${user.uid}`), sRef = r(`rooms/${code}/state/${user.uid}`);
        await Promise.all([D.remove(pRef), D.remove(sRef)]).catch(() => {});
        D.onDisconnect(pRef).cancel(); D.onDisconnect(sRef).cancel();
        if (isHost) {
          const metaRef = r(`rooms/${code}/meta`);
          await D.remove(metaRef).catch(() => {});
          D.onDisconnect(metaRef).cancel();
        }
      },
    };
    return conn;
  }

  return { MAX_PLAYERS, available, connect };
})();
