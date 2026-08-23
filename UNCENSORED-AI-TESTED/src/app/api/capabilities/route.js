import { NextResponse } from 'next/server';
import { getCapabilities } from '@/lib/providers';

export async function GET() {
    return NextResponse.json(getCapabilities());
}
