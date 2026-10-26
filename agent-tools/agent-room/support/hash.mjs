import { createHash } from 'node:crypto';

export function sha256(value) {
  return createHash('sha256')
    .update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8'))
    .digest('hex');
}
