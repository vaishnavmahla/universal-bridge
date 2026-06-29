import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

// Health check route for deployment
app.get('/health', (req, res) => {
  res.send({ status: 'active', timestamp: new Date() });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Allows quick connections from local dev & production environments
    methods: ["GET", "POST"]
  }
});

// In-memory store for room states (e.g., current shared note text)
// Cleared automatically when rooms are empty to prevent memory leaks
const roomStates = new Map();

io.on('connection', (socket) => {
  console.log(`🔌 Device connected: ${socket.id}`);

  // 1. JOIN ROOM
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    
    // Check how many devices are in the room
    const clients = io.sockets.adapter.rooms.get(roomId);
    const numClients = clients ? clients.size : 0;
    
    console.log(`📱 Device ${socket.id} joined room: ${roomId} (Total: ${numClients})`);

    // If there is an existing shared note in memory, send it to the newly joined device
    if (roomStates.has(roomId)) {
      socket.emit('init-note', roomStates.get(roomId).noteText);
    } else {
      roomStates.set(roomId, { noteText: '' });
    }

    // Let other peers in the room know a new device is ready to connect via WebRTC
    if (numClients > 1) {
      socket.to(roomId).emit('peer-ready', socket.id);
    }
  });

  // 2. LIVE SHARD NOTES & CLIPBOARD SYNC
  // Broadcasts typing updates to all other devices in the room instantly
  socket.on('update-note', ({ roomId, text }) => {
    if (roomStates.has(roomId)) {
      roomStates.get(roomId).noteText = text;
    }
    socket.to(roomId).emit('note-updated', text);
  });

  // Broadcasts instant clipboard paste notifications (text or base64 images)
  socket.on('share-clipboard', ({ roomId, data }) => {
    socket.to(roomId).emit('clipboard-received', data);
  });

  // 3. WebRTC SIGNALING PIPELINES
  // Passes SDP offers/answers directly between devices without inspecting payloads
  socket.on('webrtc-offer', ({ targetId, offer }) => {
    io.to(targetId).emit('webrtc-offer', { senderId: socket.id, offer });
  });

  socket.on('webrtc-answer', ({ targetId, answer }) => {
    io.to(targetId).emit('webrtc-answer', { senderId: socket.id, answer });
  });

  // Passes ICE candidates for network traversal
  socket.on('webrtc-ice-candidate', ({ targetId, candidate }) => {
    io.to(targetId).emit('webrtc-ice-candidate', { senderId: socket.id, candidate });
  });

  // 4. CLEANUP ON DISCONNECT
  socket.on('disconnecting', () => {
    // Loop through all rooms the device was part of before disconnecting
    for (const roomId of socket.rooms) {
      if (roomId !== socket.id) {
        const clients = io.sockets.adapter.rooms.get(roomId);
        // clients size includes this disconnecting socket; if it's <= 1, the room will be empty
        if (clients && clients.size <= 1) {
          roomStates.delete(roomId);
          console.log(`🗑️ Room ${roomId} is empty. Automated state purge completed.`);
        }
      }
    }
  });

  // socket.on('clear-room-data', ({ roomId }) => {
  //   // Broadcast the clear command to everyone else in the room
  //   socket.to(roomId).emit('room-data-cleared');
  // });

  socket.on('clear-room-data', ({ roomId }) => {
    // Force target room broadcast directly from the primary IO engine instance
    io.in(roomId).emit('room-data-cleared');
  });

  socket.on('disconnect', () => {
    console.log(`❌ Device disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Signaling server running smoothly on port ${PORT}`);
});