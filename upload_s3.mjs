import crypto from 'crypto';
import https from 'https';
import fs from 'fs';

const ACCESS_KEY = process.env.HF_ACCESS_KEY;
const SECRET_KEY = process.env.HF_SECRET_KEY;
const REGION = 'us-east-1';
const SERVICE = 's3';
const HOST = 's3.hf.co';
const NAMESPACE = process.env.HF_NAMESPACE || 'Onairplayout';
const BUCKET = process.env.HF_BUCKET || 'playout-media';

function hmac(key, string) {
  return crypto.createHmac('sha256', key).update(string, 'utf8').digest();
}
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kDate = hmac('AWS4' + key, dateStamp);
  const kRegion = hmac(kDate, regionName);
  const kService = hmac(kRegion, serviceName);
  return hmac(kService, 'aws4_request');
}

function s3Put(path, body, contentType = 'video/mp4') {
  return new Promise((resolve, reject) => {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256(body);

    const headers = {
      'Host': HOST,
      'Content-Length': body.length,
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };

    const canonicalHeaders = `content-length:${body.length}\ncontent-type:${contentType}\nhost:${HOST}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'content-length;content-type;host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = ['PUT', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join('\n');
    const signingKey = getSignatureKey(SECRET_KEY, dateStamp, REGION, SERVICE);
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

    headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const req = https.request({ hostname: HOST, port: 443, path, method: 'PUT', headers }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const file = process.argv[2] || 'github_live_test.mp4';
  const targetKey = process.argv[3] || 'github_live_test.mp4';
  if (!ACCESS_KEY || !SECRET_KEY) {
    console.log('Skipping HF S3 upload (no credentials passed)');
    return;
  }
  const bytes = fs.readFileSync(file);
  console.log(`Uploading ${file} (${bytes.length} bytes) to HuggingFace S3 /${NAMESPACE}/${BUCKET}/${targetKey}...`);
  const res = await s3Put(`/${NAMESPACE}/${BUCKET}/${targetKey}`, bytes, 'video/mp4');
  console.log('HF S3 Upload Status:', res.statusCode);
  console.log(`Public URL: https://huggingface.co/buckets/${NAMESPACE}/${BUCKET}/resolve/${targetKey}`);
}

main().catch(console.error);
