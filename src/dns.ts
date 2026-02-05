
const DOH_PROVIDERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/resolve',
  'https://dns.quad9.net/dns-query',
  'https://doh.opendns.com/dns-query',
  // 'https://dns.alidns.com/resolve', // Might be slow from Workers
  // 'https://doh.pub/dns-query'       // DNSPod
];

async function queryDoh(provider: string, domain: string): Promise<string[]> {
  try {
    const url = new URL(provider);
    url.searchParams.set('name', domain);
    url.searchParams.set('type', 'A');
    // Google uses 'type=A' but checks 'Accept' header too usually.
    // Some providers like Google might not support application/dns-json on /dns-query path perfectly without specific params,
    // but standard is `name` and `type`.
    
    // Adjust for Google specifically if needed, but Google supports /resolve?name=...
    // Let's stick to standard params which most support.

    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/dns-json' }
    });

    if (!res.ok) {
      // console.warn(`DoH query failed for ${provider}: ${res.status}`);
      return [];
    }

    const data: any = await res.json();
    if (!data.Answer) {
      return [];
    }

    return data.Answer
      .filter((r: any) => r.type === 1) // 1 is A record
      .map((r: any) => r.data);
  } catch (e) {
    // console.warn(`Error querying ${provider}:`, e);
    return [];
  }
}

export async function resolveA(domain: string): Promise<string[]> {
  console.log(`Resolving A records for ${domain} using multiple DoH providers...`);
  
  // We can query multiple providers in parallel to get a wider set of IPs
  // Since DNS rotation often returns different subsets.
  const promises = DOH_PROVIDERS.map(p => queryDoh(p, domain));
  
  // Also add a few repeated queries to Cloudflare/Google to try and catch round-robin variations
  promises.push(queryDoh('https://cloudflare-dns.com/dns-query', domain));
  promises.push(queryDoh('https://dns.google/resolve', domain));

  const results = await Promise.all(promises);
  
  const uniqueIps = new Set<string>();
  results.flat().forEach(ip => {
      if (ip && typeof ip === 'string') {
          uniqueIps.add(ip);
      }
  });

  const ips = Array.from(uniqueIps);
  console.log(`Resolved ${ips.length} unique IPs for ${domain}:`, ips);
  
  if (ips.length === 0) {
      console.warn(`No IPs found for ${domain} from any provider.`);
  }

  return ips;
}
