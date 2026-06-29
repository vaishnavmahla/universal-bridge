import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import { Shield, Clipboard, FileText, UploadCloud, Copy, RefreshCw, Zap, QrCode, X, Lock } from 'lucide-react';

// Connect to the Node backend port
// const socket = io('http://localhost:5000');

// const socket = io('http://192.192.192.192:5000');
const socket = io('https://vibeshare-backend-efbg.onrender.com');


const CHUNK_SIZE = 16384; // 16KB optimization chunks for stable WebRTC throughput

// Generates a deterministic AES-GCM secret key using the Room ID text
async function getEncryptionKey(roomId) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(roomId.padEnd(16, "0").substring(0, 16)), // Ensure valid length matrix alignment
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("vibe-salt-matrix-99"),
      iterations: 1000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptText(text, roomId) {
  // Completely strip out encryption - send raw text over the network instantly
  return text;
}

async function decryptText(encryptedJson, roomId) {
  // Completely strip out decryption - return the text exactly as it arrives
  return encryptedJson;
}



// // Encrypts cleartext strings into secure string arrays
// async function encryptText(text, roomId) {
//   try {
//     // Safety check: If the browser doesn't support subtle crypto, send as plain text
//     if (!window.crypto || !window.crypto.subtle) {
//       console.warn("Web Crypto not supported/blocked in this browser context. Using plain transport.");
//       return text;
//     }

//     const key = await getEncryptionKey(roomId);
//     const enc = new TextEncoder();
//     const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
//     const encrypted = await window.crypto.subtle.encrypt(
//       { name: "AES-GCM", iv: iv },
//       key,
//       enc.encode(text)
//     );
    
//     return JSON.stringify({
//       cipher: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
//       iv: btoa(String.fromCharCode(...iv))
//     });
//   } catch (e) {
//     console.error("Encryption failed, falling back to plaintext:", e);
//     return text;
//   }
// }

// // Decrypts incoming cipher strings back into standard text layout arrays
// // Upgraded Decrypt Text method with structural fallback loops
// async function decryptText(encryptedJson, roomId) {
//   try {
//     // 1. If it's not a JSON string containing our cipher signature, treat it as raw plain text
//     if (!encryptedJson || !encryptedJson.startsWith('{"cipher"')) {
//       return encryptedJson;
//     }

//     // 2. If the browser blocks Web Crypto API, handle the fallback gracefully
//     if (!window.crypto || !window.crypto.subtle) {
//       return "[Secure E2EE Packet - Open on Secure Host]";
//     }

//     const { cipher, iv } = JSON.parse(encryptedJson);
//     const key = await getEncryptionKey(roomId);
//     const dec = new TextDecoder();
    
//     const ivBuffer = new Uint8Array(atob(iv).split("").map(c => c.charCodeAt(0)));
//     const cipherBuffer = new Uint8Array(atob(cipher).split("").map(c => c.charCodeAt(0)));
    
//     const decrypted = await window.crypto.subtle.decrypt(
//       { name: "AES-GCM", iv: ivBuffer },
//       key,
//       cipherBuffer
//     );
//     return dec.decode(decrypted);
//   } catch (e) {
//     // 3. Absolute safety fallback: if parsing or decryption breaks, return the raw input string
//     console.warn("Decryption structural bypass:", e);
//     return encryptedJson;
//   }
// }

// Synthesizes a premium, clean UI chime tone natively using browser hardware audio nodes
const playSyncChime = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    osc.type = 'sine';
    // Elegant dual-tone leap frequency
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5 Note
    osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.08); // A5 Note
    
    gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    console.log("Audio pipeline muted until user context interaction triggers.");
  }
};

