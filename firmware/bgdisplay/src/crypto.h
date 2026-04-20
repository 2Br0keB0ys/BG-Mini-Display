// crypto.h — AES-128-CBC encryption using ESP32 built-in mbedTLS
// Key derived from unique chip ID — data is unreadable without this exact device

#pragma once
#include <Arduino.h>
#include "mbedtls/aes.h"
#include "mbedtls/sha256.h"
#include <string.h>

// Derive a 16-byte AES key from chip ID + salt
// This key is unique per device — stolen SD card or NVS dump is useless
inline void deriveKey(const char* salt, uint8_t outKey[16]) {
  uint64_t chipId = ESP.getEfuseMac();
  uint8_t input[32];
  memcpy(input,      &chipId, 8);
  memcpy(input + 8,  salt,    strlen(salt) < 24 ? strlen(salt) : 24);

  uint8_t hash[32];
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, 0);
  mbedtls_sha256_update(&ctx, input, 8 + strlen(salt));
  mbedtls_sha256_finish(&ctx, hash);
  mbedtls_sha256_free(&ctx);

  memcpy(outKey, hash, 16); // first 16 bytes of SHA256
}

// Pad data to AES block size (16 bytes) using PKCS7
inline size_t pkcs7Pad(const uint8_t* in, size_t len, uint8_t* out, size_t maxOut) {
  size_t padded = ((len / 16) + 1) * 16;
  if (padded > maxOut) return 0;
  memcpy(out, in, len);
  uint8_t padByte = (uint8_t)(padded - len);
  for (size_t i = len; i < padded; i++) out[i] = padByte;
  return padded;
}

// Remove PKCS7 padding
inline size_t pkcs7Unpad(uint8_t* data, size_t len) {
  if (len == 0) return 0;
  uint8_t pad = data[len - 1];
  if (pad > 16 || pad == 0) return len;
  return len - pad;
}

// Generate random IV using ESP32 hardware RNG
inline void randomIV(uint8_t iv[16]) {
  for (int i = 0; i < 16; i++) iv[i] = (uint8_t)(esp_random() & 0xFF);
}

// Encrypt: returns base64-encoded string of [IV(16) + ciphertext]
inline String aesEncrypt(const String& plaintext, const char* salt) {
  uint8_t key[16];
  deriveKey(salt, key);

  uint8_t iv[16];
  randomIV(iv);

  size_t len = plaintext.length();
  uint8_t padded[512] = {0};
  size_t paddedLen = pkcs7Pad((const uint8_t*)plaintext.c_str(), len, padded, 512);
  if (paddedLen == 0) return "";

  uint8_t cipher[512] = {0};
  mbedtls_aes_context aes;
  mbedtls_aes_init(&aes);
  mbedtls_aes_setkey_enc(&aes, key, 128);

  uint8_t ivCopy[16]; memcpy(ivCopy, iv, 16);
  mbedtls_aes_crypt_cbc(&aes, MBEDTLS_AES_ENCRYPT, paddedLen, ivCopy, padded, cipher);
  mbedtls_aes_free(&aes);

  // Combine IV + cipher
  uint8_t combined[528];
  memcpy(combined, iv, 16);
  memcpy(combined + 16, cipher, paddedLen);
  size_t totalLen = 16 + paddedLen;

  // Base64 encode
  const char* b64chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  String result = "";
  for (size_t i = 0; i < totalLen; i += 3) {
    uint8_t b0 = combined[i];
    uint8_t b1 = (i+1 < totalLen) ? combined[i+1] : 0;
    uint8_t b2 = (i+2 < totalLen) ? combined[i+2] : 0;
    result += b64chars[b0 >> 2];
    result += b64chars[((b0 & 0x3) << 4) | (b1 >> 4)];
    result += (i+1 < totalLen) ? b64chars[((b1 & 0xF) << 2) | (b2 >> 6)] : '=';
    result += (i+2 < totalLen) ? b64chars[b2 & 0x3F] : '=';
  }
  return result;
}

// Decrypt: takes base64-encoded [IV + ciphertext], returns plaintext
inline String aesDecrypt(const String& b64, const char* salt) {
  if (b64.length() == 0) return "";

  uint8_t key[16];
  deriveKey(salt, key);

  // Base64 decode
  uint8_t decoded[528] = {0};
  size_t decodedLen = 0;
  const String& s = b64;
  auto b64val = [](char c) -> int {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62; if (c == '/') return 63;
    return -1;
  };
  for (size_t i = 0; i < s.length() && decodedLen < 528; i += 4) {
    int v0=b64val(s[i]), v1=b64val(s[i+1]);
    int v2=(i+2<s.length())?b64val(s[i+2]):-1;
    int v3=(i+3<s.length())?b64val(s[i+3]):-1;
    if (v0<0||v1<0) break;
    decoded[decodedLen++] = (v0<<2)|(v1>>4);
    if (v2>=0) decoded[decodedLen++] = ((v1&0xF)<<4)|(v2>>2);
    if (v3>=0) decoded[decodedLen++] = ((v2&0x3)<<6)|v3;
  }

  if (decodedLen <= 16) return "";

  uint8_t iv[16]; memcpy(iv, decoded, 16);
  size_t cipherLen = decodedLen - 16;
  uint8_t plain[512] = {0};

  mbedtls_aes_context aes;
  mbedtls_aes_init(&aes);
  mbedtls_aes_setkey_dec(&aes, key, 128);
  mbedtls_aes_crypt_cbc(&aes, MBEDTLS_AES_DECRYPT, cipherLen, iv, decoded + 16, plain);
  mbedtls_aes_free(&aes);

  size_t plainLen = pkcs7Unpad(plain, cipherLen);
  plain[plainLen] = 0;
  return String((char*)plain);
}

// Store encrypted string in NVS
inline void nvsPutEncrypted(Preferences& p, const char* key, const String& value) {
  p.putString(key, aesEncrypt(value, "BGDisplay_NVS_v1"));
}

// Read encrypted string from NVS
inline String nvsGetEncrypted(Preferences& p, const char* key, const String& defaultVal = "") {
  String enc = p.getString(key, "");
  if (enc.length() == 0) return defaultVal;
  String dec = aesDecrypt(enc, "BGDisplay_NVS_v1");
  return dec.length() > 0 ? dec : defaultVal;
}
