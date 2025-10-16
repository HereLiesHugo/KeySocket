# KeySocket

Online SSH terminal hosted using Render. Connect to any SSH server through your browser with a beautiful, easy-to-use web interface.

## Site
### https://keysocket.onrender.com

## Features

- 🌐 Web-based SSH terminal
- 🔐 Secure SSH connections with password or private key authentication
- 💻 Full terminal emulation with xterm.js
- 📱 Responsive design that works on all devices
- 🚀 Easy deployment to Render
- ⚡ Real-time communication with Socket.IO

## Installation

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/HereLiesHugo/KeySocket.git
cd KeySocket
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Open your browser and navigate to `http://localhost:3000`

## Usage

1. Enter your SSH server details:
   - **Host/IP Address**: The hostname or IP address of your SSH server
   - **Port**: SSH port (default: 22)
   - **Username**: Your SSH username
   - **Authentication**: Choose between password or private key authentication

2. Click "Connect to Server" to establish the SSH connection

3. Use the terminal just like you would use any SSH client

4. Click "Disconnect" when you're done

## Deployment to Render

This application is configured for easy deployment to Render:

1. Fork or push this repository to your GitHub account

2. Go to [Render Dashboard](https://dashboard.render.com/)

3. Click "New +" and select "Web Service"

4. Connect your GitHub repository

5. Render will automatically detect the `render.yaml` configuration

6. Click "Create Web Service"

Your KeySocket instance will be live at your Render URL!

## Security Considerations

⚠️ **Important Security Notes:**

- This application is designed for personal use or trusted environments
- SSH credentials are not stored on the server
- All connections are established in real-time and closed when the browser disconnects
- For production use, consider adding:
  - HTTPS/TLS encryption
  - Authentication/authorization for the web interface
  - Rate limiting
  - Connection logging and monitoring

## Technologies Used

- **Backend**: Node.js, Express.js
- **SSH**: ssh2 library
- **Real-time Communication**: Socket.IO
- **Frontend Terminal**: xterm.js
- **Styling**: Custom CSS with responsive design

## License

This project is licensed under the GNU Affero General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

