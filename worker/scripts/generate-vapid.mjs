// Genera la coppia di chiavi VAPID (una volta sola). Uso: node worker/scripts/generate-vapid.mjs
import { generateKeyPairSync } from 'node:crypto'

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pub = publicKey.export({ format: 'jwk' })
const prv = privateKey.export({ format: 'jwk' })
const b64u = (b) => Buffer.from(b).toString('base64url')
const publicRaw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')])

console.log('VAPID_PUBLIC_KEY=' + b64u(publicRaw))
console.log('VAPID_PRIVATE_KEY=' + prv.d)
console.log('\nLa chiave PRIVATA resta segreta: va solo nei segreti di Cloudflare (wrangler secret put). Quella pubblica va anche nell\'app (VITE_VAPID_PUBLIC_KEY).')
