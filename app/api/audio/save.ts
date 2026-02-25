import { NextResponse } from 'next/server'
import path from 'path'
import { promises as fs } from 'fs'

export async function POST(req: Request) {
  try {
    const { name, data } = await req.json()
    if (!data) return NextResponse.json({ ok: false, error: 'no audio data' })
    const dir = path.resolve(process.cwd(), 'data', 'audio')
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, name || `audio-${Date.now()}.webm`)
    const buff = Buffer.from(data, 'base64')
    await fs.writeFile(filePath, buff)
    return NextResponse.json({ ok: true, path: filePath })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
