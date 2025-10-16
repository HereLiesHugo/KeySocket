// Initialize Socket.IO connection
const socket = io();

// Initialize xterm with memory optimizations
const terminal = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  scrollback: 1000, // Limit scrollback to save memory
  convertEol: true,
  theme: {
    background: '#000000',
    foreground: '#ffffff',
    cursor: '#ffffff',
    cursorAccent: '#000000',
    selection: 'rgba(255, 255, 255, 0.3)'
  }
});

const fitAddon = new FitAddon.FitAddon();
terminal.loadAddon(fitAddon);

// DOM elements
const connectionForm = document.getElementById('connection-form');
const terminalContainer = document.getElementById('terminal-container');
const statusDiv = document.getElementById('status');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const authMethodRadios = document.querySelectorAll('input[name="auth-method"]');
const passwordField = document.getElementById('password-field');
const privatekeyField = document.getElementById('privatekey-field');

let isConnected = false;

// Toggle authentication method fields
authMethodRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    if (e.target.value === 'password') {
      passwordField.style.display = 'block';
      privatekeyField.style.display = 'none';
    } else {
      passwordField.style.display = 'none';
      privatekeyField.style.display = 'block';
    }
  });
});

// Handle form submission
connectionForm.addEventListener('submit', (e) => {
  e.preventDefault();
  
  if (isConnected) {
    return;
  }
  
  const host = document.getElementById('host').value.trim();
  const port = parseInt(document.getElementById('port').value) || 22;
  const username = document.getElementById('username').value.trim();
  const authMethod = document.querySelector('input[name="auth-method"]:checked').value;
  
  if (!host || !username) {
    showStatus('error', 'Please fill in all required fields');
    return;
  }
  
  const config = {
    host,
    port,
    username
  };
  
  if (authMethod === 'password') {
    const password = document.getElementById('password').value;
    if (!password) {
      showStatus('error', 'Please enter a password');
      return;
    }
    config.password = password;
  } else {
    const privateKey = document.getElementById('privatekey').value.trim();
    if (!privateKey) {
      showStatus('error', 'Please enter a private key');
      return;
    }
    config.privateKey = privateKey;
  }
  
  // Show connecting status
  showStatus('disconnected', 'Connecting to server...');
  connectBtn.disabled = true;
  
  // Initialize terminal
  if (!terminal.element) {
    terminal.open(terminalContainer);
    fitAddon.fit();
  }
  
  terminalContainer.classList.add('visible');
  
  // Connect to SSH
  socket.emit('ssh-connect', config);
});

// Handle disconnect button
disconnectBtn.addEventListener('click', () => {
  socket.emit('ssh-disconnect');
  disconnect();
});

// Socket event handlers
socket.on('ssh-status', (data) => {
  if (data.status === 'connected') {
    isConnected = true;
    showStatus('connected', data.message);
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    terminal.focus();
  } else if (data.status === 'disconnected') {
    disconnect();
  }
});

socket.on('ssh-error', (data) => {
  showStatus('error', `Error: ${data.message}`);
  disconnect();
});

socket.on('ssh-output', (data) => {
  // Memory optimization: limit data processing
  if (typeof data === 'string' && data.length < 10000) {
    terminal.write(data);
  }
});

// Terminal input handler with throttling
let inputThrottle = null;
terminal.onData((data) => {
  if (isConnected && data.length < 100) {
    // Basic throttling to prevent spam
    if (inputThrottle) clearTimeout(inputThrottle);
    inputThrottle = setTimeout(() => {
      socket.emit('ssh-input', data);
    }, 10);
  }
});

// Handle terminal resize
terminal.onResize(({ cols, rows }) => {
  if (isConnected) {
    socket.emit('ssh-resize', { cols, rows });
  }
});

// Fit terminal on window resize
window.addEventListener('resize', () => {
  if (terminal.element) {
    fitAddon.fit();
  }
});

// Helper function to show status
function showStatus(type, message) {
  statusDiv.className = `status ${type} visible`;
  statusDiv.innerHTML = `
    <span class="status-indicator"></span>
    <span>${message}</span>
  `;
}

// Helper function to disconnect
function disconnect() {
  isConnected = false;
  connectBtn.disabled = false;
  disconnectBtn.disabled = true;
  showStatus('disconnected', 'Disconnected from server');
}

// Handle page unload
window.addEventListener('beforeunload', () => {
  if (isConnected) {
    socket.emit('ssh-disconnect');
  }
});

console.log('KeySocket initialized');
