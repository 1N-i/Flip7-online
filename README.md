# 🃏 Flip 7 Online

Recriação web multiplayer do jogo de cartas **Flip 7**, desenvolvida em React com sincronização em tempo real via Firebase Realtime Database e suporte a oponentes controlados por IA (Bots).

## ✨ Funcionalidades
- **Multiplayer Online em Tempo Real (2 a 18 jogadores):** Criação e entrada em salas através de código curto de 4 caracteres.
- **Modo Local / Solo vs Bots:** Jogue no mesmo dispositivo ou enfrente bots com diferentes perfis de risco (*Conservador*, *Equilibrado* e *Arriscado*).
- **Regras Oficiais Completas:**
  - Baralho oficial de 94 cartas com reembaralhamento automático do descarte.
  - Cartas numéricas (`0` a `12`), modificadores (`+2` a `+10`, `x2`) e bônus de `+15` pontos ao completar 7 números diferentes (*Flip 7*).
  - Cartas de ação (*Freeze*, *Flip Three* com resolução encadeada e *Second Chance*).
  - Partidas até 200 pontos com desempate automático.

## 🛠️ Tecnologias Utilizadas
- **React + Vite**
- **Firebase Realtime Database**
- **GitHub Pages**

## 🚀 Como rodar localmente
1. Clone o repositório e instale as dependências:
   ```bash
   npm install
   ```
2. Crie um arquivo `.env.local` na raiz do projeto com as credenciais do seu projeto Firebase (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_DATABASE_URL`, etc.) para habilitar o modo online, ou inicie diretamente para utilizar o modo local e bots:
   ```bash
   npm run dev
   ```
