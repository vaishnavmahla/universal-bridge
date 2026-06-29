# ⚡ VibeShare

> **Zero-friction, completely ephemeral P2P matrix for instant cross-device data streaming.**

Moving text, code snippets, or large files between a PC and a mobile device is often painfully clunky, requiring users to email themselves, leave data traces on cloud drives, or rely on ecosystem-locked tools like Apple AirDrop. 

**VibeShare shatters the ecosystem barrier.** It provides a universal, zero-login, browser-native bridge. By leveraging native WebRTC Data Channels, it streams files and clipboard data directly hardware-to-hardware over the local network or public internet.

---

## 🚀 Core Product Capabilities

* **Zero Cloud Storage (WebRTC):** Binary payloads and files stream directly between local hardware nodes. Files are processed entirely in memory and never touch a database or third-party storage bucket.
* **Instant Clipboard Sync:** Copy a snippet on your mobile device and instantly inject it into your PC's clipboard cache. Features a custom mobile-native "Inject Field" to bypass strict browser clipboard sandboxing.
* **Ephemeral Workspaces:** All data arrays and canvas strings mirror across connected tabs in real-time. Once the room is cleared or all users disconnect, the session ceases to exist.
* **Master Passcode Gateway:** P2P room discovery is guarded by a manual security key. Unverified nodes cannot intercept the socket matrix or view the data pipeline.
* **Instant QR Interconnect:** Scan the uniquely generated target matrix signature with a smartphone camera to instantly anchor into the namespace.

---

## 🧠 System Architecture & Security

VibeShare operates on a hybrid topology combining a lightweight signaling server with heavy peer-to-peer data channels.

1. **The Signaling Bridge (Socket.io):** A Node.js backend acts purely as a routing operator. It connects peers, handles room password validation, and manages the initial ICE Candidate and SDP offer/answer handshakes. **It does not read or store the actual file data.**
2. **The P2P Matrix (WebRTC):** Once the handshake is complete, a direct secure context tunnel is opened between the client browsers. Data chunks stream through Google STUN server routes to bypass NATs and firewalls.
3. **Secure Contexts (HTTPS):** Deployed over forced SSL, the application natively unlocks browser Web Crypto APIs to ensure a safe, encrypted data pipe.

---

## 🛠️ The Technology Stack

**Frontend (Client Matrix):**
* React.js + Vite (Build Engine)
* Tailwind CSS (Glassmorphic / Cyberpunk UI Configuration)
* Lucide-React (Vector Iconography)
* QRCode.react (Dynamic Signature Generation)

**Backend (Signaling Operator):**
* Node.js
* Express.js
* Socket.io (Real-time bi-directional event routing)

**Infrastructure:**
* Vercel (Frontend Global CDN)
* Render (Backend Node Environment)
* Google Public STUN Servers

---

## 💻 Local Development Setup

To run VibeShare locally on your own machine for development or testing:

### 1. Boot the Signaling Backend
```bash
# Navigate to the backend directory
cd backend

# Install Node dependencies
npm install

# Open a new terminal tab and navigate to the frontend directory
cd frontend

# Install Node dependencies
npm install

# IMPORTANT: Ensure your socket connection in App.jsx points to your local backend during development
# Example: const socket = io('http://localhost:5000');

# Launch the Vite development server
npm run dev -- --host

Note: The --host flag exposes the frontend to your local Wi-Fi network, allowing you to connect a mobile device for local P2P testing.

🌐 Production Deployment
VibeShare is designed for rapid cloud deployment.

Backend: Deployed as a Node Web Service on Render. Cors configuration must be set to origin: "*" to accept incoming signaling requests.

Frontend: Deployed via Vercel. Ensure the io() socket connection targets the live Render URL before initiating the build process.

# Start the Express/Socket server (defaults to port 5000)
npm start
