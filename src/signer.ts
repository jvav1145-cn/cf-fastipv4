
import { createHash, createHmac } from 'node:crypto';

export class HuaweiSigner {
  private ak: string;
  private sk: string;

  constructor(ak: string, sk: string, projectId?: string) {
    this.ak = ak;
    this.sk = sk;
    this.projectId = projectId;
  }

  private projectId?: string;

  public async sign(request: Request): Promise<Request> {
    const method = request.method.toUpperCase();
    const url = new URL(request.url);
    
    // 1. Set X-Sdk-Date
    const date = new Date();
    // Format: YYYYMMDDTHHMMSSZ
    const isoDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    request.headers.set('X-Sdk-Date', isoDate);
    // Ensure Host header is set
    request.headers.set('Host', url.host);

    // Set X-Project-Id if configured
    if (this.projectId) {
        request.headers.set('X-Project-Id', this.projectId);
    }

    // 2. Canonical Request
    
    // 2.1 Method
    // 2.2 Canonical URI
    // "A URI must end with a slash (/) for signature calculation."
    let canonicalUri = url.pathname;
    if (!canonicalUri.endsWith('/')) {
        canonicalUri += '/';
    }
    // Note: If pathname is empty, it becomes "/"

    // 2.3 Canonical Query String
    const params = Array.from(url.searchParams.entries());
    params.sort((a, b) => a[0].localeCompare(b[0]));
    const canonicalQueryString = params.map(([k, v]) => 
        `${this.encode(k)}=${this.encode(v)}`
    ).join('&');

    // 2.4 Canonical Headers
    const headersToSign = ['host', 'x-sdk-date'];
    if (request.headers.has('content-type')) {
        headersToSign.push('content-type');
    }
    // Add X-Project-Id to signed headers if present
    if (request.headers.has('x-project-id')) {
        headersToSign.push('x-project-id');
    }
    headersToSign.sort();
    
    const canonicalHeaders = headersToSign.map(h => {
        const value = request.headers.get(h) || '';
        return `${h}:${value.trim()}`;
    }).join('\n') + '\n';

    // 2.5 Signed Headers
    const signedHeaders = headersToSign.join(';');

    // 2.6 Payload Hash
    let body = '';
    if (request.body) {
        // We need to read the body. Since request bodies in Workers can be streams, 
        // we assume for our API calls we passed a string or null.
        // For safety in this specific use case, we'll assume we clone it or it's small.
        try {
            const clone = request.clone();
            body = await clone.text();
        } catch (e) {
            console.warn('Failed to read body for signing', e);
        }
    }
    const payloadHash = createHash('sha256').update(body).digest('hex');

    const canonicalRequest = [
        method,
        canonicalUri,
        canonicalQueryString,
        canonicalHeaders,
        signedHeaders,
        payloadHash
    ].join('\n');

    // 3. String To Sign
    const algorithm = 'SDK-HMAC-SHA256';
    const stringToSign = [
        algorithm,
        isoDate,
        createHash('sha256').update(canonicalRequest).digest('hex')
    ].join('\n');

    // 4. Signature
    const signature = createHmac('sha256', this.sk)
        .update(stringToSign)
        .digest('hex');

    // 5. Authorization Header
    const auth = `${algorithm} Access=${this.ak}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    request.headers.set('Authorization', auth);

    return request;
  }

  private encode(str: string): string {
    return encodeURIComponent(str)
        .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  }
}
