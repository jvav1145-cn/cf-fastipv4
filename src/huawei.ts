
import { HuaweiSigner } from './signer';

export class HuaweiDNS {
  private signer: HuaweiSigner;
  private endpoint: string;

  constructor(ak: string, sk: string, endpoint: string = 'dns.myhuaweicloud.com', projectId?: string) {
    this.signer = new HuaweiSigner(ak, sk, projectId);
    this.endpoint = endpoint;
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    const url = `https://${this.endpoint}${path}`;
    const headers = new Headers({
      'Content-Type': 'application/json'
    });

    const reqInit: RequestInit = {
      method,
      headers,
      body: body ? JSON.stringify(body) : null
    };

    let req = new Request(url, reqInit);
    req = await this.signer.sign(req);

    console.log(`Huawei API Request: ${method} ${url}`);
    const res = await fetch(req);
    
    const resText = await res.text();
    let resData;
    try {
        resData = JSON.parse(resText);
    } catch {
        resData = resText;
    }

    if (!res.ok) {
      console.error(`Huawei API Error: ${res.status} ${res.statusText}`, resData);
      throw new Error(`Huawei API failed: ${JSON.stringify(resData)}`);
    }

    return resData;
  }

  async getZoneId(domain: string): Promise<string | null> {
    // List zones to find the best match
    // API: GET /v2/zones (V2 is typically used for public zones and avoids APIGW.0101 issues on some endpoints)
    console.log(`Looking for zone for domain: ${domain}`);
    try {
      const data = await this.request('GET', '/v2/zones?type=public');
      if (data.zones) {
        // Find the zone that matches the domain suffix (longest match)
        // Note: Zones usually end with '.'
        const domainWithDot = domain.endsWith('.') ? domain : domain + '.';
        
        let bestMatch: any = null;

        for (const zone of data.zones) {
           if (domainWithDot.endsWith(zone.name)) {
             if (!bestMatch || zone.name.length > bestMatch.name.length) {
               bestMatch = zone;
             }
           }
        }

        if (bestMatch) {
          console.log(`Found zone: ${bestMatch.name} (${bestMatch.id})`);
          return bestMatch.id;
        }
      }
    } catch (e) {
      console.error('Error listing zones:', e);
    }
    return null;
  }

  async updateRecord(domain: string, ips: string[]) {
    console.log(`Updating record ${domain} with IPs:`, ips);
    
    const zoneId = await this.getZoneId(domain);
    if (!zoneId) {
      throw new Error(`Could not find zone for ${domain}`);
    }

    // Ensure domain ends with dot for API search/match if needed, 
    // but usually the API takes the FQDN with or without dot.
    // The search result examples show "www.example.com."
    const fqdn = domain.endsWith('.') ? domain : domain + '.';

    // Check if record exists
    // Use /v2/ API for recordsets
    const searchRes = await this.request('GET', `/v2/zones/${zoneId}/recordsets?name=${fqdn}&type=A`);
    
    let existingRecord = null;
    if (searchRes.recordsets && searchRes.recordsets.length > 0) {
        // Exact match check
        existingRecord = searchRes.recordsets.find((r: any) => r.name === fqdn && r.type === 'A');
    }

    if (existingRecord) {
      console.log(`Record exists (${existingRecord.id}). Updating...`);
      // Update
      // PUT /v2/zones/{zone_id}/recordsets/{recordset_id}
      const body = {
        name: fqdn,
        type: 'A',
        ttl: 60, // Set TTL to 60s as requested implicitly by "fastipv4" (usually low TTL)
        records: ips
      };
      await this.request('PUT', `/v2/zones/${zoneId}/recordsets/${existingRecord.id}`, body);
      console.log('Record updated successfully.');
    } else {
      console.log('Record does not exist. Creating...');
      // Create
      // POST /v2/zones/{zone_id}/recordsets
      const body = {
        name: fqdn,
        type: 'A',
        ttl: 60,
        records: ips
      };
      await this.request('POST', `/v2/zones/${zoneId}/recordsets`, body);
      console.log('Record created successfully.');
    }
  }
}
