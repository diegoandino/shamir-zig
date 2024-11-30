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

let votingState = {
  currentStep: 1,
  resolution: '',
  totalMembers: 0,
  threshold: 0,
  members: [],
  votes: {},
  shares: [],
  shareIndex: 0
};

// Helper function to broadcast state
function broadcastState() {
  io.emit('stateUpdate', votingState);
}

// Helper function to broadcast shares to specific clients
function broadcastShares(shares) {
  shares.forEach((share) => {
    io.to(share.id).emit('shareReceived', {
      id: share.id,
      share: share.share
    });
  });
}

// Helper function to calculate voting results
function getResults() {
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
  socket.on('setResolution', async ({ resolution }, callback) => {
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

      await fetch('http://localhost:5882/api/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: votingState.resolution,
          threshold: votingState.threshold,
          total_shares: votingState.totalMembers
        })
      });
      
      broadcastState();
      callback?.({ success: true });
    } catch (error) {
      console.error('Resolution error:', error);
      callback?.({ success: false, error: 'Failed to set resolution' });
    }
  });

  // Join voting
  socket.on('joinVoting', async ({ name }, callback) => {
    try {
      // Input validation
      if (!name.trim()) {
        const err = 'Name cannot be empty';
        console.log(err);
        callback?.({ success: false, error: err });
        return;
      }

      // Check member limits and duplicates
      if (votingState.members.length >= votingState.totalMembers) {
        const err = 'Maximum number of members reached';
        console.log(err);
        callback?.({ success: false, error: err });
        return;
      }

      if (votingState.members.some(m => m.id === socket.id)) {
        const err = 'Already joined the session';
        console.log(err);
        callback?.({ success: false, error: err });
        return;
      }

      // Initialize the new member
      const newMember = {
        id: socket.id,
        name,
        hasVoted: false,
        apprpved: false,
        share: null
      };

      try {
        // No shares exist yet - fetch new shares for all members
        if (!votingState.shares || votingState.shares.length === 0) {
          const sharesRes = await fetch('http://localhost:5882/api/shares', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              count: votingState.totalMembers             
            })
          });

          if (!sharesRes.ok) {
            throw new Error('Failed to fetch shares');
          }

          const sharesData = await sharesRes.json();
          votingState.shares = sharesData.shares.map((share, index) => ({
            id: index < votingState.members.length 
              ? votingState.members[index].id 
              : socket.id,
            share: share
          }));

          // Assign share to new member
          const memberShare = votingState.shares.find(s => s.id === socket.id);
          if (!memberShare) {
            throw new Error('Share assignment failed');
          }
          newMember.share = memberShare.share;
          votingState.shareIndex += 1;
        } 
        // Shares exist but need to check availability
        else {
          if (votingState.shareIndex >= votingState.shares.length) {
            const err = 'No more shares available';
            console.log(err);
            callback?.({ success: false, error: err });
            return;
          }
          
          // Assign next available share
          newMember.share = votingState.shares[votingState.shareIndex].share;
          votingState.shareIndex += 1;
        }

        // Add member and broadcast
        votingState.members.push(newMember);
        console.log("New member joined:", newMember);
        broadcastState();
        
        callback?.({
          success: true,
          memberId: socket.id,
          member: newMember
        });

      } catch (shareError) {
        console.error('Share assignment error:', shareError);
        callback?.({ success: false, error: 'Failed to assign shares' });
        return;
      }

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
      member.hasVoted = vote;
      broadcastState();

      // Check if vote count has reached threshold
      const results = getResults()
      if (results.approved === votingState.threshold) {
        votingState.currentStep = 4;
        broadcastState();
      }

      callback?.({ success: true });
    } catch (error) {
      console.error('Vote error:', error);
      callback?.({ success: false, error: 'Failed to submit vote' });
    }
  });

  // Reveal result
  socket.on('revealResult', async ({ shares }, callback) => {
    try {
      if (!Array.isArray(shares)) {
        const err = 'Invalid shares format'
        console.error(err)
        callback?.({ success: false, error: err });
        return;
      }

      if (shares.length < votingState.threshold) {
        const err = 'Insufficient shares provided'
        console.error(err)
        callback?.({ success: false, error: err });
        return;
      }
      
      console.log("shares body (PRE JSON): ", shares)
      const body = JSON.stringify({
        shares: shares
      })
      console.log("shares body: ", body)

      //get reconstructed secret from Zig SSSS API
      const res = await fetch('http://localhost:5882/api/reconstruct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body 
      }).then(x => x.json())
      
      console.log("reveal result: ", res.secret)

      if (res.secret === 0 || res.success === false) {
        callback?.({ success: false, error: 'Invalid shares' });
        return;
      }

      const result = res.secret
      //votingState.currentStep = 5;
      
      broadcastState();
      callback?.({ success: true, result: result });
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
        shares: [],
        shareIndex: 0
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
