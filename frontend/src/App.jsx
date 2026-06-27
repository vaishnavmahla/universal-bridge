import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import { Shield, Clipboard, FileText, UploadCloud, Copy, RefreshCw, Zap, QrCode, X } from 'lucide-react';

// Connect to the Node backend port
const socket = io('http://localhost:5000');
const CHUNK_SIZE = 16384; // 16KB optimization chunks for stable WebRTC throughput

function App() {
  // Generate a clean random room code if not provided in the URL hash, forcing uniform spacing
  const [roomId, setRoomId] = useState(() => {
    const hash = window.location.hash.replace('#', '').trim();
    // Replaces URL encoded spaces (%20) or raw spaces with clean hyphens for seamless room alignment
    const cleanHash = decodeURIComponent(hash).replace(/\s+/g, '-').toUpperCase();
    return cleanHash || `ROOM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  });

  const [note, setNote] = useState("");
  const [clipboardItems, setClipboardItems] = useState([]);
  const [transferSpeed, setTransferSpeed] = useState("0 MB/s");
  const [progress, setProgress] = useState(0);
  const [showQR, setShowQR] = useState(false);

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

    socket.on('init-note', (initialText) => setNote(initialText));
    socket.on('note-updated', (text) => setNote(text));
    socket.on('clipboard-received', (item) => setClipboardItems((prev) => [item, ...prev]));

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
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
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

  const handleNoteChange = (e) => {
    const val = e.target.value;
    setNote(val);
    socket.emit('update-note', { roomId, text: val });
  };

  // Global browser canvas context paste hooks (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e) => {
      const text = e.clipboardData.getData('text');
      if (text) {
        const payload = { type: 'text', content: text, timestamp: new Date().toLocaleTimeString() };
        setClipboardItems((prev) => [payload, ...prev]);
        socket.emit('share-clipboard', { roomId, data: payload });
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [roomId]);

  return (
    <div className="min-h-screen bg-[#0b0f19] text-gray-100 flex flex-col selection:bg-blue-500/30 relative">
      
      {/* HEADER NAVBAR */}
      <header className="border-b border-gray-800/60 bg-[#0d1322]/80 backdrop-blur-md sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-blue-600 to-indigo-500 p-2 rounded-xl text-white shadow-lg shadow-blue-500/20">
            <Zap size={22} className="animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
              VibeShare
            </h1>
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <Shield size={12} className="text-emerald-400" /> End-to-End Encrypted P2P
            </p>
          </div>
        </div>

        {/* ROOM BADGE & PAIRING TOOLS */}
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowQR(true)} 
            className="p-2 rounded-xl bg-[#131b2e] border border-gray-800 text-gray-400 hover:text-blue-400 transition-colors cursor-pointer"
            title="Show QR Code"
          >
            <QrCode size={18} />
          </button>
          
          <div className="flex items-center gap-3 bg-[#131b2e] px-4 py-2 rounded-xl border border-gray-800">
            <span className="text-xs text-gray-400 font-medium tracking-wider hidden sm:inline">ROOM:</span>
            <span className="font-mono font-bold text-blue-400 tracking-widest text-sm">{roomId}</span>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                alert("Pairing link copied!");
              }} 
              className="text-gray-400 hover:text-white transition-colors cursor-pointer"
            >
              <Copy size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* QUICK INFRASTRUCTURE REAL-TIME INTERACTIVE VIEWPORTS */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COMPONENT COLUMN */}
        <section className="lg:col-span-7 flex flex-col gap-6">
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            onChange={(e) => e.target.files[0] && sendFile(e.target.files[0])} 
          />
          <div 
            onClick={() => fileInputRef.current.click()}
            className="flex-1 min-h-[350px] bg-[#0f1626] border-2 border-dashed border-gray-800 rounded-2xl glow-card p-8 flex flex-col items-center justify-center text-center group hover:border-blue-500/50 transition-all duration-300 cursor-pointer"
          >
            <div className="bg-[#17223b] p-5 rounded-full text-gray-400 group-hover:text-blue-400 group-hover:scale-110 transition-all duration-300 mb-4">
              <UploadCloud size={40} />
            </div>
            <h3 className="text-lg font-semibold text-gray-200 group-hover:text-white">
              Drag & Drop folders or files here
            </h3>
            <p className="text-sm text-gray-400 mt-1 max-w-sm">
              Files stream directly over hardware WebRTC data wires without touching cloud servers.
            </p>
            <span className="mt-4 px-4 py-1.5 bg-[#17223b] text-xs font-medium rounded-full text-gray-300 group-hover:bg-blue-500/10 group-hover:text-blue-300 transition-colors">
              Browse Local Files
            </span>
          </div>

          <div className="bg-[#0f1626] border border-gray-800/80 rounded-2xl p-5 glow-card">
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-medium text-gray-300">Live Wire Transfer Matrix</span>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400">
                {transferSpeed}
              </span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <div className="flex justify-between items-center mt-2 text-xs text-gray-400">
              <span>{progress}% complete</span>
              <span>Encrypted Data Chunks</span>
            </div>
          </div>
        </section>

        {/* RIGHT COMPONENT COLUMN */}
        <section className="lg:col-span-5 flex flex-col gap-6">
          <div className="flex-1 bg-[#0f1626] border border-gray-800 rounded-2xl p-5 flex flex-col glow-card">
            <div className="flex items-center gap-2 border-b border-gray-800 pb-3 mb-4">
              <FileText size={18} className="text-indigo-400" />
              <h2 className="text-sm font-semibold tracking-wide uppercase text-gray-300">Shared Canvas Notes</h2>
            </div>
            <textarea
              className="w-full flex-1 bg-[#070b14] border border-gray-800/80 rounded-xl p-4 text-sm focus:outline-none focus:border-blue-500 text-gray-200 resize-none placeholder-gray-600 font-sans"
              placeholder="Type notes here... Anything typed updates instantly across paired devices."
              value={note}
              onChange={handleNoteChange}
            />
          </div>

          <div className="bg-[#0f1626] border border-gray-800 rounded-2xl p-5 glow-card">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Clipboard size={18} className="text-purple-400" />
                <h2 className="text-sm font-semibold tracking-wide uppercase text-gray-300">Live Clipboard Sync</h2>
              </div>
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
            </div>
            <p className="text-xs text-gray-400 mb-4">
              Hit <kbd className="bg-gray-800 px-1 py-0.5 rounded text-gray-300">Ctrl+V</kbd> anywhere inside this window to sync clipboard snippets immediately.
            </p>

            <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
              {clipboardItems.length === 0 ? (
                <div className="p-4 rounded-xl border border-gray-800/60 bg-[#070b14] min-h-[80px] flex items-center justify-center text-center">
                  <p className="text-sm text-gray-500 italic">No clipboard entries transferred yet</p>
                </div>
              ) : (
                clipboardItems.map((item, idx) => (
                  <div key={idx} className="p-3 rounded-xl border border-gray-800 bg-[#070b14] text-xs flex justify-between items-start gap-4 animate-fadeIn">
                    <p className="text-gray-300 break-all font-mono">{item.content}</p>
                    <span className="text-[10px] text-gray-500 font-medium shrink-0">{item.timestamp}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>

      {/* MODAL SYSTEM: QR PAIRING CODE DISPLAY OVERLAY */}
      {showQR && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f1626] border border-gray-800 max-w-sm w-full rounded-2xl p-6 relative animate-scaleUp shadow-2xl">
            <button 
              onClick={() => setShowQR(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white cursor-pointer"
            >
              <X size={20} />
            </button>
            <div className="text-center flex flex-col items-center">
              <h3 className="text-lg font-bold text-gray-100 mb-1">Instant QR Sync</h3>
              <p className="text-xs text-gray-400 mb-6 px-4">
                Scan this matrix code with your mobile phone camera to instantly join the P2P wire link without entering room configurations manually.
              </p>
              <div className="p-4 bg-white rounded-xl shadow-inner mb-4">
                <QRCodeSVG value={window.location.href} size={180} />
              </div>
              <span className="font-mono text-xs text-blue-400 font-semibold bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">
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