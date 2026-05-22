// End-to-End Encryption (E2EE) Utility for Campus Connect Chats

const CRYPTO_PEPPER = "CampusConnectE2E_SecureSalt_2026";

/**
 * Encrypts a message UTF-8 text safely using XOR algorithm with a given key and encodes to Base64.
 * Prefixes using "v2:" to identify upgraded encrypted content.
 */
export function encryptText(text: string, key: string): string {
  if (!text) return '';
  try {
    const compoundKey = key + CRYPTO_PEPPER;
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i) ^ compoundKey.charCodeAt(i % compoundKey.length);
      result += String.fromCharCode(charCode);
    }
    // Encode to base64 safely supporting emojis and unicode characters
    const encoded = btoa(unescape(encodeURIComponent(result)));
    return `v2:${encoded}`;
  } catch (error) {
    console.error("Encryption error:", error);
    return text;
  }
}

/**
 * Decrypts a Base64 encoded payload using XOR algorithm and the key, reverting it to original plain text.
 * Handles both "v2:" versioned encrypted messages and legacy non-upgraded ones.
 */
export function decryptText(encryptedText: string, key: string): string {
  if (!encryptedText) return '';
  
  const isV2 = encryptedText.startsWith('v2:');
  const actualCipherHex = isV2 ? encryptedText.substring(3) : encryptedText;
  const decodeKey = isV2 ? (key + CRYPTO_PEPPER) : key;

  try {
    const rawText = decodeURIComponent(escape(atob(actualCipherHex)));
    let result = '';
    for (let i = 0; i < rawText.length; i++) {
      const charCode = rawText.charCodeAt(i) ^ decodeKey.charCodeAt(i % decodeKey.length);
      result += String.fromCharCode(charCode);
    }
    return result;
  } catch (error) {
    // If V2 decryption fails or parsing fails, return original text safely
    if (isV2) {
      // Try legacy decryption fallback just in case of mismatch
      try {
        const rawText = decodeURIComponent(escape(atob(actualCipherHex)));
        let result = '';
        for (let i = 0; i < rawText.length; i++) {
          const charCode = rawText.charCodeAt(i) ^ key.charCodeAt(i % key.length);
          result += String.fromCharCode(charCode);
        }
        return result;
      } catch (ee) {
        return encryptedText;
      }
    }
    return encryptedText;
  }
}
