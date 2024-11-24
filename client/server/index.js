const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Global state
let votingState = {
  currentStep: 1,
  resolution: '',
  totalMembers: 0,
  threshold: 0,
  members: [],
  votes: {},
  shares: []
};

// Helper function to broadcast state
function broadcastState() {
  io.emit('stateUpdate', votingState);
}

// Helper function to generate shares (mock implementation)
function generateShares(totalMembers) {
  return Array.from(
    { length: totalMembers },
    (_, i) => ({
      id: i + 1,
      share: `Share-${i + 1}-${Math.random().toString(36).substring(7)}`
    })
  );
}

// Helper function to calculate voting results
function calculateResults() {
  const votes = Object.values(votingState.votes);
  return {
    approved: votes.filter(v => v).length,
    rejected: votes.filter(v => !v).length,
    totalVotes: votes.length
  };
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Send current state to newly connected client
  socket.emit('stateUpdate', votingState);

  // Setup voting session
  socket.on('setupVoting', ({ totalMembers, threshold }, callback) => {
    try {
      if (totalMembers < 3) {
        callback?.({ success: false, error: 'Total members must be at least 3' });
        return;
      }

      if (threshold > totalMembers) {
        callback?.({ success: false, error: 'Threshold cannot be greater than total members' });
        return;
      }

      votingState = {
        ...votingState,
        currentStep: 2,
        totalMembers,
        threshold,
        members: [],
        votes: {},
        shares: []
      };
      
      broadcastState();
      callback?.({ success: true });
    } catch (error) {
      console.error('Setup error:', error);
      callback?.({ success: false, error: 'Failed to setup voting session' });
    }
  });

  // Set resolution
  socket.on('setResolution', ({ resolution }, callback) => {
    try {
      if (!resolution.trim()) {
        callback?.({ success: false, error: 'Resolution cannot be empty' });
        return;
      }

      votingState = {
        ...votingState,
        currentStep: 3,
        resolution
      };
      
      broadcastState();
      callback?.({ success: true });
    } catch (error) {
      console.error('Resolution error:', error);
      callback?.({ success: false, error: 'Failed to set resolution' });
    }
  });

  // Join voting
  socket.on('joinVoting', ({ name }, callback) => {
    try {
      if (!name.trim()) {
        callback?.({ success: false, error: 'Name cannot be empty' });
        return;
      }

      if (votingState.members.length >= votingState.totalMembers) {
        callback?.({ success: false, error: 'Maximum number of members reached' });
        return;
      }

      if (votingState.members.some(m => m.id === socket.id)) {
        callback?.({ success: false, error: 'Already joined the session' });
        return;
      }

      const newMember = {
        id: socket.id,
        name,
        hasVoted: false
      };

      votingState.members.push(newMember);
      broadcastState();
      callback?.({ success: true, memberId: socket.id });
    } catch (error) {
      console.error('Join error:', error);
      callback?.({ success: false, error: 'Failed to join session' });
    }
  });

  // Submit vote
  socket.on('submitVote', async ({ vote }, callback) => {
    try {
      const member = votingState.members.find(m => m.id === socket.id);
      
      if (!member) {
        callback?.({ success: false, error: 'Not a member of the session' });
        return;
      }

      if (member.hasVoted) {
        callback?.({ success: false, error: 'Already voted' });
        return;
      }

      votingState.votes[socket.id] = vote;
      member.hasVoted = true;

      // Check if vote count has reached threshold
      if (Object.keys(votingState.votes).length === votingState.threshold) {
        votingState.currentStep = 4;
        const initRes = await fetch('http://localhost:5882/api/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: votingState.votes,
            threshold: votingState.threshold,
            total_members: votingState.totalMembers
          })
        });
        console.log("init res:", initRes)

        // get shares from Zig API
        votingState.shares = generateShares(votingState.totalMembers);
        
        //const results = calculateResults();
        //io.emit('votingComplete', results);
      }

      broadcastState();
      callback?.({ success: true });
    } catch (error) {
      console.error('Vote error:', error);
      callback?.({ success: false, error: 'Failed to submit vote' });
    }
  });

  // Reveal result
  socket.on('revealResult', ({ shares }, callback) => {
    try {
      if (!Array.isArray(shares)) {
        callback?.({ success: false, error: 'Invalid shares format' });
        return;
      }

      if (shares.length < votingState.threshold) {
        callback?.({ success: false, error: 'Insufficient shares provided' });
        return;
      }
      
      /* 
       * get reconstructed secret from Zig SSSS API
       * fetch("localhost:5882/api/reconstruct", 
       * body { shares })
      */

      fetch('http://localhost:4000/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: votingState.threshold,
        })
      });
      const results = calculateResults();
      votingState.currentStep = 5;
      
      broadcastState();
      callback?.({ success: true, result: results });
    } catch (error) {
      console.error('Reveal error:', error);
      callback?.({ success: false, error: 'Failed to reveal result' });
    }
  });

  // Request current state (for reconnection)
  socket.on('requestState', (callback) => {
    try {
      socket.emit('stateUpdate', votingState);
      callback?.({ success: true });
    } catch (error) {
      console.error('State request error:', error);
      callback?.({ success: false, error: 'Failed to get current state' });
    }
  });

  // Reset voting
  socket.on('reset', (callback) => {
    try {
      votingState = {
        currentStep: 1,
        resolution: '',
        totalMembers: 0,
        threshold: 0,
        members: [],
        votes: {},
        shares: []
      };
      
      broadcastState();
      callback?.({ success: true });
    } catch (error) {
      console.error('Reset error:', error);
      callback?.({ success: false, error: 'Failed to reset session' });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    votingState.members = votingState.members.filter(m => m.id !== socket.id);
    delete votingState.votes[socket.id];
    broadcastState();
  });
});

// Error handling
io.on('error', (error) => {
  console.error('Socket.IO error:', error);
});

httpServer.on('error', (error) => {
  console.error('HTTP server error:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