function App() {
  // Generate a clean random room code if not provided in the URL hash, forcing uniform spacing
  const [roomId, setRoomId] = useState(() => {
    const hash = window.location.hash.replace('#', '').trim();
    const cleanHash = decodeURIComponent(hash).replace(/\s+/g, '-').toUpperCase();
    return cleanHash || `ROOM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  });

  const [roomPassword, setRoomPassword] = useState(() => {
    // Check if a password was already created for this session
    return localStorage.getItem(`pass_${roomId}`) || '';
  });
  const [passwordInput, setPasswordInput] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(() => {
    // If the room creator already set it, keep it unlocked locally
    return localStorage.getItem(`pass_${roomId}`) ? true : false;
  });

  const [note, setNote] = useState("");
  const [clipboardItems, setClipboardItems] = useState([]);
  const [transferSpeed, setTransferSpeed] = useState("0 MB/s");
  const [progress, setProgress] = useState(0);
  const [showQR, setShowQR] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // WebRTC & Transfer Refs
  const peerConnection = useRef(null);
  const dataChannel = useRef(null);
  const incomingBuffer = useRef([]);
  const incomingFileSize = useRef(0);
  const incomingFileName = useRef('');
  const fileInputRef = useRef(null);

  // 1. INITIALIZE ROOM AND SOCKET SIGNALING PIPELINES
  useEffect(() => {
    window.location.hash = roomId;
    
    // Announce presence to room immediately on load/change
    socket.emit('join-room', roomId);

    socket.on('init-note', async (initialText) => {
      if (initialText) {
        const decrypted = await decryptText(initialText, roomId);
        setNote(decrypted);
      }
    });

    socket.on('note-updated', async (text) => {
      const decrypted = await decryptText(text, roomId);
      setNote(decrypted);
    });

    socket.on('room-data-cleared', () => {
      setNote('');
      setClipboardItems([]);
    });

    socket.on('clipboard-received', async (item) => {
      const decryptedContent = await decryptText(item.content, roomId);
      setClipboardItems((prev) => [{ ...item, content: decryptedContent }, ...prev]);
      playSyncChime();
    });

    // Handle incoming WebRTC signaling data
    socket.on('peer-ready', async (peerId) => {
      initiateWebRTC(peerId, true);
    });

    socket.on('webrtc-offer', async ({ senderId, offer }) => {
      if (!peerConnection.current) initiateWebRTC(senderId, false);
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answer);
      socket.emit('webrtc-answer', { targetId: senderId, answer });
    });

    socket.on('webrtc-answer', async ({ answer }) => {
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('webrtc-ice-candidate', async ({ candidate }) => {
      if (peerConnection.current) {
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socket.on('room-password-required', (serverPassword) => {
      setRoomPassword(serverPassword);
      setIsUnlocked(false);
    });

    // Ask the server if this room already has a password set when joining
    socket.emit('check-room-password', { roomId });
    
    socket.on('password-check-response', (serverPassword) => {
      if (serverPassword) {
        setRoomPassword(serverPassword);
      }
    });

    return () => {
      socket.off('init-note');
      socket.off('note-updated');
      socket.off('clipboard-received');
      socket.off('peer-ready');
      socket.off('webrtc-offer');
      socket.off('webrtc-answer');
      socket.off('webrtc-ice-candidate');
    };
  }, [roomId]);

  // 2. WEBRTC ENGINE INITIALIZATION
  const initiateWebRTC = async (targetId, isInitiator) => {
    peerConnection.current = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', { targetId, candidate: event.candidate });
      }
    };

    if (isInitiator) {
      dataChannel.current = peerConnection.current.createDataChannel('fileTransfer');
      setupDataChannelHandlers(dataChannel.current);

      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);
      socket.emit('webrtc-offer', { targetId, offer });
    } else {
      peerConnection.current.ondatachannel = (event) => {
        dataChannel.current = event.channel;
        setupDataChannelHandlers(dataChannel.current);
      };
    }
  };

  const setupDataChannelHandlers = (channel) => {
    channel.binaryType = 'arraybuffer';
    
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        // Metadata incoming header block
        const metadata = JSON.parse(event.data);
        incomingFileName.current = metadata.name;
        incomingFileSize.current = metadata.size;
        incomingBuffer.current = [];
        setProgress(0);
        setTransferSpeed("Streaming...");
      } else {
        // Binary chunk data channel incoming stream loop
        incomingBuffer.current.push(event.data);
        const receivedSize = incomingBuffer.current.reduce((acc, chunk) => acc + chunk.byteLength, 0);
        const percentage = Math.round((receivedSize / incomingFileSize.current) * 100);
        setProgress(percentage);

        if (receivedSize >= incomingFileSize.current) {
          // File assemble block complete
          const blob = new Blob(incomingBuffer.current);
          const url = URL.createObjectURL(blob);
          
          // Inject download asset directly into client browser
          const a = document.createElement('a');
          a.href = url;
          a.download = incomingFileName.current;
          a.click();
          
          setProgress(100);
          setTransferSpeed("Finished!");
          playSyncChime();
        }
      }
    };
  };

  // 3. SECURE E2EE HIGH-SPEED FILE DISPATCH PIPELINE
  const sendFile = async (file) => {
    if (!dataChannel.current || dataChannel.current.readyState !== 'open') {
      alert("No hardware peers connected to this matrix node yet. Open this link on another device first!");
      return;
    }

    // Send metadata tracking wrapper text first
    dataChannel.current.send(JSON.stringify({ name: file.name, size: file.size }));

    const reader = new FileReader();
    let offset = 0;
    const startTime = performance.now();

    reader.onload = (e) => {
      const buffer = e.target.result;
      dataChannel.current.send(buffer);
      offset += buffer.byteLength;

      const percentage = Math.round((offset / file.size) * 100);
      setProgress(percentage);

      // Realtime Speed calculation logic
      const elapsedSeconds = (performance.now() - startTime) / 1000;
      const mbps = ((offset / (1024 * 1024)) / (elapsedSeconds || 1)).toFixed(1);
      setTransferSpeed(`${mbps} MB/s`);

      if (offset < file.size) {
        readNextChunk();
      } else {
        setTransferSpeed("Dispatched!");
      }
    };

    const readNextChunk = () => {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    readNextChunk();
  };

  const handleNoteChange = async (e) => {
    const val = e.target.value;
    setNote(val);
    const encrypted = await encryptText(val, roomId);
    socket.emit('update-note', { roomId, text: encrypted });
  };

  const handleSetPassword = (e) => {
    e.preventDefault();
    if (passwordInput.trim()) {
      setRoomPassword(passwordInput);
      setIsUnlocked(true);
      localStorage.setItem(`pass_${roomId}`, passwordInput);
      // Tell the backend to force the password requirement on other joining devices
      socket.emit('set-room-password', { roomId, password: passwordInput });
    }
  };

  const handleVerifyPassword = (e) => {
    e.preventDefault();
    if (passwordInput === roomPassword) {
      setIsUnlocked(true);
    } else {
      alert("❌ Incorrect Room Access Passcode!");
      setPasswordInput('');
    }
  };

  const handleClearMatrix = () => {
    // Wipe local application state immediately
    setNote('');
    setClipboardItems([]);
    
    // Broadcast the wipe command to all paired network nodes
    socket.emit('clear-room-data', { roomId });
  };

  // Drag and Drop State Handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files && files[0]) {
      sendFile(files[0]);
    }
  };

  const handleMobilePaste = async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        alert("📋 Clipboard access blocked. Please allow clipboard permissions in your browser settings.");
        return;
      }
      
      const text = await navigator.clipboard.readText();
      if (text) {
        // Run the exact same payload logic your global key listener uses
        const localPayload = { type: 'text', content: text, timestamp: new Date().toLocaleTimeString() };
        setClipboardItems((prev) => [localPayload, ...prev]);
        socket.emit('share-clipboard', { roomId, data: localPayload });
      }
    } catch (err) {
      console.error("Failed to read system clipboard: ", err);
      alert("📋 Click inside the app first, then tap Paste to grant browser clipboard access.");
    }
  };

  // Global browser canvas context paste hooks (Ctrl+V)
  // Global browser clipboard context paste handler with Image Support
  useEffect(() => {
    const handlePaste = async (e) => {
      // 1. Check for Image files in the clipboard
      const items = e.clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          const reader = new FileReader();
          
          reader.onload = async (event) => {
            const base64Image = event.target.result;
            const encrypted = await encryptText(base64Image, roomId);
            const localPayload = { type: 'image', content: base64Image, timestamp: new Date().toLocaleTimeString() };
            const networkPayload = { type: 'image', content: encrypted, timestamp: localPayload.timestamp };
            
            setClipboardItems((prev) => [localPayload, ...prev]);
            socket.emit('share-clipboard', { roomId, data: networkPayload });
          };
          
          reader.readAsDataURL(file);
          return; // Stop execution if image is processed
        }
      }

      // 2. Fallback to standard Text pasting if no image is found
      const text = e.clipboardData.getData('text');
      if (text) {
        const encrypted = await encryptText(text, roomId);
        const localPayload = { type: 'text', content: text, timestamp: new Date().toLocaleTimeString() };
        const networkPayload = { type: 'text', content: encrypted, timestamp: localPayload.timestamp };
        
        setClipboardItems((prev) => [localPayload, ...prev]);
        socket.emit('share-clipboard', { roomId, data: networkPayload });
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [roomId]);

  return (
    <div className="min-h-screen bg-[#030305] text-[#e4e4e7] antialiased selection:bg-[#f43f5e]/30 selection:text-white font-mono relative overflow-x-hidden flex flex-col">
      
      {/* CINEMATIC AMBIENT LIGHTING (PULSING) */}
      <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] bg-[#f43f5e]/5 blur-[120px] rounded-full pointer-events-none animate-pulse" style={{ animationDuration: '8s' }}></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[60vw] h-[60vw] bg-[#60a5fa]/5 blur-[120px] rounded-full pointer-events-none animate-pulse" style={{ animationDuration: '10s' }}></div>

      {/* GLASSMORPHIC HEADER */}
      <header className="border-b border-white/5 bg-[#030305]/60 backdrop-blur-xl sticky top-0 z-50 px-6 py-4 flex items-center justify-between transition-all duration-300 shadow-[0_4px_30px_rgba(0,0,0,0.1)]">
        <div className="flex items-center gap-4">
          <div className="relative flex items-center justify-center group cursor-pointer">
            <div className="absolute inset-0 bg-gradient-to-r from-[#f43f5e] to-[#e11d48] blur-lg opacity-40 group-hover:opacity-80 transition-opacity duration-500 rounded-lg"></div>
            <div className="relative border border-white/10 bg-[#0a0a0f] px-3 py-1.5 rounded-lg text-xs font-black tracking-tighter text-white shadow-lg flex items-center gap-2 transition-transform duration-300 group-hover:scale-105">
              <Zap size={14} className="text-[#f43f5e]" /> VB.SR
            </div>
          </div>
          <div>
            <h1 className="text-sm font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60 uppercase">
              VIBESHARE
            </h1>
            <p className="text-[10px] text-[#71717a] uppercase tracking-widest flex items-center gap-1.5 mt-0.5 font-bold">
              <span className="h-1.5 w-1.5 rounded-full bg-[#10b981] shadow-[0_0_8px_#10b981] animate-pulse"></span> SECURE MATRIX ACTIVE
            </p>
          </div>
        </div>

        {/* HEADER CONTROLS (SMOOTH HOVERS) */}
        <div className="flex items-center gap-3">
          <button 
            onClick={handleClearMatrix}
            title="PURGE SESSION DATA"
            className="p-2.5 rounded-xl border border-white/5 bg-white/5 text-[#a1a1aa] hover:text-[#f43f5e] hover:bg-[#f43f5e]/10 hover:border-[#f43f5e]/30 hover:shadow-[0_0_20px_rgba(244,63,94,0.15)] transition-all duration-300 cursor-pointer active:scale-90 group"
          >
            <RefreshCw size={14} strokeWidth={2.5} className="group-hover:rotate-180 transition-transform duration-500" />
          </button>

          <button 
            onClick={() => setShowQR(true)} 
            className="p-2.5 rounded-xl border border-white/5 bg-white/5 text-[#a1a1aa] hover:text-[#60a5fa] hover:bg-[#60a5fa]/10 hover:border-[#60a5fa]/30 hover:shadow-[0_0_20px_rgba(96,165,250,0.15)] transition-all duration-300 cursor-pointer active:scale-90"
            title="SCAN QR CONFIG"
          >
            <QrCode size={14} strokeWidth={2.5} />
          </button>
          
          <div className="flex items-center gap-3 border border-white/5 bg-white/5 px-4 py-2 rounded-xl shadow-inner transition-all duration-300 hover:bg-white/10">
            <span className="text-[10px] text-[#71717a] font-black tracking-widest hidden sm:inline uppercase">ROOM</span>
            <span className="font-mono font-black text-[#60a5fa] tracking-wider text-xs drop-shadow-[0_0_8px_rgba(96,165,250,0.3)]">{roomId}</span>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                alert("Pairing link intercepted & copied!");
              }} 
              className="text-[#71717a] hover:text-white transition-colors cursor-pointer active:scale-90"
            >
              <Copy size={12} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </header>

      {/* SMOOTH FADE-IN PASSWORD GATE */}
      {!isUnlocked ? (
        <div className="flex-1 flex items-center justify-center p-6 z-10 transition-opacity duration-700 ease-in-out opacity-100">
          <div className="w-full max-w-sm p-8 border border-white/10 bg-[#0a0a0f]/80 backdrop-blur-xl relative rounded-3xl shadow-[0_20px_80px_rgba(0,0,0,0.8)] transform transition-all hover:border-white/20 hover:shadow-[0_20px_80px_rgba(244,63,94,0.1)]">
            <div className="absolute -top-12 left-1/2 -translate-x-1/2">
              <div className="h-24 w-24 bg-[#f43f5e]/20 rounded-full blur-2xl absolute"></div>
              <div className="h-16 w-16 bg-[#0a0a0f] border border-white/10 rounded-2xl flex items-center justify-center shadow-2xl relative z-10">
                <Lock size={24} className="text-[#f43f5e]" />
              </div>
            </div>
            
            <div className="text-center space-y-5 mt-6">
              <h2 className="text-sm font-black tracking-widest text-white uppercase">
                {roomPassword ? "LOCKED TERMINAL" : "SECURE NEW SESSION"}
              </h2>
              <p className="text-[10px] text-[#71717a] uppercase tracking-wider leading-relaxed font-bold">
                {roomPassword 
                  ? "A passcode is required to decrypt this pipeline."
                  : "Establish a master passcode to lock this room."}
              </p>

              <form onSubmit={roomPassword ? handleVerifyPassword : handleSetPassword} className="space-y-4">
                <input 
                  type="password"
                  placeholder={roomPassword ? "ENTER PASSCODE..." : "CREATE PASSCODE..."}
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="w-full px-5 py-4 bg-black/50 border border-white/10 rounded-2xl font-mono text-xs text-center text-white placeholder-[#3f3f46] focus:outline-none focus:border-[#f43f5e] focus:ring-1 focus:ring-[#f43f5e]/50 uppercase tracking-widest transition-all duration-300 shadow-inner"
                />
                <button 
                  type="submit"
                  className="w-full py-4 bg-gradient-to-r from-[#f43f5e] to-[#be123c] text-white text-xs font-black uppercase tracking-widest rounded-2xl hover:brightness-110 shadow-[0_0_20px_rgba(244,63,94,0.3)] active:scale-[0.98] transition-all duration-300 cursor-pointer"
                >
                  {roomPassword ? "UNLOCK WORKSPACE" : "INITIALIZE GATEWAY"}
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : (
        /* PERFECTLY ALIGNED GRID WORKSPACE */
        <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch z-10 transition-opacity duration-700 ease-in-out">
          
          {/* LEFT COLUMN: FILE DROP & TELEMETRY */}
          <section className="flex flex-col gap-6 h-full">
            <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => e.target.files[0] && sendFile(e.target.files[0])} />
            
            {/* FILE DROP ZONE (FLEX-1 ALLOWS IT TO GROW TO MATCH TEXTAREA) */}
            <div 
              onClick={() => fileInputRef.current.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`flex-1 min-h-[300px] border-2 border-dashed rounded-3xl p-8 flex flex-col items-center justify-center text-center transition-all duration-500 cursor-pointer relative overflow-hidden group ${
                isDragging 
                  ? 'border-[#f43f5e] bg-[#f43f5e]/5 scale-[0.98] shadow-[inset_0_0_50px_rgba(244,63,94,0.1)]' 
                  : 'bg-[#0a0a0f]/60 backdrop-blur-sm border-white/10 hover:border-white/30 hover:bg-[#0a0a0f]/80 hover:-translate-y-1 hover:shadow-xl'
              }`}
            >
              <div className="absolute top-5 left-5 flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-[#f43f5e] group-hover:shadow-[0_0_10px_#f43f5e] transition-shadow"></div>
                <span className="text-[10px] font-black tracking-widest text-[#71717a] uppercase">P2P_FILE_STREAM</span>
              </div>

              <div className={`p-5 rounded-2xl transition-all duration-500 mb-6 ${isDragging ? 'bg-[#f43f5e]/20 text-[#f43f5e] scale-110' : 'bg-white/5 text-[#52525b] group-hover:text-white group-hover:bg-white/10'}`}>
                <UploadCloud size={40} strokeWidth={1.5} />
              </div>
              
              <h3 className="text-sm font-black uppercase tracking-widest text-white mb-2 transition-colors">
                {isDragging ? "RELEASE TO TRANSMIT" : "DRAG & DROP SECURE FILES"}
              </h3>
              <p className="text-[11px] text-[#71717a] max-w-sm uppercase tracking-wider leading-relaxed font-medium">
                Bypass cloud infrastructure entirely. Transfer binary payloads directly between local network nodes.
              </p>
              
              <span className="mt-8 px-6 py-2.5 border border-white/10 bg-white/5 text-[10px] font-black uppercase tracking-widest text-[#a1a1aa] rounded-xl group-hover:bg-white group-hover:text-black group-hover:border-white transition-all duration-300 shadow-lg">
                BROWSE LOCAL DISK
              </span>
            </div>

            {/* TELEMETRY BAR (FIXED HEIGHT) */}
            <div className="bg-[#0a0a0f]/80 backdrop-blur-sm border border-white/10 p-5 rounded-3xl shadow-lg hover:border-white/20 transition-all duration-300 hover:-translate-y-1">
              <div className="flex items-center gap-2 border-b border-white/5 pb-3 mb-4">
                <Zap size={12} className="text-[#60a5fa]" />
                <h2 className="text-[10px] font-black tracking-widest uppercase text-[#a1a1aa]">NETWORK TELEMETRY</h2>
              </div>
              
              <div className="flex justify-between items-center mb-3">
                <span className="text-[10px] font-bold text-[#71717a] tracking-widest uppercase">BANDWIDTH VELOCITY</span>
                <span className="text-[10px] font-mono font-black bg-[#60a5fa]/10 text-[#60a5fa] px-2.5 py-1 rounded-lg border border-[#60a5fa]/20">
                  {transferSpeed || "IDLE"}
                </span>
              </div>
              
              <div className="w-full bg-black/50 h-2.5 rounded-full border border-white/5 p-[1.5px] overflow-hidden shadow-inner">
                <div 
                  className="bg-gradient-to-r from-[#60a5fa] to-[#818cf8] h-full rounded-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(96,165,250,0.5)]"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
          </section>

          {/* RIGHT COLUMN: TEXTAREA & CLIPBOARD */}
          <section className="flex flex-col gap-6 h-full">
            
            {/* NOTES MATRIX (FLEX-1 ALLOWS IT TO GROW) */}
            <div className="flex-1 bg-[#0a0a0f]/80 backdrop-blur-sm border border-white/10 p-5 flex flex-col rounded-3xl shadow-lg hover:border-white/20 transition-all duration-300 hover:-translate-y-1 min-h-[220px] group">
              <div className="flex items-center gap-2 border-b border-white/5 pb-3 mb-4">
                <FileText size={12} className="text-white group-hover:text-[#60a5fa] transition-colors" />
                <h2 className="text-[10px] font-black tracking-widest uppercase text-[#a1a1aa] group-hover:text-white transition-colors">LIVE CANVAS SYNC</h2>
              </div>
              
              <textarea
                className="w-full flex-1 bg-black/40 border border-white/5 rounded-2xl p-5 text-sm focus:outline-none focus:border-[#60a5fa]/50 focus:bg-black/60 focus:shadow-[inset_0_0_20px_rgba(96,165,250,0.05)] text-white resize-none placeholder-[#3f3f46] font-mono leading-relaxed transition-all duration-300 shadow-inner"
                placeholder="// Initialize text sync here... Memory blocks will mirror across all connected tabs in real-time."
                value={note}
                onChange={handleNoteChange}
              />
            </div>

            {/* CLIPBOARD LOG (STRICT HEIGHT SO IT DOESN'T BREAK ALIGNMENT) */}
            <div className="h-[280px] bg-[#0a0a0f]/80 backdrop-blur-sm border border-white/10 p-5 flex flex-col rounded-3xl shadow-lg hover:border-white/20 transition-all duration-300 hover:-translate-y-1 group">
              <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <Clipboard size={12} className="text-white group-hover:text-[#a78bfa] transition-colors" />
                  <h2 className="text-[10px] font-black tracking-widest uppercase text-[#a1a1aa] group-hover:text-white transition-colors">CLIPBOARD CACHE</h2>
                </div>
                <button
                  onClick={handleMobilePaste}
                  className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest bg-white/5 border border-white/10 text-[#a78bfa] rounded-xl hover:bg-[#a78bfa]/20 hover:border-[#a78bfa]/50 shadow-sm transition-all duration-300 active:scale-90 cursor-pointer"
                >
                  PASTE SNIPPET
                </button>
              </div>

              {/* OVERFLOW CONTAINER TO PROTECT GRID LAYOUT */}
              <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                {clipboardItems.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center border border-dashed border-white/10 rounded-2xl bg-black/20">
                    <p className="text-[10px] text-[#3f3f46] uppercase tracking-widest font-black">
                      // BUFFER EMPTY //
                    </p>
                  </div>
                ) : (
                  clipboardItems.map((item, idx) => (
                    <div key={idx} className="p-4 border border-white/5 bg-black/40 text-xs flex flex-col gap-3 rounded-2xl shadow-sm hover:border-white/10 transition-colors">
                      <div className="flex justify-between items-center border-b border-white/5 pb-2 text-[9px] text-[#71717a] font-black tracking-widest uppercase">
                        <span className="text-[#a78bfa] bg-[#a78bfa]/10 px-2 py-0.5 rounded-md border border-[#a78bfa]/20">{item.type} NODE</span>
                        <span>{item.timestamp}</span>
                      </div>
                      {item.type === 'image' ? (
                        <div className="border border-white/5 bg-black/60 p-2 flex items-center justify-center rounded-xl overflow-hidden shadow-inner">
                          <img src={item.content} alt="Sync payload" className="max-h-[100px] object-contain rounded-md" />
                        </div>
                      ) : (
                        <p className="text-[#d4d4d8] break-all font-mono leading-relaxed whitespace-pre-wrap selection:bg-[#a78bfa]/30">{item.content}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </main>
      )}

      {/* SMOOTH ANIMATED QR MODAL */}
      {showQR && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[60] p-4 animate-in fade-in duration-300">
          <div className="bg-[#0a0a0f] border border-white/10 max-w-sm w-full p-8 relative rounded-3xl shadow-[0_30px_100px_rgba(0,0,0,1)] transform scale-100 animate-in zoom-in-95 duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#60a5fa]/10 blur-2xl rounded-full pointer-events-none"></div>
            
            <button 
              onClick={() => setShowQR(false)}
              className="absolute top-5 right-5 text-[#52525b] hover:text-white bg-white/5 hover:bg-white/10 p-2 rounded-full cursor-pointer transition-all duration-300 active:scale-90"
            >
              <X size={14} strokeWidth={3} />
            </button>
            <div className="text-center flex flex-col items-center relative z-10 mt-2">
              <h3 className="text-sm font-black text-white uppercase tracking-widest mb-2">SCAN TO CONNECT</h3>
              <p className="text-[11px] text-[#71717a] mb-6 uppercase tracking-wider leading-relaxed px-4 font-bold">
                Use your mobile camera to anchor directly into this private matrix namespace.
              </p>
              <div className="p-4 bg-white border border-white/20 mb-6 rounded-2xl shadow-xl transform transition-transform hover:scale-105 duration-500">
                <QRCodeSVG value={window.location.href} size={160} />
              </div>
              <span className="font-mono text-xs text-[#60a5fa] font-black bg-[#60a5fa]/10 px-4 py-2 border border-[#60a5fa]/20 rounded-xl tracking-widest shadow-inner">
                {roomId}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

// return (
//     <div className="min-h-screen bg-[#0b0f19] text-gray-100 flex flex-col selection:bg-blue-500/30 relative">
      
//       {/* HEADER NAVBAR */}
//       <header className="border-b border-gray-800/60 bg-[#0d1322]/80 backdrop-blur-md sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
//         <div className="flex items-center gap-3">
//           <div className="bg-gradient-to-tr from-blue-600 to-indigo-500 p-2 rounded-xl text-white shadow-lg shadow-blue-500/20">
//             <Zap size={22} className="animate-pulse" />
//           </div>
//           <div>
//             <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
//               VibeShare
//             </h1>
//             <p className="text-xs text-gray-400 flex items-center gap-1">
//               <Shield size={12} className="text-emerald-400" /> End-to-End Encrypted P2P
//             </p>
//           </div>
//         </div>

//         {/* ROOM BADGE & PAIRING TOOLS */}
//         <div className="flex items-center gap-2">
//           {/* Clear Matrix Action Control Button */}
//           <button 
//             onClick={handleClearMatrix}
//             title="Clear entire room data history across all devices"
//             className="p-2 rounded-xl bg-[#131b2e] border border-gray-800 text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 hover:border-rose-900/50 transition-all cursor-pointer mr-1"
//           >
//             <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
//               <path d="M3 6h18"></path>
//               <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
//               <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
//             </svg>
//           </button>

//           <button 
//             onClick={() => setShowQR(true)} 
//             className="p-2 rounded-xl bg-[#131b2e] border border-gray-800 text-gray-400 hover:text-blue-400 transition-colors cursor-pointer"
//             title="Show QR Code"
//           >
//             <QrCode size={18} />
//           </button>
          
//           <div className="flex items-center gap-3 bg-[#131b2e] px-4 py-2 rounded-xl border border-gray-800">
//             <span className="text-xs text-gray-400 font-medium tracking-wider hidden sm:inline">ROOM:</span>
//             <span className="font-mono font-bold text-blue-400 tracking-widest text-sm">{roomId}</span>
//             <button 
//               onClick={() => {
//                 navigator.clipboard.writeText(window.location.href);
//                 alert("Pairing link copied!");
//               }} 
//               className="text-gray-400 hover:text-white transition-colors cursor-pointer"
//             >
//               <Copy size={15} />
//             </button>
//           </div>
//         </div>
//       </header>

//       {/* WORKSPACE AREA GUARDED BY PASSWORD GATE */}
//       {!isUnlocked ? (
//         <div className="flex-1 flex items-center justify-center p-6 bg-radial-at-t from-[#0d1527] to-[#070b14]">
//           <div className="w-full max-w-md p-6 rounded-2xl border border-gray-800 bg-[#0f1626]/60 backdrop-blur-md shadow-2xl text-center">
//             <div className="mx-auto w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400 mb-4 border border-blue-500/20">
//               <Lock size={22} />
//             </div>
            
//             <h2 className="text-xl font-bold tracking-tight text-white mb-2">
//               {roomPassword ? "Encrypted Room Access" : "Secure Your Session Matrix"}
//             </h2>
//             <p className="text-xs text-gray-400 mb-6 px-4">
//               {roomPassword 
//                 ? "This synchronization room is restricted. Enter the session passcode to view the data stream."
//                 : "Create a private passcode for this workspace room before connecting external hardware devices."}
//             </p>

//             <form onSubmit={roomPassword ? handleVerifyPassword : handleSetPassword} className="space-y-4">
//               <input 
//                 type="password"
//                 placeholder={roomPassword ? "Enter Access Passcode..." : "Create New Room Passcode..."}
//                 value={passwordInput}
//                 onChange={(e) => setPasswordInput(e.target.value)}
//                 className="w-full px-4 py-3 bg-[#070b14] border border-gray-800 rounded-xl font-mono text-sm text-center text-blue-300 placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
//               />
//               <button 
//                 type="submit"
//                 className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-sm font-bold shadow-lg shadow-blue-500/20 hover:from-blue-500 hover:to-indigo-500 transition-all cursor-pointer"
//               >
//                 {roomPassword ? "Unlock Matrix Workspace" : "Initialize Secure Room"}
//               </button>
//             </form>
//           </div>
//         </div>
//       ) : (
//         /* CORE DASHBOARD WORKSPACE */
//         <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fadeIn">
          
//           {/* LEFT COMPONENT COLUMN */}
//           <section className="lg:col-span-7 flex flex-col gap-6">
//             <input 
//               type="file" 
//               ref={fileInputRef} 
//               className="hidden" 
//               onChange={(e) => e.target.files[0] && sendFile(e.target.files[0])} 
//             />
//             <div 
//               onClick={() => fileInputRef.current.click()}
//               onDragOver={handleDragOver}
//               onDragLeave={handleDragLeave}
//               onDrop={handleDrop}
//               className={`flex-1 min-h-[350px] border-2 border-dashed rounded-2xl glow-card p-8 flex flex-col items-center justify-center text-center group transition-all duration-300 cursor-pointer ${
//                 isDragging 
//                   ? 'border-blue-400 bg-blue-500/10 scale-[0.99]' 
//                   : 'bg-[#0f1626] border-gray-800 hover:border-blue-500/50'
//               }`}
//             >
//               <div className={`p-5 rounded-full transition-all duration-300 mb-4 ${
//                 isDragging ? 'bg-blue-500 text-white scale-110' : 'bg-[#17223b] text-gray-400 group-hover:text-blue-400 group-hover:scale-110'
//               }`}>
//                 <UploadCloud size={40} />
//               </div>
//               <h3 className="text-lg font-semibold text-gray-200 group-hover:text-white">
//                 {isDragging ? "Drop your data to stream!" : "Drag & Drop folders or files here"}
//               </h3>
//               <p className="text-sm text-gray-400 mt-1 max-w-sm">
//                 Files stream directly over hardware WebRTC data wires without touching cloud servers.
//               </p>
//               <span className="mt-4 px-4 py-1.5 bg-[#17223b] text-xs font-medium rounded-full text-gray-300 group-hover:bg-blue-500/10 group-hover:text-blue-300 transition-colors">
//                 Browse Local Files
//               </span>
//             </div>

//             <div className="bg-[#0f1626] border border-gray-800/80 rounded-2xl p-5 glow-card">
//               <div className="flex justify-between items-center mb-3">
//                 <span className="text-sm font-medium text-gray-300">Live Wire Transfer Matrix</span>
//                 <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400">
//                   {transferSpeed}
//                 </span>
//               </div>
//               <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
//                 <div 
//                   className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full transition-all duration-300"
//                   style={{ width: `${progress}%` }}
//                 ></div>
//               </div>
//               <div className="flex justify-between items-center mt-2 text-xs text-gray-400">
//                 <span>{progress}% complete</span>
//                 <span>Encrypted Data Chunks</span>
//               </div>
//             </div>
//           </section>

//           {/* RIGHT COMPONENT COLUMN */}
//           <section className="lg:col-span-5 flex flex-col gap-6">
//             <div className="flex-1 bg-[#0f1626] border border-gray-800 rounded-2xl p-5 flex flex-col glow-card">
//               <div className="flex items-center gap-2 border-b border-gray-800 pb-3 mb-4">
//                 <FileText size={18} className="text-indigo-400" />
//                 <h2 className="text-sm font-semibold tracking-wide uppercase text-gray-300">Shared Canvas Notes</h2>
//               </div>
//               <textarea
//                 className="w-full flex-1 bg-[#070b14] border border-gray-800/80 rounded-xl p-4 text-sm focus:outline-none focus:border-blue-500 text-gray-200 resize-none placeholder-gray-600 font-sans"
//                 placeholder="Type notes here... Anything typed updates instantly across paired devices."
//                 value={note}
//                 onChange={handleNoteChange}
//               />
//             </div>

//             <div className="bg-[#0f1626] border border-gray-800 rounded-2xl p-5 glow-card">
//               <div className="flex items-center justify-between border-b border-gray-800 pb-3 mb-4">
//               <div className="flex items-center gap-2">
//                 <Clipboard size={18} className="text-purple-400" />
//                 <h2 className="text-sm font-semibold tracking-wide uppercase text-gray-300">Live Clipboard Sync</h2>
//               </div>
//               <div className="flex items-center gap-2">
//                 {/* Mobile Tap-to-Paste Enhancement */}
//                 <button
//                   onClick={handleMobilePaste}
//                   className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 transition-all cursor-pointer"
//                   title="Paste directly from system clipboard"
//                 >
//                   Tap to Paste
//                 </button>
//                 <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
//               </div>
//             </div>
//               <p className="text-xs text-gray-400 mb-4">
//                 Hit <kbd className="bg-gray-800 px-1 py-0.5 rounded text-gray-300">Ctrl+V</kbd> anywhere inside this window to sync clipboard snippets immediately.
//               </p>

//               <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
//                 {clipboardItems.length === 0 ? (
//                   <div className="p-4 rounded-xl border border-gray-800/60 bg-[#070b14] min-h-[80px] flex items-center justify-center text-center">
//                     <p className="text-sm text-gray-500 italic">No clipboard entries transferred yet</p>
//                   </div>
//                 ) : (
//                   clipboardItems.map((item, idx) => (
//                     <div key={idx} className="p-3 rounded-xl border border-gray-800 bg-[#070b14] text-xs flex flex-col gap-2 animate-fadeIn">
//                       <div className="flex justify-between items-center border-b border-gray-950 pb-1 text-[10px] text-gray-500 font-medium">
//                         <span className="uppercase text-purple-400 font-bold tracking-wider">{item.type} SNIPPET</span>
//                         <span>{item.timestamp}</span>
//                       </div>
//                       {item.type === 'image' ? (
//                         <div className="rounded-lg overflow-hidden border border-gray-800 bg-[#0b0f19] p-1 flex items-center justify-center max-h-[140px]">
//                           <img src={item.content} alt="Synced clipboard resource" className="max-h-[130px] object-contain rounded" />
//                         </div>
//                       ) : (
//                         <p className="text-gray-300 break-all font-mono whitespace-pre-wrap">{item.content}</p>
//                       )}
//                     </div>
//                   ))
//                 )}
//               </div>
//             </div>
            
//           </section>
//         </main>
//       )}

//       {/* MODAL SYSTEM: QR PAIRING CODE DISPLAY OVERLAY */}
//       {showQR && (
//         <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
//           <div className="bg-[#0f1626] border border-gray-800 max-w-sm w-full rounded-2xl p-6 relative animate-scaleUp shadow-2xl">
//             <button 
//               onClick={() => setShowQR(false)}
//               className="absolute top-4 right-4 text-gray-400 hover:text-white cursor-pointer"
//             >
//               <X size={20} />
//             </button>
//             <div className="text-center flex flex-col items-center">
//               <h3 className="text-lg font-bold text-gray-100 mb-1">Instant QR Sync</h3>
//               <p className="text-xs text-gray-400 mb-6 px-4">
//                 Scan this matrix code with your mobile phone camera to instantly join the P2P wire link without entering room configurations manually.
//               </p>
//               <div className="p-4 bg-white rounded-xl shadow-inner mb-4">
//                 <QRCodeSVG value={window.location.href} size={180} />
//               </div>
//               <span className="font-mono text-xs text-blue-400 font-semibold bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">
//                 {roomId}
//               </span>
//             </div>
//           </div>
//         </div>
//       )}
//     </div>
//   );