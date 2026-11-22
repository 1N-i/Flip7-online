import { initializeApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  onValue,
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

// Inicializa o Firebase apenas se as variáveis estiverem configuradas
const isConfigured = Boolean(firebaseConfig.databaseURL);
const app = isConfigured ? initializeApp(firebaseConfig) : null;
const db = app ? getDatabase(app) : null;

export function isOnlineAvailable() {
  return isConfigured;
}

// Gera um código de sala curto de 4 caracteres sem letras/números ambíguos.
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Cria uma nova sala online e retorna { roomCode, playerId }.
export async function createOnlineRoom(hostName) {
  if (!db) throw new Error('Firebase não configurado no arquivo .env.local');

  let roomCode = generateRoomCode();
  let roomRef = ref(db, `rooms/${roomCode}`);
  let snapshot = await get(roomRef);

  // Garante que o código gerado não colida com uma sala ativa
  while (snapshot.exists()) {
    roomCode = generateRoomCode();
    roomRef = ref(db, `rooms/${roomCode}`);
    snapshot = await get(roomRef);
  }

  const playerId = `p-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  await set(roomRef, {
    code: roomCode,
    status: 'lobby', // 'lobby' | 'playing'
    hostId: playerId,
    createdAt: Date.now(),
    lobbyPlayers: {
      [playerId]: {
        id: playerId,
        name: hostName.trim(),
        joinedAt: Date.now(),
      },
    },
    gameState: null,
  });

  return { roomCode, playerId };
}

// Entra em uma sala existente pelo código.
export async function joinOnlineRoom(rawCode, playerName) {
  if (!db) throw new Error('Firebase não configurado no arquivo .env.local');

  const roomCode = rawCode.trim().toUpperCase();
  const roomRef = ref(db, `rooms/${roomCode}`);
  const snapshot = await get(roomRef);

  if (!snapshot.exists()) {
    throw new Error('Sala não encontrada. Verifique o código digitado.');
  }

  const roomData = snapshot.val();

  if (roomData.status !== 'lobby') {
    throw new Error('Esta partida já está em andamento.');
  }

  const currentPlayers = Object.values(roomData.lobbyPlayers || {});
  if (currentPlayers.length >= 18) {
    throw new Error('A sala já atingiu o limite máximo de 18 jogadores.');
  }

  const playerId = `p-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  await update(ref(db, `rooms/${roomCode}/lobbyPlayers/${playerId}`), {
    id: playerId,
    name: playerName.trim(),
    joinedAt: Date.now(),
  });

  return { roomCode, playerId };
}

// Escuta alterações em tempo real na sala. Retorna função para cancelar inscrição.
export function subscribeToRoom(roomCode, callback) {
  if (!db) return () => {};
  const roomRef = ref(db, `rooms/${roomCode}`);
  return onValue(roomRef, (snapshot) => {
    callback(snapshot.exists() ? snapshot.val() : null);
  });
}

// Inicia a partida online gravando o estado inicial gerado pelo motor.
export async function startOnlineMatch(roomCode, initialGameState) {
  if (!db) return;
  await update(ref(db, `rooms/${roomCode}`), {
    status: 'playing',
    gameState: initialGameState,
  });
}

// Sincroniza o novo estado do jogo após uma jogada.
export async function syncGameState(roomCode, nextGameState) {
  if (!db) return;
  await set(ref(db, `rooms/${roomCode}/gameState`), nextGameState);
}

// Normaliza o gameState vindo do Firebase (restaurando arrays vazios omitidos pelo banco).
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