const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client } = require('ssh2');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Memory-optimized Socket.IO configuration
const io = new Server(server, {
  maxHttpBufferSize: 1e5, // 100KB limit (reduced from default 1MB)
  pingTimeout: 30000,
  pingInterval: 15000,
  transports: ['websocket'], // Use only websocket for better memory efficiency
  allowEIO3: false,
  cors: {
    origin: false // Disable CORS for better performance
  }
});

const PORT = process.env.PORT || 3000;

// Memory optimization constants for free Render instance (512MB RAM limit)
const MAX_CONCURRENT_CONNECTIONS = parseInt(process.env.MAX_CONNECTIONS) || 999999; // No limit
const MAX_OUTPUT_BUFFER_SIZE = 8192; // 8KB per connection
const CONNECTION_TIMEOUT = 180000; // 3 minutes idle timeout
const CLEANUP_INTERVAL = 30000; // Clean up every 30 seconds
const MAX_SSH_SESSIONS_PER_IP = 999999; // No limit per IP

// Global connection tracking
let activeConnections = 0;
const connectionsByIP = new Map();
const connectionMetrics = new Map();

// Memory-optimized static file serving with caching
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h', // Cache static files for 1 hour
  etag: false, // Disable etag generation to save memory
  lastModified: false
}));

// Memory monitoring and cleanup
function logMemoryUsage() {
  const usage = process.memoryUsage();
  const memMB = Math.round(usage.rss / 1024 / 1024);
  console.log(`Memory: ${memMB}MB | Connections: ${activeConnections}/${MAX_CONCURRENT_CONNECTIONS}`);
  
  // Force garbage collection if memory is high (approaching 450MB of 512MB limit)
  if (memMB > 450 && global.gc) {
    console.log('High memory usage - forcing garbage collection');
    global.gc();
  }
}

// Cleanup old connections and force disconnection of idle sessions
function performCleanup() {
  const now = Date.now();
  
  for (const [socketId, metrics] of connectionMetrics.entries()) {
    if (now - metrics.lastActivity > CONNECTION_TIMEOUT) {
      console.log(`Force disconnecting idle connection: ${socketId}`);
      if (metrics.socket && metrics.socket.connected) {
        metrics.socket.emit('ssh-error', { message: 'Session timeout due to inactivity' });
        metrics.socket.disconnect(true);
      }
    }
  }
}

// Start memory monitoring and cleanup
setInterval(logMemoryUsage, 60000); // Log every minute
setInterval(performCleanup, CLEANUP_INTERVAL);

// Rate limiting middleware (disabled - no limits)
app.use((req, res, next) => {
  // No rate limiting - allow unlimited connections
  next();
});

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
  const memUsage = process.memoryUsage();
  const memMB = Math.round(memUsage.rss / 1024 / 1024);
  
  res.json({
    status: 'healthy',
    memory: {
      used: `${memMB}MB`,
      limit: '512MB',
      percentage: Math.round((memMB / 512) * 100)
    },
    connections: {
      active: activeConnections,
      max: MAX_CONCURRENT_CONNECTIONS,
      percentage: Math.round((activeConnections / MAX_CONCURRENT_CONNECTIONS) * 100)
    },
    uptime: process.uptime()
  });
});

// Main route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper function to clean up connection resources
function cleanupConnectionResources(socketId, clientIP) {
  const metrics = connectionMetrics.get(socketId);
  if (metrics) {
    // Clean up SSH resources
    if (metrics.sshStream) {
      metrics.sshStream.removeAllListeners();
      metrics.sshStream.end();
    }
    if (metrics.sshClient) {
      metrics.sshClient.removeAllListeners();
      metrics.sshClient.end();
    }
    
    // Clear output buffer to free memory
    if (metrics.outputBuffer) {
      metrics.outputBuffer.length = 0;
    }
    
    connectionMetrics.delete(socketId);
  }
  
  // Update connection counts
  activeConnections = Math.max(0, activeConnections - 1);
  if (clientIP) {
    const count = connectionsByIP.get(clientIP) || 0;
    if (count <= 1) {
      connectionsByIP.delete(clientIP);
    } else {
      connectionsByIP.set(clientIP, count - 1);
    }
  }
}

