const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client } = require('ssh2');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Main route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle Socket.IO connections
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  let sshClient = null;
  let sshStream = null;

  // Handle SSH connection request
  socket.on('ssh-connect', (config) => {
    console.log('SSH connection requested:', config.host);
    
    sshClient = new Client();
    
    sshClient.on('ready', () => {
      console.log('SSH connection established');
      socket.emit('ssh-status', { status: 'connected', message: 'Connected to server' });
      
      sshClient.shell({ term: 'xterm-color' }, (err, stream) => {
        if (err) {
          socket.emit('ssh-error', { message: err.message });
          return;
        }
        
        sshStream = stream;
        
        // Send data from SSH to client
        stream.on('data', (data) => {
          socket.emit('ssh-output', data.toString('utf-8'));
        });
        
        stream.on('close', () => {
          console.log('SSH stream closed');
          socket.emit('ssh-status', { status: 'disconnected', message: 'Connection closed' });
          sshClient.end();
        });
        
        stream.stderr.on('data', (data) => {
          socket.emit('ssh-output', data.toString('utf-8'));
        });
      });
    });
    
    sshClient.on('error', (err) => {
      console.error('SSH connection error:', err.message);
      socket.emit('ssh-error', { message: err.message });
    });
    
    sshClient.on('close', () => {
      console.log('SSH connection closed');
      socket.emit('ssh-status', { status: 'disconnected', message: 'Connection closed' });
    });
    
    // Connect to SSH server
    const sshConfig = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
    };
    
    // Add authentication method
    if (config.password) {
      sshConfig.password = config.password;
    } else if (config.privateKey) {
      sshConfig.privateKey = config.privateKey;
    }
    
    try {
      sshClient.connect(sshConfig);
    } catch (err) {
      socket.emit('ssh-error', { message: err.message });
    }
  });
  
  // Handle input from client
  socket.on('ssh-input', (data) => {
    if (sshStream) {
      sshStream.write(data);
    }
  });
  
  // Handle resize
  socket.on('ssh-resize', (dimensions) => {
    if (sshStream) {
      sshStream.setWindow(dimensions.rows, dimensions.cols);
    }
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    if (sshStream) {
      sshStream.end();
    }
    if (sshClient) {
      sshClient.end();
    }
  });
  
  // Handle explicit disconnect request
  socket.on('ssh-disconnect', () => {
    console.log('SSH disconnect requested');
    if (sshStream) {
      sshStream.end();
    }
    if (sshClient) {
      sshClient.end();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
