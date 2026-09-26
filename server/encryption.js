import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// The key belongs in the runtime secret store, never in the database or frontend.
export function dataCipher(secret = process.env.DATA_ENCRYPTION_KEY) {
  if (secret && !/^[a-f0-9]{64}$/i.test(secret)) throw new Error('DATA_ENCRYPTION_KEY debe contener 64 caracteres hexadecimales aleatorios.');
  const key = secret ? Buffer.from(secret, 'hex') : null;
  function encrypt(bytes, context) {
    if (!key) throw new Error('Falta la clave de cifrado.');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]);
  }
  function decrypt(bytes, context) {
    if (!key) throw new Error('La base de datos está cifrada y falta DATA_ENCRYPTION_KEY.');
    bytes = Buffer.from(bytes);
    if (bytes.length < 28) throw new Error('Datos cifrados no válidos.');
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
  }
  return {
    enabled: Boolean(key), encrypt, decrypt,
    encode(data, userId) { return key ? { encrypted: 'aes-256-gcm-v1', value: encrypt(Buffer.from(JSON.stringify(data)), `workspace:${userId}`).toString('base64') } : data; },
    decode(data, userId) { return data.encrypted ? JSON.parse(decrypt(Buffer.from(data.value, 'base64'), `workspace:${userId}`).toString('utf8')) : data; },
  };
}

export async function migrateEncryption(pool, cipher) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Serialize migration with normal writes and concurrent application starts.
    await db.query('LOCK TABLE minuto_teams, minuto_assets IN SHARE ROW EXCLUSIVE MODE');
    const teams = await db.query('SELECT user_id,data FROM minuto_teams');
    for (const row of teams.rows) {
      const data = cipher.decode(row.data, row.user_id); // Fail closed on missing/wrong keys.
      if (cipher.enabled && !row.data.encrypted) await db.query('UPDATE minuto_teams SET data=$2 WHERE user_id=$1', [row.user_id, JSON.stringify(cipher.encode(data, row.user_id))]);
    }
    const assets = await db.query('SELECT id,user_id,bytes,encrypted FROM minuto_assets');
    for (const row of assets.rows) {
      if (row.encrypted) cipher.decrypt(row.bytes, `asset:${row.user_id}:${row.id}`);
      else if (cipher.enabled) await db.query('UPDATE minuto_assets SET bytes=$2,encrypted=TRUE WHERE id=$1', [row.id, cipher.encrypt(row.bytes, `asset:${row.user_id}:${row.id}`)]);
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
