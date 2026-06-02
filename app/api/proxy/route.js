import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // Prevent Next.js from caching GET requests to this route
export const fetchCache = 'force-no-store';

export async function POST(request) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

  try {
    const body = await request.json();
    const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL;

    if (!googleScriptUrl) {
      console.error('Missing GOOGLE_SCRIPT_URL environment variable');
      clearTimeout(timeoutId);
      return NextResponse.json(
        { error: 'Server configuration error.' },
        { status: 500 }
      );
    }

    // Forward the POST request to Google Apps Script
    const response = await fetch(googleScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error('Apps Script returned non-JSON response (POST):', text);
      return NextResponse.json(
        { error: 'Invalid response from backend.', details: text.substring(0, 200) },
        { status: 502 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Error forwarding to Google Script:', error);
    return NextResponse.json(
      { error: error.name === 'AbortError' ? 'Backend request timed out.' : 'Failed to process request backend.' },
      { status: error.name === 'AbortError' ? 504 : 500 }
    );
  }
}

export async function GET(request) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

  try {
    const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL;

    if (!googleScriptUrl) {
      console.error('Missing GOOGLE_SCRIPT_URL environment variable');
      clearTimeout(timeoutId);
      return NextResponse.json(
        { error: 'Server configuration error.' },
        { status: 500 }
      );
    }

    // Forward the GET request with any query parameters appended
    const url = new URL(request.url);
    const params = url.searchParams.toString();
    const targetUrl = params ? `${googleScriptUrl}?${params}` : googleScriptUrl;

    // CRITICAL: Force Next.js fetch cache to bypass and fetch from Google Apps Script directly
    const response = await fetch(targetUrl, { 
      cache: 'no-store',
      next: { revalidate: 0 },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error('Apps Script returned non-JSON response (GET):', text);
      return NextResponse.json(
        { error: 'Invalid response from backend.', details: text.substring(0, 200) },
        { status: 502 }
      );
    }

    // CRITICAL: Prevent browser or edge network caching of query data
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Error fetching from Google Script:', error);
    return NextResponse.json(
      { error: error.name === 'AbortError' ? 'Backend request timed out.' : 'Failed to fetch data from backend.' },
      { status: error.name === 'AbortError' ? 504 : 500 }
    );
  }
}

