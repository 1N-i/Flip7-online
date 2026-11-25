import { initializeApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  onDisconnect,
} from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const isConfigured = Boolean(firebaseConfig.databaseURL);
const app = isConfigured ? initializeApp(firebaseConfig) : null;
const db = app ? getDatabase(app) : null;

export function isOnlineAvailable() {
  return isConfigured;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Configura detecção automática de desconexão no servidor do Firebase.
export function registerPlayerPresence(roomCode, playerId) {
  if (!db || !roomCode || !playerId) return;
  const presenceRef = ref(db, `rooms/${roomCode}/lobbyPlayers/${playerId}/online`);
  set(presenceRef, true);
  onDisconnect(presenceRef).set(false);
}

export async function createOnlineRoom(hostName) {
  if (!db) throw new Error('Firebase não configurado no arquivo .env.local');

  let roomCode = generateRoomCode();
  let roomRef = ref(db, `rooms/${roomCode}`);
  let snapshot = await get(roomRef);

  while (snapshot.exists()) {
    roomCode = generateRoomCode();
    roomRef = ref(db, `rooms/${roomCode}`);
    snapshot = await get(roomRef);
  }

  const playerId = `p-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  await set(roomRef, {
    code: roomCode,
    status: 'lobby',
    hostId: playerId,
    createdAt: Date.now(),
    lobbyPlayers: {
      [playerId]: {
        id: playerId,
        name: hostName.trim(),
        online: true,
        joinedAt: Date.now(),
      },
    },
    gameState: null,
  });

  registerPlayerPresence(roomCode, playerId);
  return { roomCode, playerId };
}

export async function joinOnlineRoom(rawCode, playerName) {
  if (!db) throw new Error('Firebase não configurado no arquivo .env.local');

  const roomCode = rawCode.trim().toUpperCase();
  const roomRef = ref(db, `rooms/${roomCode}`);
  const snapshot = await get(roomRef);

  if (!snapshot.exists()) {
    throw new Error('Sala não encontrada. Verifique o código digitado.');
  }

  const roomData = snapshot.val();
  const isPlaying = roomData.status === 'playing';

  const activeLobbyPlayers = Object.values(roomData.lobbyPlayers || {}).filter(
    (p) => p.online !== false && !p.isSpectator
  );

  if (!isPlaying && activeLobbyPlayers.length >= 18) {
    throw new Error('A sala já atingiu o limite máximo de 18 jogadores.');
  }

  const playerId = `p-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  await update(ref(db, `rooms/${roomCode}/lobbyPlayers/${playerId}`), {
    id: playerId,
    name: playerName.trim(),
    online: true,
    isSpectator: isPlaying,
    joinedAt: Date.now(),
  });

  registerPlayerPresence(roomCode, playerId);
  return { roomCode, playerId, isSpectator: isPlaying };
}

export function subscribeToRoom(roomCode, callback) {
  if (!db) return () => {};
  const roomRef = ref(db, `rooms/${roomCode}`);
  return onValue(roomRef, (snapshot) => {
    callback(snapshot.exists() ? snapshot.val() : null);
  });
}

export async function startOnlineMatch(roomCode, initialGameState) {
  if (!db) return;
  await update(ref(db, `rooms/${roomCode}`), {
    status: 'playing',
    gameState: initialGameState,
  });
}

export async function promoteSpectatorsAndStart(roomCode, lobbyPlayers, initialGameState) {
  if (!db) return;
  const updatedLobby = { ...lobbyPlayers };
  Object.keys(updatedLobby).forEach((id) => {
    if (updatedLobby[id]) {
      updatedLobby[id].isSpectator = false;
    }
  });

  await update(ref(db, `rooms/${roomCode}`), {
    status: 'playing',
    lobbyPlayers: updatedLobby,
    gameState: initialGameState,
  });
}

export async function syncGameState(roomCode, nextGameState) {
  if (!db) return;
  await set(ref(db, `rooms/${roomCode}/gameState`), nextGameState);
}

// Transfere a liderança da sala para outro jogador humano conectado caso o host saia.
export async function transferHost(roomCode, newHostId) {
  if (!db || !roomCode || !newHostId) return;
  await update(ref(db, `rooms/${roomCode}`), {
    hostId: newHostId,
  });
}

// Remove completamente uma sala do Realtime Database.
export async function deleteOnlineRoom(roomCode) {
  if (!db || !roomCode) return;
  await remove(ref(db, `rooms/${roomCode}`));
}

/**
 * Marca o jogador como desconectado ao clicar em Sair.
 * Se não restar nenhum jogador humano conectado na sala (apenas bots ou vazia),
 * deleta a sala imediatamente do banco de dados.
 */
export async function leaveOnlineRoom(roomCode, playerId) {
  if (!db || !roomCode || !playerId) return;

  const roomRef = ref(db, `rooms/${roomCode}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) return;

  const roomData = snapshot.val();
  const lobbyPlayers = roomData.lobbyPlayers || {};

  // Verifica se ainda existe algum outro jogador humano online além de quem está saindo
  const otherConnectedHumans = Object.values(lobbyPlayers).filter(
    (p) => !p.isBot && p.id !== playerId && p.online !== false
  );

  if (otherConnectedHumans.length === 0) {
    await remove(roomRef);
  } else {
    await set(
      ref(db, `rooms/${roomCode}/lobbyPlayers/${playerId}/online`),
      false
    );
  }
}

export async function addBotToOnlineLobby(roomCode, botData) {
  if (!db) return;
  await update(ref(db, `rooms/${roomCode}/lobbyPlayers/${botData.id}`), {
    ...botData,
    online: true,
    joinedAt: Date.now(),
  });
}

export async function removePlayerFromOnlineLobby(roomCode, playerId) {
  if (!db) return;
  await set(ref(db, `rooms/${roomCode}/lobbyPlayers/${playerId}`), null);
}

export function normalizeFirebaseGameState(raw) {
  if (!raw) return null;
  return {
    ...raw,
    drawPile: raw.drawPile || [],
    discardPile: raw.discardPile || [],
    winnerIds: raw.winnerIds || [],
    logs: raw.logs || [],
    players: (raw.players || []).map((p) => ({
      ...p,
      hand: p.hand || [],
    })),
  };
}
