import { createServer } from 'http';
import express from 'express';
import { Server, Socket } from 'socket.io';

interface CallHandshakePayload {
  callerId: string;
  callerName: string;
  callerAvatar: string;
  receiverId: string;
  callType: 'voice' | 'video';
  roomId: string;
}

interface WebRTCSignalPayload {
  targetId: string;
  senderId: string;
  type: 'offer' | 'answer' | 'candidate';
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export function startSignalingServer() {
  const app = express();
  const httpServer = createServer(app);
  
  // Initialize Socket.io on Port 3000 alongside Express HTTP
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket: Socket) => {
    console.log(`Socket client connected inside signaling: ${socket.id}`);

    // Join room for custom individual user ID to receive direct incoming calls
    socket.on('join-user-room', (userId: string) => {
      socket.join(userId);
      console.log(`User mapped to call-corridor room: ${userId}`);
    });

    // 1-to-1 Room Signaling Isolation
    socket.on('join-room', (roomId: string) => {
      // Direct maximum boundary ceiling to enforce 2 users per room constraint
      const clients = io.sockets.adapter.rooms.get(roomId);
      const numClients = clients ? clients.size : 0;
      
      if (numClients < 2) {
        socket.join(roomId);
        console.log(`Socket ${socket.id} entered isolated session room: ${roomId}`);
        socket.emit('room-joined', { roomId });
      } else {
        console.warn(`Room room-full boundary hit for: ${roomId}`);
        socket.emit('room-full', { roomId });
      }
    });

    // Call user handshake: Forward request to the target recipient room
    socket.on('call-user', (data: CallHandshakePayload) => {
      console.log(`Initiating call from ${data.callerId} mapping to recipient: ${data.receiverId}`);
      socket.to(data.receiverId).emit('incoming-call', data);
    });

    // Accept Call handshake: notify the caller that caller room was answered
    socket.on('accept-call', (data: { callerId: string; receiverId: string }) => {
      console.log(`Call accepted by ${data.receiverId} targeting caller: ${data.callerId}`);
      socket.to(data.callerId).emit('call-accepted', data);
    });

    // Decline Call handshake: notify the caller that call was rejected
    socket.on('reject-call', (data: { callerId: string; receiverId: string }) => {
      console.log(`Call rejected by receiver: ${data.receiverId}`);
      socket.to(data.callerId).emit('call-rejected');
    });

    // End active call session: broadcast to other party
    socket.on('end-call', (data: { otherPartyId: string }) => {
      console.log(`Call ended by participant`);
      if (data.otherPartyId) {
        socket.to(data.otherPartyId).emit('call-ended');
      }
    });

    // WebRTC signaling relay (Offers, Answers, and ICE candidates)
    socket.on('webrtc-signal', (data: WebRTCSignalPayload) => {
      if (data.targetId) {
        socket.to(data.targetId).emit('webrtc-signal', data);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return { app, httpServer, io };
}
