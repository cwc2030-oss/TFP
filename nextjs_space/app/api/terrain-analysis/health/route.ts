// Diagnostic endpoint to test Modal connectivity from production
import { NextResponse } from 'next/server';

const MODAL_HEALTH_URL = 'https://cwc2030--terrain-brain-fastapi-app.modal.run/health';

export async function GET() {
  const startTime = Date.now();
  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  };
  
  // Test 1: DNS resolution
  try {
    const dns = await import('dns').then(m => m.promises);
    const addresses = await dns.lookup('cwc2030--terrain-brain-fastapi-app.modal.run');
    results.dnsResolution = { success: true, address: addresses };
  } catch (e) {
    results.dnsResolution = { success: false, error: e instanceof Error ? e.message : String(e) };
  }
  
  // Test 2: HTTPS fetch to Modal health endpoint
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    console.log('[Health] Testing Modal connectivity...');
    const response = await fetch(MODAL_HEALTH_URL, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    const elapsed = Date.now() - startTime;
    results.modalHealth = {
      success: true,
      status: response.status,
      statusText: response.statusText,
      elapsed: `${elapsed}ms`,
    };
    console.log('[Health] Modal responded:', response.status, 'in', elapsed, 'ms');
  } catch (e) {
    const elapsed = Date.now() - startTime;
    const errName = e instanceof Error ? e.name : 'Unknown';
    const errMsg = e instanceof Error ? e.message : String(e);
    results.modalHealth = {
      success: false,
      error: errMsg,
      errorType: errName,
      elapsed: `${elapsed}ms`,
    };
    console.error('[Health] Modal test failed:', errName, errMsg);
  }
  
  return NextResponse.json(results);
}
