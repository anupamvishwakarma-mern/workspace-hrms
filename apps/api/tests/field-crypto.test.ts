import { describe, expect, it } from 'vitest';
import {
  decryptField,
  encryptField,
  maskValue,
  parseEncryptionKey,
} from '../src/utils/fieldCrypto';

const key = parseEncryptionKey('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff');

describe('field encryption', () => {
  it('round-trips and never stores the plain value', () => {
    const enc = encryptField('ABCDE1234F', key, 't:e:pan');
    expect(enc.startsWith('v1.')).toBe(true);
    expect(enc).not.toContain('ABCDE1234F');
    expect(decryptField(enc, key, 't:e:pan')).toBe('ABCDE1234F');
  });

  it('uses a fresh IV each time', () => {
    expect(encryptField('same', key, 'c')).not.toBe(encryptField('same', key, 'c'));
  });

  it('refuses a ciphertext moved to another record or field, a wrong key, and tampering', () => {
    const enc = encryptField('123456789012', key, 'tenant:emp1:aadhaar');
    expect(() => decryptField(enc, key, 'tenant:emp2:aadhaar')).toThrow();
    expect(() => decryptField(enc, key, 'tenant:emp1:uan')).toThrow();
    const other = parseEncryptionKey('ff'.repeat(32));
    expect(() => decryptField(enc, other, 'tenant:emp1:aadhaar')).toThrow();
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptField(parts.join('.'), key, 'tenant:emp1:aadhaar')).toThrow();
    expect(() => decryptField('garbage', key, 'c')).toThrow();
  });

  it('accepts hex or base64 keys of 32 bytes only', () => {
    expect(parseEncryptionKey(Buffer.alloc(32, 1).toString('base64')).length).toBe(32);
    expect(() => parseEncryptionKey('short')).toThrow();
    expect(() => parseEncryptionKey('ab'.repeat(16))).toThrow();
  });

  it('masks all but the last four characters', () => {
    expect(maskValue('ABCDE1234F')).toBe('XXXXXX234F');
    expect(maskValue('123456789012')).toBe('XXXXXXXX9012');
    expect(maskValue('123')).toBe('XXX');
  });
});
