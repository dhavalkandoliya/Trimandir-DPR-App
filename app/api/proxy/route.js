import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();
    const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL;

    if (!googleScriptUrl) {
      console.error('Missing GOOGLE_SCRIPT_URL environment variable');
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
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error forwarding to Google Script:', error);
    return NextResponse.json(
      { error: 'Failed to process request backend.' },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  try {
    const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL;

    if (!googleScriptUrl) {
      console.error('Missing GOOGLE_SCRIPT_URL environment variable');
      return NextResponse.json(
        { error: 'Server configuration error.' },
        { status: 500 }
      );
    }

    // Forward the GET request with any query parameters appended
    const url = new URL(request.url);
    const params = url.searchParams.toString();
    const targetUrl = params ? `${googleScriptUrl}?${params}` : googleScriptUrl;

    const response = await fetch(targetUrl);
    const data = await response.json();

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching from Google Script:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data from backend.' },
      { status: 500 }
    );
  }
}
