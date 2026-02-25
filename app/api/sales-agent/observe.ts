import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

const dataDir = path.join(process.cwd(), 'data')
const filePath = path.join(dataDir, 'sessions.json')

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    await fs.mkdir(dataDir, { recursive: true })
    let sessions: any[] = []
    try {
      const text = await fs.readFile(filePath, 'utf8')
      sessions = JSON.parse(text)
    } catch {}
    sessions.push({ ts: Date.now(), body })
    await fs.writeFile(filePath, JSON.stringify(sessions, null, 2))
    return NextResponse.json({ ok: true, count: sessions.length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
