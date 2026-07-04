// src/crypto.js

export const CryptoMatrix = {
  // 1. Turn the room password into an AES-GCM cryptographic key
  deriveKey: async (password) => {
    const enc = new TextEncoder();
    // Import password as raw key material
    const keyMaterial = await crypto.subtle.importKey(
      "raw", 
      enc.encode(password), 
      { name: "PBKDF2" }, 
      false, 
      ["deriveKey"]
    );
    // Derive a 256-bit AES-GCM key using PBKDF2
    return await crypto.subtle.deriveKey(
      { 
        name: "PBKDF2", 
        salt: enc.encode("vibeshare-secure-salt"), // In production, generate a random salt
        iterations: 100000, 
        hash: "SHA-256" 
      },
      keyMaterial, 
      { name: "AES-GCM", length: 256 }, 
      false, 
      ["encrypt", "decrypt"]
    );
  },

  // 2. Encrypt the plaintext payload
  encrypt: async (text, key) => {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12)); // AES-GCM requires a 12-byte IV
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv }, 
      key, 
      enc.encode(text)
    );
    
    // Pack the IV and Ciphertext together into a single ArrayBuffer for transport
    const packed = new Uint8Array(iv.length + ciphertext.byteLength);
    packed.set(iv, 0);
    packed.set(new Uint8Array(ciphertext), iv.length);
    return packed;
  },

  // 3. Decrypt the incoming binary payload
  decrypt: async (packedData, key) => {
    // Unpack the array buffer
    const dataArray = new Uint8Array(packedData);
    const iv = dataArray.slice(0, 12);
    const ciphertext = dataArray.slice(12);
    
    // Decrypt and decode
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv }, 
      key, 
      ciphertext
    );
    return new TextDecoder().decode(decryptedBuffer);
  }
};