// Handle Socket.IO connections (no limits)
io.on('connection', (socket) => {
  const clientIP = socket.handshake.address || 'unknown';
  
  // No connection limits - accept all connections
  
  // Initialize connection tracking
  activeConnections++;
  connectionsByIP.set(clientIP, ipConnections + 1);
  
  const connectionMetric = {
    socket: socket,
    clientIP: clientIP,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    sshClient: null,
    sshStream: null,
    outputBuffer: [],
    outputSize: 0,
    isConnected: false
  };
  
  connectionMetrics.set(socket.id, connectionMetric);
  
  console.log(`Client connected: ${socket.id} (${activeConnections}/${MAX_CONCURRENT_CONNECTIONS})`);
  
  let sshClient = null;
  let sshStream = null;

  // Handle SSH connection request with validation
  socket.on('ssh-connect', (config) => {
    const metrics = connectionMetrics.get(socket.id);
    if (!metrics) return;
    
    // Prevent multiple SSH connections per socket
    if (metrics.isConnected || sshClient) {
      socket.emit('ssh-error', { message: 'Already connected to SSH server' });
      return;
    }
    
    // Validate config to prevent crashes
    if (!config || !config.host || !config.username) {
      socket.emit('ssh-error', { message: 'Invalid connection configuration' });
      return;
    }
    
    console.log(`SSH connection requested: ${config.host} (${socket.id})`);
    metrics.lastActivity = Date.now();
    
    sshClient = new Client();
    metrics.sshClient = sshClient;
    
    sshClient.on('ready', () => {
      const metrics = connectionMetrics.get(socket.id);
      if (!metrics) return;
      
      console.log(`SSH connection established: ${socket.id}`);
      metrics.isConnected = true;
      metrics.lastActivity = Date.now();
      
      socket.emit('ssh-status', { status: 'connected', message: 'Connected to server' });
      
      sshClient.shell({ 
        term: 'xterm-color',
        cols: 80,
        rows: 24
      }, (err, stream) => {
        if (err) {
          socket.emit('ssh-error', { message: err.message });
          cleanupConnectionResources(socket.id, metrics.clientIP);
          return;
        }
        
        sshStream = stream;
        metrics.sshStream = stream;
        
        // Memory-optimized data handling
        stream.on('data', (data) => {
          const metrics = connectionMetrics.get(socket.id);
          if (!metrics) return;
          
          metrics.lastActivity = Date.now();
          const output = data.toString('utf-8');
          
          // Implement circular buffer to prevent memory leaks
          metrics.outputSize += output.length;
          if (metrics.outputSize > MAX_OUTPUT_BUFFER_SIZE) {
            // Clear buffer when it exceeds limit
            metrics.outputBuffer = [];
            metrics.outputSize = output.length;
          }
          
          metrics.outputBuffer.push(output);
          
          // Only send if socket is still connected
          if (socket.connected) {
            socket.emit('ssh-output', output);
          }
        });
        
        stream.on('close', () => {
          console.log(`SSH stream closed: ${socket.id}`);
          if (socket.connected) {
            socket.emit('ssh-status', { status: 'disconnected', message: 'Connection closed' });
          }
          cleanupConnectionResources(socket.id, metrics?.clientIP);
        });
        
        stream.stderr.on('data', (data) => {
          const metrics = connectionMetrics.get(socket.id);
          if (!metrics) return;
          
          metrics.lastActivity = Date.now();
          const output = data.toString('utf-8');
          
          // Same memory management for stderr
          metrics.outputSize += output.length;
          if (metrics.outputSize > MAX_OUTPUT_BUFFER_SIZE) {
            metrics.outputBuffer = [];
            metrics.outputSize = output.length;
          }
          
          metrics.outputBuffer.push(output);
          
          if (socket.connected) {
            socket.emit('ssh-output', output);
          }
        });
        
        // Set timeout for SSH stream
        stream.setTimeout(CONNECTION_TIMEOUT);
        stream.on('timeout', () => {
          console.log(`SSH stream timeout: ${socket.id}`);
          stream.end();
        });
      });
    });
    
    sshClient.on('error', (err) => {
      console.error(`SSH connection error (${socket.id}):`, err.message);
      const metrics = connectionMetrics.get(socket.id);
      if (socket.connected) {
        socket.emit('ssh-error', { message: err.message });
      }
      cleanupConnectionResources(socket.id, metrics?.clientIP);
    });
    
    sshClient.on('close', () => {
      console.log(`SSH connection closed: ${socket.id}`);
      const metrics = connectionMetrics.get(socket.id);
      if (socket.connected) {
        socket.emit('ssh-status', { status: 'disconnected', message: 'Connection closed' });
      }
      cleanupConnectionResources(socket.id, metrics?.clientIP);
    });
    
    // Add connection timeout
    sshClient.setTimeout(CONNECTION_TIMEOUT);
    sshClient.on('timeout', () => {
      console.log(`SSH client timeout: ${socket.id}`);
      sshClient.end();
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
  
  // Handle input from client with rate limiting
  socket.on('ssh-input', (data) => {
    const metrics = connectionMetrics.get(socket.id);
    if (!metrics) return;
    
    metrics.lastActivity = Date.now();
    
    // Basic input validation and rate limiting
    if (typeof data === 'string' && data.length < 1000 && sshStream) {
      sshStream.write(data);
    }
  });
  
  // Handle resize with validation
  socket.on('ssh-resize', (dimensions) => {
    const metrics = connectionMetrics.get(socket.id);
    if (!metrics || !sshStream) return;
    
    metrics.lastActivity = Date.now();
    
    // Validate dimensions to prevent crashes
    if (dimensions && 
        typeof dimensions.rows === 'number' && 
        typeof dimensions.cols === 'number' &&
        dimensions.rows > 0 && dimensions.rows < 1000 &&
        dimensions.cols > 0 && dimensions.cols < 1000) {
      sshStream.setWindow(dimensions.rows, dimensions.cols);
    }
  });
  
  // Handle disconnect with proper cleanup
  socket.on('disconnect', (reason) => {
    console.log(`Client disconnected: ${socket.id} (${reason})`);
    const metrics = connectionMetrics.get(socket.id);
    cleanupConnectionResources(socket.id, metrics?.clientIP);
  });
  
  // Handle explicit disconnect request
  socket.on('ssh-disconnect', () => {
    console.log(`SSH disconnect requested: ${socket.id}`);
    const metrics = connectionMetrics.get(socket.id);
    cleanupConnectionResources(socket.id, metrics?.clientIP);
  });
  
  // Handle connection errors
  socket.on('error', (error) => {
    console.error(`Socket error (${socket.id}):`, error.message);
    const metrics = connectionMetrics.get(socket.id);
    cleanupConnectionResources(socket.id, metrics?.clientIP);
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, performing graceful shutdown...');
  
  // Close all active SSH connections
  for (const [socketId, metrics] of connectionMetrics.entries()) {
    cleanupConnectionResources(socketId, metrics.clientIP);
  }
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, performing graceful shutdown...');
  
  // Close all active SSH connections
  for (const [socketId, metrics] of connectionMetrics.entries()) {
    cleanupConnectionResources(socketId, metrics.clientIP);
  }
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  // Don't exit immediately, try to continue serving other connections
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  // Don't exit immediately, try to continue serving other connections
});

server.listen(PORT, () => {
  console.log(`KeySocket SSH Terminal Server`);
  console.log(`Port: ${PORT}`);
  console.log(`Max Connections: UNLIMITED`);
  console.log(`Heap Size: 480MB (512MB instance)`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
